// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { TilesRenderer } from "3d-tiles-renderer";
import { t } from "i18next";
import * as _ from "lodash-es";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import * as THREE from "three";

import Logger from "@lichtblick/log";
import { toNanoSec } from "@lichtblick/rostime";
import { MessageEvent, SettingsTreeAction, SettingsTreeFields, Time } from "@lichtblick/suite";
import {
  PRESETS,
  SourceParams,
  composeStyle,
  fetchVectorStyle,
} from "@lichtblick/suite-base/panels/Map/layers";

import type { AnyRendererSubscription, IRenderer } from "../IRenderer";
import { createBundledDracoLoader } from "../ModelCache";
import { BaseUserData, Renderable } from "../Renderable";
import { SceneExtension, onlyLastByTopicMessage } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { normalizeTime } from "../normalizeMessages";
import { CustomLayerSettings, PRECISION_DISTANCE } from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose } from "../transforms";
import {
  DemSource,
  DemTiles,
  LatLon,
  MAX_LATITUDE,
  enuOffset,
  loadDem,
  metersPerMercator,
  sampleElevation,
  toMercator,
  zoomForSpan,
} from "./mapGeo";

const log = Logger.getLogger(__filename);

const MAP_LAYER_ID = "lichtblick.Map";
const MAP_3D_LAYER_ID = "lichtblick.Map3D";

const LOCATION_SCHEMAS = new Set([
  "sensor_msgs/NavSatFix",
  "sensor_msgs/msg/NavSatFix",
  "ros.sensor_msgs.NavSatFix",
  "foxglove_msgs/LocationFix",
  "foxglove_msgs/msg/LocationFix",
  "foxglove.LocationFix",
]);

type LocationMessage = {
  header?: { frame_id?: string; stamp?: Time };
  frame_id?: string;
  timestamp?: Time;
  latitude: number;
  longitude: number;
  altitude?: number;
  status?: { status: number };
};

type CommonSettings = CustomLayerSettings & {
  /** Location fix topic; undefined picks the first one. */
  locationTopic?: string;
  /** Frame whose XY plane is east/north; undefined uses the fixed frame. */
  enuFrame?: string;
};

export type LayerSettingsMap = CommonSettings & {
  layerId: typeof MAP_LAYER_ID;
  /** A PRESETS key or "custom". */
  source: string;
  customUrl: string;
  customKind: "raster" | "vector";
  /** A PRESETS elevation key, or "" for a flat map. */
  terrain: string;
  exaggeration: number;
  /** Side length in meters. */
  size: number;
  opacity: number;
  zOffset: number;
  /** Draw before the scene, ignoring depth. Defaults to on for flat maps. */
  drawBehind?: boolean;
};

export type LayerSettingsMap3D = CommonSettings & {
  layerId: typeof MAP_3D_LAYER_ID;
  provider: "google" | "url";
  /** 3D Tiles tileset.json URL for the "url" provider. */
  tilesetUrl: string;
  /** Screen-space error target in pixels; lower is more detailed. */
  errorTarget: number;
  altitudeMode: "fix" | "fixed";
  /** Meters above the WGS 84 ellipsoid at the location fix, for "fixed". */
  altitudeReference: number;
  altitudeOffset: number;
};

type AnyMapSettings = LayerSettingsMap | LayerSettingsMap3D;

const DEFAULT_MAP: LayerSettingsMap = {
  visible: true,
  frameLocked: true,
  label: "Map",
  instanceId: "invalid",
  layerId: MAP_LAYER_ID,
  source: "ofm-liberty",
  customUrl: "",
  customKind: "raster",
  terrain: "",
  exaggeration: 1,
  size: 500,
  opacity: 1,
  zOffset: 0,
};

const DEFAULT_MAP_3D: LayerSettingsMap3D = {
  visible: true,
  frameLocked: true,
  label: "3D Map",
  instanceId: "invalid",
  layerId: MAP_3D_LAYER_ID,
  provider: "google",
  tilesetUrl: "",
  errorTarget: 20,
  altitudeMode: "fix",
  altitudeReference: 0,
  altitudeOffset: 0,
};

const withDefaults = (config: Partial<AnyMapSettings>): AnyMapSettings =>
  config.layerId === MAP_3D_LAYER_ID
    ? { ...DEFAULT_MAP_3D, ...config }
    : { ...DEFAULT_MAP, ...(config as Partial<LayerSettingsMap>) };

/** The geographic position of a point in the ENU frame. */
type Anchor = LatLon & {
  /** Meters above the WGS 84 ellipsoid, if the fix had one. */
  altitude?: number;
  enuFrame: string;
  position: THREE.Vector3;
};

// The Google key is a per-user secret, so it lives in the browser rather than the shared layout.
const GOOGLE_KEY_STORAGE = "lichtblick.threeDee.googleMapsApiKey";
function loadGoogleKey(): string {
  try {
    return localStorage.getItem(GOOGLE_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}
function storeGoogleKey(key: string): void {
  try {
    localStorage.setItem(GOOGLE_KEY_STORAGE, key);
  } catch {
    // Storage unavailable: the key lasts until reload.
  }
}

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&copy;/g, "©");

/** Canvas size of the offscreen map render; 500 m maps get ~0.25 m/px. */
const CANVAS_SIZE = 2048;
const TERRAIN_SEGMENTS = 128;
const URL_DEBOUNCE_MS = 500;

type MapUserData = BaseUserData & { settings: AnyMapSettings };

abstract class MapRenderable extends Renderable<MapUserData> {
  public override readonly pickable = false;
  public abstract applySettings(settings: AnyMapSettings): void;
  public abstract locate(anchor: Anchor | undefined, fix: LatLon | undefined): void;
  public abstract attribution(): string;
  public error?: string;

  protected setError(error: string | undefined): void {
    this.error = error;
    const path = this.userData.settingsPath;
    if (error) {
      this.renderer.settings.errors.add(path, "map", error);
    } else {
      this.renderer.settings.errors.remove(path, "map");
    }
  }
}

/** A 2D basemap rendered by an offscreen MapLibre map onto a (optionally terrain-shaped) plane. */
class BasemapRenderable extends MapRenderable {
  #mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    // Blend in the opaque pass so renderOrder can draw the map before everything else.
    new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      // MapLibre's pixels are premultiplied; applySettings() premultiplies opacity via color.
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  #container?: HTMLDivElement;
  #map?: MapLibreMap;
  #mapPromise?: Promise<MapLibreMap>;
  #styleKey?: string;
  #attribution = "";
  #anchor?: Anchor;
  #center?: LatLon;
  #geometryKey?: string;
  #anchorElevation?: number;
  #demAbort?: AbortController;
  #styleAbort?: AbortController;

  public constructor(name: string, renderer: IRenderer, userData: MapUserData) {
    super(name, renderer, userData);
    this.#mesh.visible = false;
    this.add(this.#mesh);
  }

  #settings(): LayerSettingsMap {
    return this.userData.settings as LayerSettingsMap;
  }

  public override dispose(): void {
    this.#demAbort?.abort();
    this.#updateStyleSoon.cancel();
    this.#styleAbort?.abort();
    this.#map?.remove();
    this.#container?.remove();
    this.#mesh.material.map?.dispose();
    this.#mesh.material.dispose();
    this.#mesh.geometry.dispose();
    super.dispose();
  }

  public attribution(): string {
    return this.#attribution;
  }

  public applySettings(settings: AnyMapSettings): void {
    this.userData.settings = settings;
    const s = this.#settings();
    const material = this.#mesh.material;
    const drawBehind = s.drawBehind ?? s.terrain === "";
    material.opacity = s.opacity;
    material.color.setScalar(s.opacity);
    material.depthTest = !drawBehind;
    material.depthWrite = !drawBehind;
    material.needsUpdate = true;
    this.#mesh.renderOrder = drawBehind ? -1_000_000 : 0;
    this.#updateStyleSoon();
    this.#updateGeometry();
  }

  public locate(anchor: Anchor | undefined, fix: LatLon | undefined): void {
    if (anchor !== this.#anchor) {
      this.#anchor = anchor;
      this.#anchorElevation = undefined;
      this.#center = undefined;
    }
    if (!anchor || !fix) {
      this.#mesh.visible = false;
      return;
    }
    // Re-center once the vehicle leaves the middle half, so the map always surrounds it.
    const { east, north } = this.#center ? enuOffset(this.#center, fix) : { east: 0, north: 0 };
    if (!this.#center || Math.max(Math.abs(east), Math.abs(north)) > this.#settings().size / 4) {
      this.#center = { lat: fix.lat, lon: fix.lon };
      this.#updateGeometry();
    }
  }

  #source(): SourceParams | undefined {
    const s = this.#settings();
    if (s.source === "custom") {
      return s.customUrl.trim() ? { kind: s.customKind, url: s.customUrl.trim() } : undefined;
    }
    const preset = PRESETS[s.source];
    return preset?.kind === "raster" || preset?.kind === "vector" ? preset : undefined;
  }

  // URL fields update on every keystroke; load once typing pauses.
  #updateStyleSoon = _.debounce(() => void this.#updateStyle(), URL_DEBOUNCE_MS);

  async #updateStyle(): Promise<void> {
    const source = this.#source();
    const key = JSON.stringify(source);
    if (key === this.#styleKey) {
      return;
    }
    this.#styleKey = key;
    this.#styleAbort?.abort();
    if (!source) {
      this.setError("Choose a map source");
      return;
    }
    const abort = (this.#styleAbort = new AbortController());
    try {
      const vectorStyles = new Map<string, StyleSpecification>();
      if (source.kind === "vector") {
        const vector = await fetchVectorStyle(source.url, abort.signal);
        vectorStyles.set(source.url, vector);
        this.#attribution = _.uniq(
          Object.values(vector.sources).flatMap((src) =>
            "attribution" in src && src.attribution ? [stripHtml(src.attribution)] : [],
          ),
        ).join(" ");
      } else {
        this.#attribution = stripHtml(source.attribution ?? "");
      }
      const style = composeStyle({
        layers: [{ id: "basemap", source: "custom", custom: source, visible: true, opacity: 1 }],
        vectorStyles,
        images: new Map(),
        projection: "mercator",
        overlay: { sources: {}, layers: [] },
      });
      const map = await this.#getMap();
      if (abort.signal.aborted) {
        return;
      }
      map.setStyle(style);
      this.setError(undefined);
    } catch (error) {
      if (!abort.signal.aborted) {
        this.setError(`Failed to load map style: ${String(error)}`);
      }
    }
  }

  async #getMap(): Promise<MapLibreMap> {
    return await (this.#mapPromise ??= this.#createMap());
  }

  async #createMap(): Promise<MapLibreMap> {
    const maplibre = await import("@lichtblick/suite-base/panels/Map/maplibre");
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "fixed",
      left: "-100000px",
      top: "0",
      width: `${CANVAS_SIZE}px`,
      height: `${CANVAS_SIZE}px`,
      pointerEvents: "none",
    });
    document.body.appendChild(container);
    const map = new maplibre.Map({
      container,
      style: { version: 8, sources: {}, layers: [] },
      interactive: false,
      attributionControl: false,
      pixelRatio: 1,
      fadeDuration: 0,
      maxZoom: 24,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    // Copy pixels explicitly rather than texturing from MapLibre's canvas: drawing another
    // context's canvas may use its last composited frame, which isn't defined off-screen.
    const pixels = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE * 4);
    const texture = new THREE.DataTexture(pixels, CANVAS_SIZE, CANVAS_SIZE, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = this.renderer.gl.capabilities.getMaxAnisotropy();
    this.#mesh.material.map = texture;
    this.#mesh.material.needsUpdate = true;
    const canvas = map.getCanvas();
    // getContext() returns MapLibre's existing context for its type, null for the other.
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const copy = () => {
      gl?.readPixels(0, 0, CANVAS_SIZE, CANVAS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      texture.needsUpdate = true;
      this.renderer.queueAnimationFrame();
    };
    // ponytail: a 16 MB readback per copy, so at most 4/s while tiles stream in, then on idle.
    const throttledCopy = _.throttle(copy, 250, { leading: false });
    map.on("render", throttledCopy);
    map.on("idle", () => {
      throttledCopy.cancel();
      copy();
    });
    this.#container = container;
    this.#map = map;
    this.#jumpMap();
    return map;
  }

  #jumpMap(): void {
    if (this.#map && this.#center) {
      this.#map.jumpTo({
        center: [this.#center.lon, this.#center.lat],
        zoom: zoomForSpan(this.#center.lat, this.#settings().size, CANVAS_SIZE),
        bearing: 0,
        pitch: 0,
      });
    }
  }

  #updateGeometry(): void {
    const s = this.#settings();
    const anchor = this.#anchor;
    const center = this.#center;
    if (!anchor || !center) {
      return;
    }
    const dem = PRESETS[s.terrain]?.kind === "dem" ? (PRESETS[s.terrain] as DemSource) : undefined;
    const key = JSON.stringify([center, s.size, s.terrain, s.exaggeration, s.zOffset]);
    if (key === this.#geometryKey) {
      return;
    }
    this.#geometryKey = key;
    void this.#getMap().then(() => {
      this.#jumpMap();
    });

    const { east, north } = enuOffset(anchor, center);
    this.#mesh.position.set(anchor.position.x + east, anchor.position.y + north, s.zOffset);
    this.#mesh.visible = true;

    const segments = dem ? TERRAIN_SEGMENTS : 1;
    const geometry = new THREE.PlaneGeometry(s.size, s.size, segments, segments);
    this.#mesh.geometry.dispose();
    this.#mesh.geometry = geometry;
    this.#demAbort?.abort();
    this.renderer.queueAnimationFrame();
    if (!dem) {
      return;
    }

    const abort = (this.#demAbort = new AbortController());
    loadDem(dem, center, s.size, s.size / segments, abort.signal)
      .then((tiles) => {
        if (!abort.signal.aborted) {
          this.#applyTerrain(geometry, tiles, center, anchor);
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          log.warn("Failed to load terrain", error);
          this.setError(`Failed to load terrain: ${String(error)}`);
        }
      });
  }

  #applyTerrain(
    geometry: THREE.PlaneGeometry,
    dem: DemTiles,
    center: LatLon,
    anchor: Anchor,
  ): void {
    const s = this.#settings();
    // The location fix sits on the ENU plane; terrain is relative to the ground there.
    this.#anchorElevation ??= sampleElevation(dem, toMercator(anchor));
    const origin = toMercator(center);
    const scale = metersPerMercator(center.lat);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const point = {
        x: origin.x + positions.getX(i) / scale,
        y: origin.y - positions.getY(i) / scale,
      };
      positions.setZ(i, (sampleElevation(dem, point) - this.#anchorElevation) * s.exaggeration);
    }
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
    this.renderer.queueAnimationFrame();
  }
}

/** Photorealistic or custom 3D Tiles, placed in the ENU frame at the location fix. */
class TilesetRenderable extends MapRenderable {
  #tiles?: TilesRenderer;
  #tilesKey?: string;
  #group = new THREE.Group();
  #camera?: THREE.Camera;
  #anchor?: Anchor;
  #ellipsoid?: typeof import("3d-tiles-renderer").WGS84_ELLIPSOID;

  public constructor(name: string, renderer: IRenderer, userData: MapUserData) {
    super(name, renderer, userData);
    this.#group.matrixAutoUpdate = false;
    this.#group.visible = false;
    this.add(this.#group);
  }

  #settings(): LayerSettingsMap3D {
    return this.userData.settings as LayerSettingsMap3D;
  }

  public override dispose(): void {
    this.#tilesKey = undefined;
    this.#loadTilesSoon.cancel();
    this.#tiles?.dispose();
    super.dispose();
  }

  public attribution(): string {
    if (!this.#tiles || this.#settings().provider !== "google") {
      return "";
    }
    const credits = this.#tiles.getAttributions().map((a) => String(a.value));
    return ["Google", ...credits].filter(Boolean).join(" ");
  }

  public applySettings(settings: AnyMapSettings): void {
    this.userData.settings = settings;
    const s = this.#settings();
    const key = s.provider === "google" ? `google:${loadGoogleKey()}` : `url:${s.tilesetUrl}`;
    if (this.#tiles) {
      this.#tiles.errorTarget = s.errorTarget;
    }
    this.#placeGroup();
    if (key !== this.#tilesKey) {
      this.#tilesKey = key;
      this.#loadTilesSoon(key);
    }
  }

  #loadTilesSoon = _.debounce((key: string) => void this.#loadTiles(key), URL_DEBOUNCE_MS);

  async #loadTiles(key: string): Promise<void> {
    this.#tiles?.dispose();
    this.#tiles = undefined;
    this.#group.clear();
    const s = this.#settings();
    const apiKey = loadGoogleKey();
    if (s.provider === "google" ? !apiKey : !s.tilesetUrl.trim()) {
      this.setError(
        s.provider === "google"
          ? "Enter a Google Maps Platform API key with the Map Tiles API enabled"
          : "Enter a 3D Tiles tileset.json URL",
      );
      return;
    }
    const { TilesRenderer, WGS84_ELLIPSOID } = await import("3d-tiles-renderer");
    const { GoogleCloudAuthPlugin, GLTFExtensionsPlugin } = await import(
      "3d-tiles-renderer/plugins"
    );
    if (key !== this.#tilesKey) {
      return; // Settings changed while loading.
    }
    const tiles = new TilesRenderer(s.provider === "url" ? s.tilesetUrl.trim() : undefined);
    if (s.provider === "google") {
      tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    }
    tiles.registerPlugin(
      // The typings mark every option required; these are the library defaults.
      new GLTFExtensionsPlugin({
        metadata: true,
        rtc: true,
        plugins: [],
        dracoLoader: createBundledDracoLoader(),
        ktxLoader: null,
        autoDispose: true,
      }),
    );
    tiles.errorTarget = s.errorTarget;
    const rerender = () => {
      this.renderer.queueAnimationFrame();
    };
    tiles.addEventListener("load-model", rerender);
    tiles.addEventListener("load-tile-set", () => {
      this.setError(undefined);
      rerender();
    });
    tiles.addEventListener("load-error", (event: { error?: unknown }) => {
      this.setError(`Failed to load 3D tiles: ${String(event.error)}`);
    });
    this.#tiles = tiles;
    this.#ellipsoid = WGS84_ELLIPSOID;
    this.#camera = undefined;
    this.#group.add(tiles.group);
    this.#placeGroup();
  }

  public locate(anchor: Anchor | undefined): void {
    if (anchor !== this.#anchor) {
      this.#anchor = anchor;
      this.#placeGroup();
    }
  }

  /** Maps Earth-centered coordinates into the ENU frame so the fix lands on its frame. */
  #placeGroup(): void {
    const anchor = this.#anchor;
    this.#group.visible = anchor != undefined;
    if (!anchor || !this.#ellipsoid) {
      return;
    }
    const s = this.#settings();
    const altitude = (s.altitudeMode === "fixed" ? s.altitudeReference : anchor.altitude) ?? 0;
    const ellipsoidToEnu = new THREE.Matrix4();
    // The ellipsoid's ENU frame has its origin at height 0 under the fix.
    this.#ellipsoid.getEastNorthUpFrame(
      THREE.MathUtils.degToRad(anchor.lat),
      THREE.MathUtils.degToRad(anchor.lon),
      ellipsoidToEnu,
    );
    ellipsoidToEnu.invert();
    this.#group.matrix
      .makeTranslation(
        anchor.position.x,
        anchor.position.y,
        anchor.position.z - altitude + s.altitudeOffset,
      )
      .multiply(ellipsoidToEnu);
    this.#group.matrixWorldNeedsUpdate = true;
    this.renderer.queueAnimationFrame();
  }

  public updateTiles(): void {
    const tiles = this.#tiles;
    if (!tiles || !this.visible || !this.#group.visible) {
      return;
    }
    const camera = this.renderer.cameraHandler.getActiveCamera();
    if (camera !== this.#camera) {
      if (this.#camera) {
        tiles.deleteCamera(this.#camera);
      }
      tiles.setCamera(camera);
      this.#camera = camera;
    }
    tiles.setResolutionFromRenderer(camera, this.renderer.gl);
    camera.updateMatrixWorld();
    this.updateMatrixWorld(true);
    tiles.update();
  }
}

export class Maps extends SceneExtension<MapRenderable> {
  public static extensionId = "lichtblick.Maps";
  #fixes = new Map<string, MessageEvent<LocationMessage>>();
  #anchors = new Map<string, Anchor>();

  public constructor(renderer: IRenderer, name: string = Maps.extensionId) {
    super(name, renderer);
    renderer.addCustomLayerAction({
      layerId: MAP_LAYER_ID,
      label: t("threeDee:addMap"),
      icon: "Map",
      handler: (instanceId) => {
        this.#addLayer(instanceId, DEFAULT_MAP);
      },
    });
    renderer.addCustomLayerAction({
      layerId: MAP_3D_LAYER_ID,
      label: t("threeDee:add3DMap"),
      icon: "Map",
      handler: (instanceId) => {
        this.#addLayer(instanceId, DEFAULT_MAP_3D);
      },
    });
    renderer.on("transformTreeUpdated", this.#handleTransformTreeUpdated);
    for (const [instanceId, entry] of Object.entries(renderer.config.layers)) {
      if (entry?.layerId === MAP_LAYER_ID || entry?.layerId === MAP_3D_LAYER_ID) {
        this.#updateLayer(instanceId, entry as Partial<AnyMapSettings>);
      }
    }
  }

  public override dispose(): void {
    this.renderer.off("transformTreeUpdated", this.#handleTransformTreeUpdated);
    this.renderer.hud.removeGroup(Maps.extensionId);
    super.dispose();
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: LOCATION_SCHEMAS,
        subscription: {
          handler: this.#handleLocation,
          filterQueue: onlyLastByTopicMessage,
          shouldSubscribe: (topic) =>
            [...this.renderables.values()].some(
              (r) =>
                r.userData.settings.visible && this.#locationTopic(r.userData.settings) === topic,
            ),
        },
      },
    ];
  }

  public override removeAllRenderables(): void {
    // Keep the (expensive) maps; re-anchor at the next fix after a seek or source change.
    this.#fixes.clear();
    this.#anchors.clear();
  }

  #locationTopic(settings: AnyMapSettings): string | undefined {
    return (
      settings.locationTopic ??
      this.renderer.topics?.find((topic) => topicIsConvertibleToSchema(topic, LOCATION_SCHEMAS))
        ?.name
    );
  }

  #handleLocation = (event: MessageEvent<LocationMessage>): void => {
    const { latitude, longitude, status } = event.message;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > MAX_LATITUDE ||
      Math.abs(longitude) > 180 ||
      (status != undefined && status.status < 0) // STATUS_NO_FIX
    ) {
      return;
    }
    this.#fixes.set(event.topic, event);
    this.renderer.queueAnimationFrame();
  };

  #handleTransformTreeUpdated = (): void => {
    this.updateSettingsTree();
  };

  /** Where the fix's frame is in the ENU frame at the fix's time. */
  #makeAnchor(
    event: MessageEvent<LocationMessage>,
    enuFrame: string,
    fixedFrameId: string,
  ): Anchor | undefined {
    const message = event.message;
    const frameId = this.renderer.normalizeFrameId(
      message.header?.frame_id ?? message.frame_id ?? "",
    );
    const stamp = normalizeTime(message.header?.stamp ?? message.timestamp);
    const time =
      stamp.sec === 0 && stamp.nsec === 0 ? toNanoSec(event.receiveTime) : toNanoSec(stamp);
    const pose = makePose();
    const known = frameId !== "" && this.renderer.transformTree.frame(frameId) != undefined;
    if (
      known &&
      !this.renderer.transformTree.apply(pose, pose, enuFrame, fixedFrameId, frameId, time, time)
    ) {
      return undefined; // Transform not available yet.
    }
    // A fix in an unknown frame (e.g. a GPS-only recording) sits at the ENU frame's origin.
    const altitude = message.altitude;
    return {
      lat: message.latitude,
      lon: message.longitude,
      altitude: altitude != undefined && Number.isFinite(altitude) ? altitude : undefined,
      enuFrame,
      position: new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z),
    };
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    for (const [instanceId, renderable] of this.renderables) {
      const settings = renderable.userData.settings;
      const enuFrame = settings.enuFrame ?? fixedFrameId;
      const event = this.#fixes.get(this.#locationTopic(settings) ?? "");
      let anchor = this.#anchors.get(instanceId);
      if (event && anchor?.enuFrame !== enuFrame) {
        anchor = this.#makeAnchor(event, enuFrame, fixedFrameId);
        if (anchor) {
          this.#anchors.set(instanceId, anchor);
        }
      }
      renderable.userData.frameId = enuFrame;
      renderable.locate(
        anchor,
        event && { lat: event.message.latitude, lon: event.message.longitude },
      );

      this.renderer.hud.displayIfTrue(settings.visible && anchor == undefined, {
        id: `${instanceId}:waiting`,
        group: Maps.extensionId,
        displayType: "notice",
        getMessage: () =>
          event
            ? `${settings.label}: waiting for the transform to the location fix frame`
            : `${settings.label}: waiting for a location fix`,
      });
      // ponytail: the HUD re-reads the text only when items change; fine for rarely changing credits.
      this.renderer.hud.displayIfTrue(
        settings.visible && anchor != undefined && renderable.attribution() !== "",
        {
          id: `${instanceId}:attribution`,
          group: Maps.extensionId,
          displayType: "attribution",
          getMessage: () => renderable.attribution(),
        },
      );
    }
    super.startFrame(currentTime, renderFrameId, fixedFrameId);
    for (const renderable of this.renderables.values()) {
      if (renderable instanceof TilesetRenderable) {
        renderable.updateTiles();
      }
    }
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const entries: SettingsTreeEntry[] = [];
    const locationTopics = (this.renderer.topics ?? []).filter((topic) =>
      topicIsConvertibleToSchema(topic, LOCATION_SCHEMAS),
    );
    for (const [instanceId, layerConfig] of Object.entries(this.renderer.config.layers)) {
      if (layerConfig?.layerId !== MAP_LAYER_ID && layerConfig?.layerId !== MAP_3D_LAYER_ID) {
        continue;
      }
      const config = withDefaults(layerConfig as Partial<AnyMapSettings>);
      const fields: SettingsTreeFields =
        config.layerId === MAP_LAYER_ID ? basemapFields(config) : tilesetFields(config);
      fields.locationTopic = {
        label: "Location topic",
        input: "select",
        options: [
          { label: "Auto", value: undefined },
          ...locationTopics.map((topic) => ({ label: topic.name, value: topic.name })),
        ],
        value: config.locationTopic,
        help: "NavSatFix or LocationFix topic that places the map. Its frame_id must be in the transform tree, or the fix is placed at the ENU frame's origin.",
      };
      fields.enuFrame = {
        label: "ENU frame",
        input: "select",
        options: [
          { label: "<Fixed frame>", value: undefined },
          ...this.renderer.coordinateFrameList,
        ],
        value: config.enuFrame,
        help: "Frame whose X axis points east, Y north and Z up.",
      };
      entries.push({
        path: ["layers", instanceId],
        node: {
          label: config.label,
          icon: "Map",
          fields,
          visible: config.visible,
          actions: [{ type: "action", id: "delete", label: t("threeDee:delete") }],
          order: layerConfig.order,
          handler: this.handleSettingsAction,
        },
      });
      if (!this.renderables.has(instanceId)) {
        this.#updateLayer(instanceId, config);
      }
    }
    return entries;
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    if (action.action === "reorder-node") {
      return;
    }
    const path = action.payload.path;
    const instanceId = path[1]!;
    if (action.action === "perform-node-action") {
      if (path.length === 2 && action.payload.id === "delete") {
        this.renderer.updateConfig((draft) => {
          delete draft.layers[instanceId];
        });
        this.#updateLayer(instanceId, undefined);
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      }
      return;
    }
    if (path.length !== 3) {
      return;
    }
    if (path[2] === "googleApiKey") {
      storeGoogleKey(String(action.payload.value ?? "").trim());
      this.updateSettingsTree();
    } else {
      this.saveSetting(path, action.payload.value);
    }
    if (path[2] === "enuFrame") {
      this.#anchors.delete(instanceId);
    }
    this.#updateLayer(
      instanceId,
      this.renderer.config.layers[instanceId] as Partial<AnyMapSettings> | undefined,
    );
  };

  #addLayer(instanceId: string, defaults: AnyMapSettings): void {
    log.info(`Creating ${defaults.layerId} layer ${instanceId}`);
    const config = { ...defaults, instanceId };
    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = _.maxBy(Object.values(draft.layers), (layer) => layer?.order);
      draft.layers[instanceId] = { ...config, order: 1 + (maxOrderLayer?.order ?? 0) };
    });
    this.#updateLayer(instanceId, config);
    this.updateSettingsTree();
  }

  #updateLayer(instanceId: string, config: Partial<AnyMapSettings> | undefined): void {
    let renderable = this.renderables.get(instanceId);
    if (config == undefined) {
      if (renderable) {
        renderable.dispose();
        this.remove(renderable);
        this.renderables.delete(instanceId);
        this.#anchors.delete(instanceId);
        this.renderer.hud.removeGroup(Maps.extensionId);
      }
      return;
    }
    const settings = withDefaults(config);
    if (!renderable) {
      const userData: MapUserData = {
        receiveTime: 0n,
        messageTime: 0n,
        frameId: "", // Set in startFrame()
        pose: makePose(),
        settingsPath: ["layers", instanceId],
        settings,
      };
      renderable =
        settings.layerId === MAP_3D_LAYER_ID
          ? new TilesetRenderable(instanceId, this.renderer, userData)
          : new BasemapRenderable(instanceId, this.renderer, userData);
      this.add(renderable);
      this.renderables.set(instanceId, renderable);
    }
    renderable.applySettings(settings);
    this.renderer.queueAnimationFrame();
  }
}

function basemapFields(config: LayerSettingsMap): SettingsTreeFields {
  const presets = Object.entries(PRESETS).filter(
    ([, preset]) => preset.kind === "raster" || preset.kind === "vector",
  );
  const fields: SettingsTreeFields = {
    source: {
      label: "Map",
      input: "select",
      options: [
        ...presets.map(([value, preset]) => ({ label: preset.label, value })),
        { label: "Custom", value: "custom" },
      ],
      value: config.source,
    },
  };
  if (config.source === "custom") {
    fields.customKind = {
      label: "Source type",
      input: "toggle",
      options: [
        { label: "Raster tiles", value: "raster" },
        { label: "Vector style", value: "vector" },
      ],
      value: config.customKind,
    };
    fields.customUrl = {
      label: "URL",
      input: "string",
      value: config.customUrl,
      placeholder:
        config.customKind === "vector"
          ? "https://example.com/style.json"
          : "https://example.com/{z}/{x}/{y}.png",
      help:
        config.customKind === "vector"
          ? "MapLibre style JSON URL"
          : "XYZ template with {z} {x} {y}, a TileJSON URL, or pmtiles://https://…",
    };
  }
  fields.terrain = {
    label: "Terrain",
    input: "select",
    options: [
      { label: "Flat", value: "" },
      ...Object.entries(PRESETS)
        .filter(([, preset]) => preset.kind === "dem")
        .map(([value, preset]) => ({ label: preset.label, value })),
    ],
    value: config.terrain,
    help: "Shape the map with an elevation model. Ground height at the location fix is placed at Z offset.",
  };
  if (config.terrain !== "") {
    fields.exaggeration = {
      label: "Exaggeration",
      input: "number",
      min: 0,
      step: 0.5,
      precision: 2,
      value: config.exaggeration,
    };
  }
  fields.size = {
    label: t("threeDee:size"),
    input: "number",
    min: 20,
    max: 20000,
    step: 100,
    precision: 0,
    value: config.size,
    help: "Side length in meters. The map re-centers as the location moves.",
  };
  fields.opacity = {
    label: "Opacity",
    input: "number",
    min: 0,
    max: 1,
    step: 0.1,
    precision: 2,
    value: config.opacity,
  };
  fields.zOffset = {
    label: "Z offset",
    input: "number",
    step: 0.1,
    precision: PRECISION_DISTANCE,
    value: config.zOffset,
    help: "Height in meters above the ENU frame's XY plane",
  };
  fields.drawBehind = {
    label: "Draw behind",
    input: "boolean",
    value: config.drawBehind ?? config.terrain === "",
    help: "Draw the map under everything else regardless of depth",
  };
  return fields;
}

function tilesetFields(config: LayerSettingsMap3D): SettingsTreeFields {
  const fields: SettingsTreeFields = {
    provider: {
      label: "Provider",
      input: "select",
      options: [
        { label: "Google Photorealistic 3D Tiles", value: "google" },
        { label: "Custom 3D Tiles URL", value: "url" },
      ],
      value: config.provider,
    },
  };
  if (config.provider === "google") {
    fields.googleApiKey = {
      label: "API key",
      input: "string",
      value: loadGoogleKey(),
      placeholder: "Google Maps Platform key",
      help: "Needs the Map Tiles API. Stored in this browser only, not in the layout.",
    };
  } else {
    fields.tilesetUrl = {
      label: "Tileset URL",
      input: "string",
      value: config.tilesetUrl,
      placeholder: "https://example.com/tileset.json",
    };
  }
  fields.errorTarget = {
    label: "Pixels per facet",
    input: "number",
    min: 1,
    step: 2,
    precision: 0,
    value: config.errorTarget,
    help: "Lower is more detailed but loads more data",
  };
  fields.altitudeMode = {
    label: "Altitude",
    input: "select",
    options: [
      { label: "Location fix altitude", value: "fix" },
      { label: "Fixed reference", value: "fixed" },
    ],
    value: config.altitudeMode,
    help: "Ellipsoidal (WGS 84) height of the location fix frame, used to align the map vertically",
  };
  if (config.altitudeMode === "fixed") {
    fields.altitudeReference = {
      label: "Altitude reference",
      input: "number",
      step: 1,
      precision: 2,
      value: config.altitudeReference,
    };
  }
  fields.altitudeOffset = {
    label: "Altitude offset",
    input: "number",
    step: 0.5,
    precision: 2,
    value: config.altitudeOffset,
  };
  return fields;
}
