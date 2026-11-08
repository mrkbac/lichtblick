// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { t } from "i18next";
import type { CustomLayerInterface, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { MercatorCoordinate } from "maplibre-gl";
import * as THREE from "three";

import type { HUDItem } from "./HUDItemManager";
import type { IRenderer } from "./IRenderer";
import { AnyFrameId, makePose } from "./transforms";

export type MapAnchor = {
  lat: number;
  lon: number;
  altitude?: number;
  enuFrame: string;
  position: THREE.Vector3;
};

const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };
const ORTHOGRAPHIC_NOTICE: HUDItem = {
  id: "shared-map-orthographic",
  group: "shared-map",
  displayType: "notice",
  getMessage: () => t("threeDee:mapPerspectiveRequired"),
};
const WAITING_NOTICE: HUDItem = {
  id: "shared-map-view",
  group: "shared-map",
  displayType: "notice",
  getMessage: () => t("threeDee:mapWaitingForView"),
};
const CUSTOM_LAYER_ID = "lichtblick-3d-scene";
const IDENTITY_POSE = makePose();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const levelRight = new THREE.Vector3();
const levelUp = new THREE.Vector3();

/** Camera orientation in the map's east/north/up frame, expressed in MapLibre degrees. */
export function mapCameraAngles(matrix: THREE.Matrix4): {
  bearing: number;
  pitch: number;
  roll: number;
} {
  forward.set(0, 0, -1).transformDirection(matrix);
  up.set(0, 1, 0).transformDirection(matrix);
  right.set(1, 0, 0).transformDirection(matrix);
  const bearing =
    Math.hypot(forward.x, forward.y) < 1e-8
      ? Math.atan2(-right.y, right.x)
      : Math.atan2(forward.x, forward.y);
  const pitch = Math.acos(THREE.MathUtils.clamp(-forward.z, -1, 1));
  levelRight.set(Math.cos(bearing), -Math.sin(bearing), 0);
  levelUp.copy(levelRight).cross(forward);
  return {
    bearing: THREE.MathUtils.radToDeg(bearing),
    pitch: THREE.MathUtils.radToDeg(pitch),
    roll: THREE.MathUtils.radToDeg(Math.atan2(up.dot(levelRight), up.dot(levelUp))),
  };
}

/** One MapLibre canvas and context, with the existing Three.js scene as a custom layer. */
export class SharedMap {
  public readonly map: MapLibreMap;
  public readonly layerId: string;
  public maxCameraDistance = Infinity;
  #anchor?: MapAnchor;
  #zOffset = 0;
  #style: StyleSpecification = EMPTY_STYLE;
  #placed = false;
  #draw?: () => void;
  #renderer?: IRenderer;
  #renderToMercator = new THREE.Matrix4();
  #renderToEnu = new THREE.Matrix4();
  #enuToMercator = new THREE.Matrix4();
  #cameraInEnu = new THREE.Matrix4();
  #translation = new THREE.Vector3();
  #rotation = new THREE.Quaternion();
  #eye = new THREE.Vector3();
  #eyeCoordinate = new MercatorCoordinate(0, 0, 0);
  #origin?: MercatorCoordinate;
  #pose = makePose();

  public constructor(map: MapLibreMap, layerId: string) {
    this.map = map;
    this.layerId = layerId;
    map.on("style.load", this.#addSceneLayer);
    map.on("sourcedata", this.#requestFrame);
  }

  public attach(renderer: IRenderer, draw: () => void): void {
    this.#renderer = renderer;
    this.#draw = draw;
    if (this.map.isStyleLoaded() === true) {
      this.#addSceneLayer();
    }
  }

  public dispose(): void {
    this.#renderer = undefined;
    this.#draw = undefined;
    this.map.off("style.load", this.#addSceneLayer);
    this.map.off("sourcedata", this.#requestFrame);
    this.map.remove();
  }

  public detach(renderer: IRenderer): void {
    if (this.#renderer === renderer) {
      this.#renderer = undefined;
      this.#draw = undefined;
    }
  }

  public setStyle(style: StyleSpecification): void {
    this.#style = style;
    this.map.setStyle(this.#placed ? style : EMPTY_STYLE, { diff: false });
  }

  public locate(anchor: MapAnchor | undefined, zOffset: number): void {
    if (anchor !== this.#anchor) {
      this.#origin = anchor ? MercatorCoordinate.fromLngLat([anchor.lon, anchor.lat]) : undefined;
    }
    this.#anchor = anchor;
    this.#zOffset = zOffset;
  }

  #requestFrame = (): void => {
    // Terrain may supply the missing ground elevation after the first location fix.
    this.#renderer?.queueAnimationFrame();
  };

  #addSceneLayer = (): void => {
    if (!this.#renderer || this.map.getLayer(CUSTOM_LAYER_ID)) {
      return;
    }
    const layer: CustomLayerInterface = {
      id: CUSTOM_LAYER_ID,
      type: "custom",
      renderingMode: "3d",
      render: (_gl, options) => {
        const renderer = this.#renderer;
        if (!renderer) {
          return;
        }
        const camera = renderer.cameraHandler.getActiveCamera();
        if (this.#placed) {
          camera.updateWorldMatrix(true, false);
          camera.projectionMatrix
            .fromArray(options.defaultProjectionData.mainMatrix)
            .multiply(this.#renderToMercator)
            .multiply(camera.matrixWorld);
          // Three.js line shaders recognize perspective cameras by this normalized entry.
          camera.projectionMatrix.multiplyScalar(-1 / camera.projectionMatrix.elements[11]);
          camera.projectionMatrix.elements[11] = -1;
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        }
        renderer.gl.resetState();
        try {
          this.#draw?.();
        } finally {
          renderer.gl.resetState();
        }
      },
    };
    // Keep map labels above the robotics scene, with terrain/building depth below it.
    const firstSymbol = this.map.getStyle().layers.find((entry) => entry.type === "symbol");
    this.map.addLayer(layer, firstSymbol?.id);
  };

  /** Synchronize MapLibre to the existing orbit/follow camera, then draw synchronously. */
  public render(renderFrameId: AnyFrameId, fixedFrameId: AnyFrameId): void {
    const renderer = this.#renderer;
    if (!renderer) {
      return;
    }
    const camera = renderer.cameraHandler.getActiveCamera();
    camera.updateProjectionMatrix();
    const anchor = this.#anchor;
    const pose = this.#pose;
    const origin = this.#origin;
    const time = renderer.currentTime;
    const available =
      anchor != undefined &&
      origin != undefined &&
      camera instanceof THREE.PerspectiveCamera &&
      this.map.getCanvas().clientHeight > 0 &&
      Boolean(
        renderer.transformTree.apply(
          pose,
          IDENTITY_POSE,
          anchor.enuFrame,
          fixedFrameId,
          renderFrameId,
          time,
          time,
        ),
      );
    let placed = false;
    if (available) {
      // Convert MapLibre's minimum zoom to an orbit distance in the anchor's meter scale.
      const height = this.map.getCanvas().clientHeight;
      this.maxCameraDistance =
        height /
        (2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
          Math.max(512 * 2 ** this.map.getMinZoom(), height) *
          origin.meterInMercatorCoordinateUnits());
      const distance = camera.position.distanceTo(
        this.#translation.fromArray(renderer.config.cameraState.targetOffset),
      );
      if (distance > this.maxCameraDistance) {
        const state = renderer.getCameraState();
        if (state) {
          renderer.setCameraState({ ...state, distance: this.maxCameraDistance });
          renderer.emit("cameraMove", renderer);
        }
      }
      const renderToEnu = this.#renderToEnu.compose(
        this.#translation.set(pose.position.x, pose.position.y, pose.position.z),
        this.#rotation.set(
          pose.orientation.x,
          pose.orientation.y,
          pose.orientation.z,
          pose.orientation.w,
        ),
        UNIT_SCALE,
      );
      const elevation =
        anchor.altitude ?? this.map.queryTerrainElevation([anchor.lon, anchor.lat]) ?? 0;
      const scale = origin.meterInMercatorCoordinateUnits();
      const enuToMercator = this.#enuToMercator.makeScale(scale, -scale, scale);
      enuToMercator.setPosition(
        origin.x - anchor.position.x * scale,
        origin.y + anchor.position.y * scale,
        (elevation - this.#zOffset - anchor.position.z) * scale,
      );
      this.#renderToMercator.copy(enuToMercator).multiply(renderToEnu);
      camera.updateWorldMatrix(true, false);
      const cameraInEnu = this.#cameraInEnu.copy(renderToEnu).multiply(camera.matrixWorld);
      const angles = mapCameraAngles(cameraInEnu);
      const eye = this.#eye
        .setFromMatrixPosition(camera.matrixWorld)
        .applyMatrix4(this.#renderToMercator);
      // shortcut: map-backed views require a camera above the ground looking down; use ordinary 3D otherwise.
      placed = angles.pitch < 85 && eye.z > 0;
      if (placed) {
        const coordinate = this.#eyeCoordinate;
        coordinate.x = eye.x;
        coordinate.y = eye.y;
        coordinate.z = eye.z;
        this.map.setVerticalFieldOfView(camera.fov);
        const options = this.map.calculateCameraOptionsFromCameraLngLatAltRotation(
          coordinate.toLngLat(),
          coordinate.toAltitude(),
          angles.bearing,
          angles.pitch,
          angles.roll,
        );
        this.map.jumpTo(options);
        if (options.zoom != undefined && options.zoom < this.map.getZoom() - 1e-6) {
          const state = renderer.getCameraState();
          if (state) {
            this.maxCameraDistance = Math.min(
              this.maxCameraDistance,
              state.distance * 2 ** (options.zoom - this.map.getZoom()),
            );
            renderer.setCameraState({ ...state, distance: this.maxCameraDistance });
            renderer.emit("cameraMove", renderer);
            renderer.queueAnimationFrame();
          }
        }
      }
    }
    if (placed !== this.#placed) {
      this.#placed = placed;
      this.map.setStyle(placed ? this.#style : EMPTY_STYLE, { diff: false });
    }
    if (!placed) {
      this.maxCameraDistance = Infinity;
    }
    const orthographic = camera instanceof THREE.OrthographicCamera;
    renderer.hud.displayIfTrue(orthographic, ORTHOGRAPHIC_NOTICE);
    renderer.hud.displayIfTrue(!placed && !orthographic, WAITING_NOTICE);
    this.map.redraw();
  }
}
