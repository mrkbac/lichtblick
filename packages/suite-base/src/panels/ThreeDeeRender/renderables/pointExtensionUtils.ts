// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { DynamicBufferGeometry } from "@lichtblick/suite-base/panels/ThreeDeeRender/DynamicBufferGeometry";
import { BaseUserData, Renderable } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderable";
import type { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import {
  MISSING_TRANSFORM,
  missingTransformMessage,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/transforms";
import { MAX_DURATION } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";
import { updatePose } from "@lichtblick/suite-base/panels/ThreeDeeRender/updatePose";

import { LaserScanMaterial } from "./LaserScans";
import { colorHasTransparency, FS_SRGB_TO_LINEAR } from "./colorMode";
import type { LayerSettingsPointExtension } from "../settingsNodes/topics";

/**
 * Creates a THREE.Points object for a point cloud and scan messages
 * @param topic - topic name string for naming geometry
 * @param usage - THREE draw usage (ex: THREE.StaticDrawUsage)
 * @returns
 */
export function createGeometry(topic: string, usage: THREE.Usage): DynamicBufferGeometry {
  const geometry = new DynamicBufferGeometry(usage);
  geometry.name = `${topic}:PointScans:geometry`;
  geometry.createAttribute("position", Float32Array, 3);
  geometry.createAttribute("color", Uint8Array, 4, true);
  return geometry;
}

type Material = THREE.PointsMaterial | LaserScanMaterial;

export function pointCloudColorEncoding<T extends LayerSettingsPointExtension>(
  settings: T,
): "srgb" | "linear" {
  switch (settings.colorMode) {
    case "flat":
    case "colormap":
    case "gradient":
      // converted to linear by getColorConverter
      return "linear";
    case "rgb":
    case "rgba":
    case "rgba-fields":
      return "srgb";
  }
}

export class PointsRenderable<TUserData extends BaseUserData = BaseUserData> extends Renderable<
  TUserData,
  /*TRenderer=*/ undefined
> {
  #points: THREE.Points<DynamicBufferGeometry, Material>;
  public readonly geometry: DynamicBufferGeometry;
  public override pickableInstances = true;

  public constructor(
    name: string,
    userData: TUserData,
    geometry: DynamicBufferGeometry,
    material: Material,
    pickingMaterial: THREE.Material,
    instancePickingMaterial: THREE.Material,
  ) {
    super(name, undefined, userData);
    this.geometry = geometry;

    const points = new THREE.Points<DynamicBufferGeometry, Material>(geometry, material);
    // We don't calculate the bounding sphere for points, so frustum culling is disabled
    points.frustumCulled = false;
    points.name = `${userData.topic}:PointCloud:points`;
    points.userData = {
      pickingMaterial,
      instancePickingMaterial,
      pose: userData.pose,
    };
    this.#points = points;
    this.add(points);
  }

  public override dispose(): void {
    this.#points.geometry.dispose();
    this.#cubes?.geometry.dispose();
  }

  public updateMaterial(material: Material): void {
    this.#points.material = material;
  }

  #cubes?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshLambertMaterial>;

  /**
   * Cube instance attributes alias the point geometry's arrays, so the cloud is only decoded once.
   * Call before rendering (e.g. in startFrame) so cubes pick up new or resized point data.
   */
  public syncCubes(): void {
    if (this.#cubes?.visible !== true) {
      return;
    }
    const cubes = this.#cubes.geometry;
    const points = this.geometry;
    cubes.instanceCount = points.drawRange.count;
    syncInstanceAttribute(cubes, "instancePosition", points.attributes.position!);
    syncInstanceAttribute(cubes, "color", points.attributes.color!);
  }

  /** Render each point as a cube (one instanced draw call) instead of a GL point, or switch back */
  public setCubeMaterials(materials: CubeMaterials | undefined): void {
    this.#points.visible = materials == undefined;
    if (!materials) {
      if (this.#cubes) {
        this.#cubes.visible = false;
      }
      return;
    }
    if (!this.#cubes) {
      const geometry = new THREE.InstancedBufferGeometry();
      // Clone: disposing a geometry deletes its attributes' GL buffers, which must not affect
      // other cubes sharing them
      geometry.setIndex(UNIT_CUBE.index!.clone());
      geometry.setAttribute("position", UNIT_CUBE.attributes.position!.clone());
      geometry.setAttribute("normal", UNIT_CUBE.attributes.normal!.clone());
      const cubes = new THREE.Mesh(geometry, materials.material);
      cubes.frustumCulled = false;
      cubes.name = `${this.userData.topic}:PointCloud:cubes`;
      this.#cubes = cubes;
      this.add(cubes);
    }
    this.#cubes.visible = true;
    this.syncCubes();
    this.#cubes.material = materials.material;
    this.#cubes.userData = {
      pickingMaterial: materials.pickingMaterial,
      instancePickingMaterial: materials.instancePickingMaterial,
      pose: this.userData.pose,
    };
  }
}

const UNIT_CUBE = new THREE.BoxGeometry(1, 1, 1);

function syncInstanceAttribute(
  geometry: THREE.InstancedBufferGeometry,
  name: string,
  source: THREE.BufferAttribute,
): void {
  let attribute = geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
  if (attribute?.array !== source.array) {
    // DynamicBufferGeometry replaced the array on resize
    attribute = new THREE.InstancedBufferAttribute(
      source.array,
      source.itemSize,
      source.normalized,
    );
    attribute.setUsage(source.usage);
    geometry.setAttribute(name, attribute);
  }
  attribute.version = source.version;
}

export type CubeMaterials = {
  material: THREE.MeshLambertMaterial;
  pickingMaterial: THREE.ShaderMaterial;
  instancePickingMaterial: THREE.ShaderMaterial;
  /** Shared by all three materials so size changes don't need a rebuild */
  cubeSize: THREE.IUniform<number>;
};

const VS_CUBE_TRANSFORM = /* glsl */ `
vec3 transformed = position * cubeSize + instancePosition;
`;

export function createCubeMaterials<T extends LayerSettingsPointExtension>(
  settings: T,
): CubeMaterials {
  const cubeSize = { value: settings.cubeSize };
  const encoding = pointCloudColorEncoding(settings);
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: colorHasTransparency(settings),
    depthWrite: true,
  });
  material.customProgramCacheKey = () => `cube-${encoding}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cubeSize = cubeSize;
    shader.vertexShader =
      "uniform float cubeSize;\nattribute vec3 instancePosition;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", VS_CUBE_TRANSFORM);
    if (encoding === "srgb") {
      const SEARCH = "#include <color_fragment>";
      shader.fragmentShader =
        FS_SRGB_TO_LINEAR +
        shader.fragmentShader.replace(
          SEARCH,
          SEARCH + "\ndiffuseColor.rgb = sRGBToLinear(diffuseColor.rgb);",
        );
    }
  };

  const vertexShader = (header: string) => /* glsl */ `
    uniform float cubeSize;
    attribute vec3 instancePosition;
    ${header}
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position * cubeSize + instancePosition, 1.0);
    }
  `;
  const pickingMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShader("void main() {"),
    fragmentShader: /* glsl */ `
      uniform vec4 objectId;
      void main() {
        gl_FragColor = objectId;
      }
    `,
    uniforms: { cubeSize, objectId: { value: [NaN, NaN, NaN, NaN] } },
  });
  const instancePickingMaterial = new THREE.ShaderMaterial({
    vertexShader: vertexShader(/* glsl */ `
      varying vec4 objectId;
      void main() {
        objectId = vec4(
          float((gl_InstanceID >> 24) & 255) / 255.0,
          float((gl_InstanceID >> 16) & 255) / 255.0,
          float((gl_InstanceID >> 8) & 255) / 255.0,
          float(gl_InstanceID & 255) / 255.0);
    `),
    fragmentShader: /* glsl */ `
      varying vec4 objectId;
      void main() {
        gl_FragColor = objectId;
      }
    `,
    uniforms: { cubeSize },
  });
  return { material, pickingMaterial, instancePickingMaterial, cubeSize };
}

export function disposeCubeMaterials(materials: CubeMaterials): void {
  materials.material.dispose();
  materials.pickingMaterial.dispose();
  materials.instancePickingMaterial.dispose();
}

// Fragment shader chunk to convert sRGB to linear RGB
const FS_POINTCLOUD_SRGB_TO_LINEAR = /* glsl */ `
outgoingLight = sRGBToLinear(outgoingLight);
`;

// Fragment shader chunk to render a GL_POINT as a circle
const FS_POINTCLOUD_CIRCLE = /* glsl */ `
vec2 cxy = 2.0 * gl_PointCoord - 1.0;
if (dot(cxy, cxy) > 1.0) { discard; }
`;

export function pointCloudMaterial<T extends LayerSettingsPointExtension>(
  settings: T,
): THREE.PointsMaterial {
  const transparent = colorHasTransparency(settings);
  const encoding = pointCloudColorEncoding(settings);
  const scale = settings.pointSize;
  const shape = settings.pointShape;

  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: scale,
    sizeAttenuation: false,
    transparent,
    // The sorting issues caused by writing semi-transparent pixels to the depth buffer are less
    // distracting for point clouds than the self-sorting artifacts when depth writing is disabled
    depthWrite: true,
  });

  // Tell three.js to recompile the shader when `shape` or `encoding` change
  material.customProgramCacheKey = () => `${shape}-${encoding}`;
  material.onBeforeCompile = (shader) => {
    const SEARCH = "#include <opaque_fragment>";
    if (shape === "circle") {
      // Patch the fragment shader to render points as circles
      shader.fragmentShader = shader.fragmentShader.replace(SEARCH, FS_POINTCLOUD_CIRCLE + SEARCH);
    }
    if (encoding === "srgb") {
      // Patch the fragment shader to add sRGB->linear color conversion
      shader.fragmentShader =
        FS_SRGB_TO_LINEAR +
        shader.fragmentShader.replace(SEARCH, FS_POINTCLOUD_SRGB_TO_LINEAR + SEARCH);
    }
  };

  return material;
}

export function createPickingMaterial<T extends LayerSettingsPointExtension>(
  settings: T,
): THREE.ShaderMaterial {
  const MIN_PICKING_POINT_SIZE = 8;

  // Use a custom shader for picking that sets a minimum point size to make
  // individual points easier to click on
  const pointSize = Math.max(settings.pointSize, MIN_PICKING_POINT_SIZE);
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform float pointSize;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pointSize;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec4 objectId;
      void main() {
        gl_FragColor = objectId;
      }
    `,
    side: THREE.DoubleSide,
    uniforms: { pointSize: { value: pointSize }, objectId: { value: [NaN, NaN, NaN, NaN] } },
  });
}

export function createInstancePickingMaterial<T extends LayerSettingsPointExtension>(
  settings: T,
): THREE.ShaderMaterial {
  const MIN_PICKING_POINT_SIZE = 8;

  // Use a custom shader for picking that sets a minimum point size to make
  // individual points easier to click on
  const pointSize = Math.max(settings.pointSize, MIN_PICKING_POINT_SIZE);
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
        uniform float pointSize;
        varying vec4 objectId;
        void main() {
          objectId = vec4(
            float((gl_VertexID >> 24) & 255) / 255.0,
            float((gl_VertexID >> 16) & 255) / 255.0,
            float((gl_VertexID >> 8) & 255) / 255.0,
            float(gl_VertexID & 255) / 255.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = pointSize;
        }
      `,
    fragmentShader: /* glsl */ `
        varying vec4 objectId;
        void main() {
          gl_FragColor = objectId;
        }
      `,
    side: THREE.DoubleSide,
    uniforms: { pointSize: { value: pointSize } },
  });
}

type RenderObjectHistoryUserData = BaseUserData & {
  topic: string;
  settings: LayerSettingsPointExtension;
};

/** An object kept in a decay history. The history owns it and disposes it on eviction. */
export type HistoryRenderable = THREE.Object3D & {
  dispose(): void;
  /** Its draw count is this entry's share of {@link HistoryLimits.maxPoints}. */
  readonly geometry: THREE.BufferGeometry;
  /**
   * Called once a newer entry is pushed. Drops the message this entry was built from, so a decay
   * history holds only GPU geometry, not one raw message per entry.
   */
  releaseMessage(): void;
};

/** Required caps on a decay history; the decay time alone does not bound a fast or dense topic. */
export type HistoryLimits = {
  maxEntries: number;
  /** Total points drawn across all entries. */
  maxPoints: number;
};

/** ~1000 Hz for 1 s or 10 Hz for 100 s; 10 M points is a few hundred MB of GPU buffers. */
export const DECAY_HISTORY_LIMITS: HistoryLimits = { maxEntries: 1_000, maxPoints: 10_000_000 };

type HistoryEntry<TRenderable extends HistoryRenderable> = {
  receiveTime: bigint;
  messageTime: bigint;
  renderable: TRenderable;
};

/**
 * Class that handles lifecycle of 3d object history over the decay time
 * This class encapsulates the functionality of showing the history of an object within a specified decay time.
 * Meant to be extensible for all kinds of renderables that need to show old points over decay time.
 * See LaserScansRenderable and PointCloudsRenderable for examples.
 */
export class RenderObjectHistory<TRenderable extends HistoryRenderable> {
  #history: HistoryEntry<TRenderable>[];
  #parentRenderable: Renderable<RenderObjectHistoryUserData>;
  #renderer: Renderer;
  readonly #limits: HistoryLimits;

  public constructor({
    initial,
    renderer,
    parentRenderable,
    limits,
  }: {
    initial: HistoryEntry<TRenderable>;
    renderer: Renderer;
    parentRenderable: Renderable<RenderObjectHistoryUserData>;
    limits: HistoryLimits;
  }) {
    this.#history = [initial];
    this.#renderer = renderer;
    this.#parentRenderable = parentRenderable;
    this.#limits = limits;
  }

  public addHistoryEntry(entry: HistoryEntry<TRenderable>): void {
    this.latest().renderable.releaseMessage();
    this.#history.push(entry);
    this.#evictOldest(this.#history.length - this.#limits.maxEntries);
  }

  /** Disposes the `count` oldest entries, always keeping the latest. */
  #evictOldest(count: number): void {
    if (count <= 0) {
      return;
    }
    const evicted = this.#history.splice(0, Math.min(count, this.#history.length - 1));
    for (const entry of evicted) {
      this.#parentRenderable.remove(entry.renderable);
      entry.renderable.dispose();
    }
  }

  /** Drops the oldest entries until the drawn points fit in {@link HistoryLimits.maxPoints}. */
  #enforcePointBudget(): void {
    let points = 0;
    for (let i = this.#history.length - 1; i >= 0; i--) {
      const count = this.#history[i]!.renderable.geometry.drawRange.count;
      points += Number.isFinite(count) ? count : 0;
      if (points > this.#limits.maxPoints) {
        this.#evictOldest(i + 1);
        return;
      }
    }
  }

  public forEach(callback: (entry: HistoryEntry<TRenderable>) => void): void {
    this.#history.forEach(callback);
  }

  public updateHistoryFromCurrentTime(currentTime: bigint): void {
    // Remove expired entries from the history of points when decayTime is enabled
    const pointsHistory = this.#history;
    const decayTime = this.#parentRenderable.userData.settings.decayTime;
    const expireTime =
      decayTime > 0 ? currentTime - BigInt(Math.round(decayTime * 1e9)) : MAX_DURATION;
    let expired = 0;
    while (expired < pointsHistory.length - 1 && pointsHistory[expired]!.receiveTime < expireTime) {
      expired++;
    }
    this.#evictOldest(expired);
    this.#enforcePointBudget();
  }

  /**
   * Returns whether every entry found its transform. Adds the MISSING_TRANSFORM error when one
   * doesn't; the caller clears it once all histories sharing its settings path resolve.
   */
  public updatePoses(currentTime: bigint, renderFrameId: string, fixedFrameId: string): boolean {
    // Update the pose on each entry
    let hadTfError = false;
    for (const entry of this.#history) {
      const srcTime = entry.messageTime;
      const frameId = this.#parentRenderable.userData.frameId;
      const updated = updatePose(
        entry.renderable,
        this.#renderer.transformTree,
        renderFrameId,
        fixedFrameId,
        frameId,
        currentTime,
        srcTime,
      );
      if (!updated && !hadTfError) {
        const message = missingTransformMessage(renderFrameId, fixedFrameId, frameId);
        this.#renderer.settings.errors.add(
          this.#parentRenderable.userData.settingsPath,
          MISSING_TRANSFORM,
          message,
        );
        hadTfError = true;
      }
    }
    return !hadTfError;
  }

  public latest(): HistoryEntry<TRenderable> {
    if (this.#history.length === 0) {
      throw new Error("RenderObjectHistory is empty");
    }
    return this.#history[this.#history.length - 1]!;
  }

  /** Removes all but the last renderable, which would be the current object used in rendering. */
  public clearHistory(): void {
    for (const entry of this.#history.splice(0, this.#history.length - 1)) {
      entry.renderable.dispose();
      this.#parentRenderable.remove(entry.renderable);
    }
  }

  public dispose(): void {
    for (const entry of this.#history) {
      entry.renderable.dispose();
    }
    this.#history.length = 0;
  }
}
