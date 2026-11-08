// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { TilesRenderer } from "3d-tiles-renderer";
import { toNanoSec } from "@foxglove/rostime";
import { t } from "i18next";
import * as _ from "lodash-es";
import type { ErrorEvent as MapErrorEvent, StyleSpecification } from "maplibre-gl";
import * as THREE from "three";

import Logger from "@lichtblick/log";
import { MessageEvent, SettingsTreeAction, Time } from "@lichtblick/suite";
import { loadGeoTiff } from "@lichtblick/suite-base/panels/Map/geotiff";
import {
  MAP_SOURCE_KINDS,
  applyLayerStackAction,
  layerStackActions,
  layerStackChildren,
} from "@lichtblick/suite-base/panels/Map/layerSettings";
import {
  ImageOverlay,
  MapLayer,
  SourceKind,
  SourceParams,
  composeStyle,
  fetchVectorStyle,
  resolveSource,
} from "@lichtblick/suite-base/panels/Map/layers";
import {
  forgetSavedSources,
  loadSavedSources,
  rememberSource,
} from "@lichtblick/suite-base/panels/Map/savedSources";

import type { AnyRendererSubscription, IRenderer } from "../IRenderer";
import { createBundledDracoLoader } from "../ModelCache";
import { BaseUserData, Renderable } from "../Renderable";
import { SceneExtension, onlyLastByTopicMessage } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import type { MapAnchor } from "../SharedMap";
import { normalizeTime } from "../normalizeMessages";
import { CustomLayerSettings, PRECISION_DISTANCE } from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose } from "../transforms";

const log = Logger.getLogger(__filename);

const LAYER_ID = "lichtblick.Map";
const MAX_LATITUDE = 85.051129;

/** The 3D panel renders 3D Tiles on top of what the Map panel offers. */
const SOURCE_KINDS: readonly SourceKind[] = [...MAP_SOURCE_KINDS, "3dtiles"];

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

export type LayerSettingsMap = CustomLayerSettings & {
  layerId: typeof LAYER_ID;
  /** The Map panel's layer stack, top-most first. */
  layers: MapLayer[];
  zOffset: number;
  /** Location fix topic; undefined picks the first one. */
  locationTopic?: string;
  /** Override the location fix's frame, for recordings without a frame_id. */
  locationFrame?: string;
  /** Frame whose XY plane is east/north; undefined uses the fixed frame. */
  enuFrame?: string;
};

const DEFAULT_SETTINGS: LayerSettingsMap = {
  visible: true,
  frameLocked: true,
  label: "Map",
  instanceId: "invalid",
  layerId: LAYER_ID,
  layers: [{ id: "base", source: "ofm-liberty", visible: true, opacity: 1 }],
  zOffset: 0,
};

const withDefaults = (config: Partial<LayerSettingsMap>): LayerSettingsMap => ({
  ...DEFAULT_SETTINGS,
  ...config,
});

/** The geographic position of a point in the ENU frame. */
type Anchor = MapAnchor;

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&copy;/g, "©");

const URL_DEBOUNCE_MS = 500;

type MapUserData = BaseUserData & { settings: LayerSettingsMap };

type Tileset = { url: string; tiles: TilesRenderer; group: THREE.Group; camera?: THREE.Camera };

/** MapLibre style sources and geographically placed 3D Tiles for a map layer. */
class MapRenderable extends Renderable<MapUserData> {
  public override readonly pickable = false;
  /** Load and render errors by MapLayer id. */
  public readonly layerErrors = new Map<string, string>();
  #onErrorsChanged: () => void;

  #styleKey?: string;
  #styleRequest = 0;
  #assets = new Map<string, Promise<StyleSpecification | ImageOverlay>>();
  #attribution = "";
  #anchor?: Anchor;
  #tilesets = new Map<string, Tileset>();
  /** Async loads check this so nothing is created after dispose(). */
  #disposed = false;

  public constructor(
    name: string,
    renderer: IRenderer,
    userData: MapUserData,
    onErrorsChanged: () => void,
  ) {
    super(name, renderer, userData);
    this.#onErrorsChanged = onErrorsChanged;
    if (renderer.sharedMap?.layerId === name) {
      renderer.sharedMap.map.on("error", this.#handleMapError);
    }
  }

  public override dispose(): void {
    if (this.renderer.sharedMap?.layerId === this.name) {
      this.renderer.sharedMap.map.off("error", this.#handleMapError);
    }
    this.#disposed = true;
    this.#updateSoon.cancel();
    for (const asset of this.#assets.values()) {
      void asset.then((value) => {
        if ("coordinates" in value) {
          URL.revokeObjectURL(value.url);
        }
      }, _.noop);
    }
    for (const tileset of this.#tilesets.values()) {
      tileset.tiles.dispose();
    }
    super.dispose();
  }

  public attribution(): string {
    return this.#attribution;
  }

  #setLayerError(layerId: string, error: string | undefined): void {
    if (this.layerErrors.get(layerId) === error) {
      return;
    }
    if (error) {
      this.layerErrors.set(layerId, error);
    } else {
      this.layerErrors.delete(layerId);
    }
    this.#onErrorsChanged();
  }

  #handleMapError = (event: MapErrorEvent & { sourceId?: string }): void => {
    const layerId = event.sourceId?.split(":")[0];
    if (layerId) {
      this.#setLayerError(layerId, event.error.message);
    }
  };

  public applySettings(settings: LayerSettingsMap): void {
    this.userData.settings = settings;
    this.#updateSoon();
    this.#placeTilesets();
  }

  public locate(anchor: Anchor | undefined): void {
    if (this.renderer.sharedMap?.layerId === this.name) {
      this.renderer.sharedMap.locate(anchor, this.userData.settings.zOffset);
    }
    if (anchor !== this.#anchor) {
      this.#anchor = anchor;
      this.#placeTilesets();
    }
  }

  // URL fields update on every keystroke; load once typing pauses.
  #updateSoon = _.debounce(() => {
    // Rejects only when the layer is removed mid-load.
    this.#updateStyle().catch(_.noop);
    this.#syncTilesets().catch(_.noop);
  }, URL_DEBOUNCE_MS);

  /** Vector styles and GeoTIFFs, fetched once per URL. */
  async #asset(
    params: SourceParams,
    signal: AbortSignal,
  ): Promise<StyleSpecification | ImageOverlay> {
    const key = `${params.kind}|${params.url}`;
    let asset = this.#assets.get(key);
    if (!asset) {
      asset =
        params.kind === "vector"
          ? fetchVectorStyle(params.url, signal)
          : loadGeoTiff(params.url, signal);
      this.#assets.set(key, asset);
      // Retry failed URLs on the next settings change.
      asset.catch(() => this.#assets.delete(key));
    }
    return await asset;
  }

  async #updateStyle(): Promise<void> {
    const sharedMap = this.renderer.sharedMap;
    if (sharedMap?.layerId !== this.name) {
      return;
    }
    const layers = this.userData.settings.layers.filter((layer) => layer.visible);
    const key = JSON.stringify(layers);
    if (key === this.#styleKey) {
      return;
    }
    this.#styleKey = key;
    const request = ++this.#styleRequest;
    const vectorStyles = new Map<string, StyleSpecification>();
    const images = new Map<string, ImageOverlay>();
    const errors = new Map<string, string>();
    const attributions: string[] = [];
    // ponytail: stale loads finish in the background and land in the cache; never aborted.
    const signal = new AbortController().signal;
    await Promise.all(
      layers.map(async (layer) => {
        const params = resolveSource(layer);
        if (!params) {
          return;
        }
        if (params.attribution) {
          attributions.push(stripHtml(params.attribution));
        }
        if (params.kind !== "vector" && params.kind !== "geotiff") {
          return;
        }
        try {
          const asset = await this.#asset(params, signal);
          if ("coordinates" in asset) {
            images.set(params.url, asset);
          } else {
            vectorStyles.set(params.url, asset);
            for (const source of Object.values(asset.sources)) {
              if ("attribution" in source && source.attribution) {
                attributions.push(stripHtml(source.attribution));
              }
            }
          }
          if (layer.source === "custom") {
            rememberSource(params);
          }
        } catch (error) {
          errors.set(layer.id, `Failed to load: ${String(error)}`);
        }
      }),
    );
    if (this.#disposed || request !== this.#styleRequest) {
      return;
    }
    if (errors.size > 0) {
      this.#styleKey = undefined; // Retry failed loads on the next settings change.
    }
    for (const layer of this.userData.settings.layers) {
      if (resolveSource(layer)?.kind !== "3dtiles") {
        this.#setLayerError(layer.id, errors.get(layer.id));
      }
    }
    this.#attribution = _.uniq(attributions).join(" ");
    const style = composeStyle({
      layers,
      vectorStyles,
      images,
      projection: "mercator",
      overlay: { sources: {}, layers: [] },
    });
    sharedMap.setStyle(style);
  }

  /** Create and drop TilesRenderers to match the visible 3D Tiles layers. */
  /** URL by MapLayer id of each visible 3D Tiles layer. */
  #wantedTilesets(): Map<string, string> {
    const wanted = new Map<string, string>();
    for (const layer of this.userData.settings.layers) {
      const params = resolveSource(layer);
      if (layer.visible && params?.kind === "3dtiles" && params.url.trim()) {
        wanted.set(layer.id, params.url.trim());
      }
    }
    return wanted;
  }

  async #syncTilesets(): Promise<void> {
    const wanted = this.#wantedTilesets();
    for (const [id, tileset] of this.#tilesets) {
      if (wanted.get(id) !== tileset.url) {
        tileset.tiles.dispose();
        this.remove(tileset.group);
        this.#tilesets.delete(id);
        this.#setLayerError(id, undefined);
      }
    }
    const missing = [...wanted].filter(([id]) => !this.#tilesets.has(id));
    if (missing.length === 0) {
      return;
    }
    const { TilesRenderer } = await import("3d-tiles-renderer");
    const { GLTFExtensionsPlugin } = await import("3d-tiles-renderer/plugins");
    if (this.#disposed) {
      return;
    }
    // Settings may have changed while importing; create only what is still wanted.
    const stillWanted = this.#wantedTilesets();
    for (const [id, url] of missing) {
      if (this.#tilesets.has(id) || stillWanted.get(id) !== url) {
        continue; // Created by a concurrent sync, or no longer wanted.
      }
      const tiles = new TilesRenderer(url);
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: createBundledDracoLoader() }));
      tiles.addEventListener("needs-update", () => {
        this.renderer.queueAnimationFrame();
      });
      tiles.addEventListener("load-root-tileset", () => {
        this.#setLayerError(id, undefined);
        rememberSource({ kind: "3dtiles", url });
      });
      tiles.addEventListener("load-error", (event: { error?: unknown }) => {
        this.#setLayerError(id, `Failed to load 3D tiles: ${String(event.error)}`);
      });
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.add(tiles.group);
      this.add(group);
      this.#tilesets.set(id, { url, tiles, group });
    }
    this.#placeTilesets();
  }

  /** Map Earth-centered tile coordinates into the ENU frame so the fix lands on its frame. */
  #placeTilesets(): void {
    if (this.#tilesets.size === 0) {
      return;
    }
    const anchor = this.#anchor;
    void import("3d-tiles-renderer").then(({ WGS84_ELLIPSOID }) => {
      for (const [id, tileset] of this.#tilesets) {
        tileset.group.visible = anchor != undefined;
        if (!anchor) {
          continue;
        }
        const layer = this.userData.settings.layers.find((l) => l.id === id);
        // Earth-centered → ENU at the fix; the height offset raises the tiles.
        const ellipsoidToEnu = WGS84_ELLIPSOID.getEastNorthUpFrame(
          THREE.MathUtils.degToRad(anchor.lat),
          THREE.MathUtils.degToRad(anchor.lon),
          (anchor.altitude ?? 0) - (layer?.heightOffset ?? 0),
          new THREE.Matrix4(),
        ).invert();
        tileset.group.matrix
          .makeTranslation(anchor.position.x, anchor.position.y, anchor.position.z)
          .multiply(ellipsoidToEnu);
        tileset.group.matrixWorldNeedsUpdate = true;
      }
      this.renderer.queueAnimationFrame();
    });
  }

  public updateTilesets(): void {
    if (!this.visible || !this.#anchor) {
      return;
    }
    const camera = this.renderer.cameraHandler.getActiveCamera();
    camera.updateMatrixWorld();
    this.updateMatrixWorld(true);
    for (const tileset of this.#tilesets.values()) {
      if (camera !== tileset.camera) {
        if (tileset.camera) {
          tileset.tiles.deleteCamera(tileset.camera);
        }
        tileset.tiles.setCamera(camera);
        tileset.camera = camera;
      }
      tileset.tiles.setResolutionFromRenderer(camera, this.renderer.gl);
      tileset.tiles.update();
    }
  }
}

export class Maps extends SceneExtension<MapRenderable> {
  public static extensionId = "lichtblick.Maps";
  #fixes = new Map<string, MessageEvent<LocationMessage>>();
  #anchors = new Map<string, Anchor>();

  public constructor(renderer: IRenderer, name: string = Maps.extensionId) {
    super(name, renderer);
    renderer.addCustomLayerAction({
      layerId: LAYER_ID,
      label: t("threeDee:addMap"),
      icon: "Map",
      handler: this.#handleAddMap,
    });
    renderer.on("transformTreeUpdated", this.#handleTransformTreeUpdated);
    for (const [instanceId, entry] of Object.entries(renderer.config.layers)) {
      if (entry?.layerId === LAYER_ID) {
        this.#updateLayer(instanceId, entry as Partial<LayerSettingsMap>);
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

  #locationTopic(settings: LayerSettingsMap): string | undefined {
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
    locationFrame: string | undefined,
  ): Anchor | undefined {
    const message = event.message;
    const frameId = this.renderer.normalizeFrameId(
      locationFrame ?? message.header?.frame_id ?? message.frame_id ?? "",
    );
    const stamp = normalizeTime(message.header?.stamp ?? message.timestamp);
    const time =
      stamp.sec === 0 && stamp.nsec === 0 ? toNanoSec(event.receiveTime) : toNanoSec(stamp);
    const pose = makePose();
    const known = frameId !== "" && this.renderer.transformTree.frame(frameId) != undefined;
    if (locationFrame != undefined && !known) {
      return undefined;
    }
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
        anchor = this.#makeAnchor(event, enuFrame, fixedFrameId, settings.locationFrame);
        if (anchor) {
          this.#anchors.set(instanceId, anchor);
        }
      }
      renderable.userData.frameId = enuFrame;
      renderable.locate(anchor);

      this.renderer.hud.displayIfTrue(
        settings.visible && this.renderer.sharedMap?.layerId !== instanceId,
        {
          id: `${instanceId}:unavailable`,
          group: Maps.extensionId,
          displayType: "notice",
          getMessage: () =>
            t(this.renderer.sharedMap ? "threeDee:mapSingleLayer" : "threeDee:mapUnavailable"),
        },
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
      renderable.updateTilesets();
    }
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const entries: SettingsTreeEntry[] = [];
    const locationTopics = (this.renderer.topics ?? []).filter((topic) =>
      topicIsConvertibleToSchema(topic, LOCATION_SCHEMAS),
    );
    const saved = loadSavedSources();
    for (const [instanceId, layerConfig] of Object.entries(this.renderer.config.layers)) {
      if (layerConfig?.layerId !== LAYER_ID) {
        continue;
      }
      const config = withDefaults(layerConfig as Partial<LayerSettingsMap>);
      const errors = this.renderables.get(instanceId)?.layerErrors;
      entries.push({
        path: ["layers", instanceId],
        node: {
          label: config.label,
          icon: "Map",
          fields: {
            locationTopic: {
              label: "Location topic",
              input: "select",
              options: [
                { label: "Auto", value: undefined },
                ...locationTopics.map((topic) => ({ label: topic.name, value: topic.name })),
              ],
              value: config.locationTopic,
              help: "NavSatFix or LocationFix topic that places the map. For fixes without a frame_id, select the location frame; otherwise the fix is placed at the ENU frame's origin.",
            },
            locationFrame: {
              label: t("threeDee:locationFrame"),
              input: "select",
              options: [
                { label: t("threeDee:locationFrameFromMessage"), value: undefined },
                ...this.renderer.coordinateFrameList,
              ],
              value: config.locationFrame,
              help: t("threeDee:locationFrameHelp"),
            },
            enuFrame: {
              label: "ENU frame",
              input: "select",
              options: [
                { label: "<Fixed frame>", value: undefined },
                ...this.renderer.coordinateFrameList,
              ],
              value: config.enuFrame,
              help: "Frame whose X axis points east, Y north and Z up.",
            },
            zOffset: {
              label: "Z offset",
              input: "number",
              step: 0.1,
              precision: PRECISION_DISTANCE,
              value: config.zOffset,
              help: "Height of the 2D map in meters above the ENU frame's XY plane",
            },
          },
          visible: config.visible,
          actions: [
            ...layerStackActions(saved),
            { type: "action", id: "delete", label: t("threeDee:delete") },
          ],
          children: layerStackChildren(config.layers, saved, SOURCE_KINDS, (layer) =>
            errors?.get(layer.id),
          ),
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
    const path = action.payload.path;
    const instanceId = path[1];
    if (path[0] !== "layers" || instanceId == undefined) {
      return;
    }
    const isOwnField = action.action === "update" && path.length === 3;
    if (action.action === "perform-node-action" && path.length === 2) {
      if (action.payload.id === "delete") {
        this.renderer.updateConfig((draft) => {
          delete draft.layers[instanceId];
        });
        this.#updateLayer(instanceId, undefined);
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
        return;
      }
      if (action.payload.id === "forget-saved") {
        forgetSavedSources();
        this.updateSettingsTree();
        return;
      }
    }
    if (action.action === "reorder-node" && path.length < 3) {
      return; // Custom layer order is handled by the renderer.
    }
    if (isOwnField) {
      this.saveSetting(path, action.payload.value);
      if (["enuFrame", "locationFrame", "locationTopic"].includes(path[2]!)) {
        this.#anchors.delete(instanceId);
      }
    } else {
      // Everything else edits the layer stack, exactly like the Map panel.
      const saved = loadSavedSources();
      this.renderer.updateConfig((draft) => {
        const config = draft.layers[instanceId] as Partial<LayerSettingsMap> | undefined;
        if (config) {
          config.layers ??= _.cloneDeep(DEFAULT_SETTINGS.layers);
          applyLayerStackAction(config.layers, action, 2, saved);
        }
      });
      this.updateSettingsTree();
    }
    this.#updateLayer(
      instanceId,
      this.renderer.config.layers[instanceId] as Partial<LayerSettingsMap> | undefined,
    );
  };

  #handleAddMap = (instanceId: string): void => {
    log.info(`Creating ${LAYER_ID} layer ${instanceId}`);
    const config: LayerSettingsMap = { ..._.cloneDeep(DEFAULT_SETTINGS), instanceId };
    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = _.maxBy(Object.values(draft.layers), (layer) => layer?.order);
      draft.layers[instanceId] = { ...config, order: 1 + (maxOrderLayer?.order ?? 0) };
    });
    this.#updateLayer(instanceId, config);
    this.updateSettingsTree();
  };

  #updateLayer(instanceId: string, config: Partial<LayerSettingsMap> | undefined): void {
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
      renderable = new MapRenderable(
        instanceId,
        this.renderer,
        {
          receiveTime: 0n,
          messageTime: 0n,
          frameId: "", // Set in startFrame()
          pose: makePose(),
          settingsPath: ["layers", instanceId],
          settings,
        },
        () => {
          this.updateSettingsTree();
        },
      );
      this.add(renderable);
      this.renderables.set(instanceId, renderable);
    }
    renderable.applySettings(settings);
    this.renderer.queueAnimationFrame();
  }
}
