// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Fn,
  dot,
  float,
  instanceIndex,
  normalLocal,
  positionLocal,
  select,
  sRGBTransferEOTF,
  storage,
  uint,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

import { MAX_SET_POINTS } from "./PointRaster";

/** How a set's color bytes are encoded */
export type PointColorEncoding = "srgb" | "linear";

/** Screen-sized points (compute rasterized) or instanced meshes sized in meters */
export type PointShape = "point" | "cube" | "sphere";

/**
 * Computes point `i` in a shader instead of reading the storage buffers: its position in the set's
 * space (NaN to skip it) and its packed RGBA8 color. Built once per set version.
 */
export type PointSource = (i: THREE.Node<"uint">) => {
  position: THREE.Node<"vec3">;
  color: THREE.Node<"uint">;
};

/** Floats per scan pose: the 3 rows of an affine matrix */
export const POSE_FLOATS = 12;

const UNIT_GEOMETRY: Record<"cube" | "sphere", THREE.BufferGeometry> = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  // Diameter 1 like the cube's edge; 10x6 segments look round at ~100 triangles per point
  sphere: new THREE.SphereGeometry(0.5, 10, 6),
};
const UNIT_CUBE_EDGES = new THREE.EdgesGeometry(UNIT_GEOMETRY.cube);

/** Queued partial uploads per buffer before falling back to one full upload */
const MAX_UPDATE_RANGES = 64;

/**
 * One set of points: positions (xyz float32) and colors (RGBA8) in storage buffers, in this
 * object's space, shared by every way of drawing them. As `"point"` shape the {@link PointRaster}
 * draws them in compute shaders with a fixed size in CSS pixels; as cubes or spheres they are one
 * instanced mesh reading the same buffers. Optionally every point has a scan slot, and is first
 * placed by its slot's pose (3 affine rows); a slot whose first row is zero hides its points. Like
 * any object, its world matrix, visibility and layers apply.
 *
 * Colors with alpha below 1 are drawn with screen-door transparency as points (rasterized points
 * aren't sorted), and blended as shapes.
 */
export class RasterPoints extends THREE.Object3D {
  public readonly isRasterPoints = true;
  /** Diameter in CSS pixels, for the point shape */
  public pointSize = 2;
  /** Draw points as squares instead of circles */
  public square = false;
  /** Points [0, drawCount) are drawn; per-slot poses hide unused ones */
  public drawCount = 0;
  /** How the color bytes are encoded */
  public encoding: PointColorEncoding = "linear";
  /** @internal PointRaster bookkeeping */
  public rasterData: unknown;
  /** Computes points instead of reading the buffers (points shape only); see setSource */
  #source: PointSource | undefined;

  #capacity = 0;
  #positions = new THREE.StorageBufferAttribute(new Float32Array(0), 1);
  #colors = new THREE.StorageBufferAttribute(new Uint32Array(0), 1);
  #slots: THREE.StorageBufferAttribute | undefined;
  readonly #poses: THREE.StorageBufferAttribute | undefined;
  /** Bumped whenever buffers are replaced, so shaders reading them are rebuilt */
  #version = 0;

  #shape: PointShape = "point";
  readonly #cubeSize = uniform(0.1);
  #outline = false;
  #transparent = false;
  #mesh?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshLambertNodeMaterial>;
  #edges?: THREE.LineSegments<THREE.InstancedBufferGeometry, THREE.LineBasicNodeMaterial>;
  /** Version, shape and encoding the meshes were built for */
  #meshKey = "";

  /** `scanSlots`: number of per-scan poses; each point then has a slot */
  public constructor(name: string, { scanSlots }: { scanSlots?: number } = {}) {
    super();
    this.name = name;
    // Placed per point by the raster or the instanced shapes; there are no geometry bounds
    this.frustumCulled = false;
    if (scanSlots != undefined) {
      this.#poses = new THREE.StorageBufferAttribute(
        new Float32Array((scanSlots + 1) * POSE_FLOATS),
        4,
      );
    }
  }

  public capacity(): number {
    return this.#capacity;
  }
  public version(): number {
    return this.#version;
  }
  public source(): PointSource | undefined {
    return this.#source;
  }
  /** Draws `drawCount` points computed by `source` instead of the buffers (points shape only) */
  public setSource(source: PointSource | undefined): void {
    this.#source = source;
    this.#version++;
  }
  public shape(): PointShape {
    return this.#shape;
  }
  public positionAttribute(): THREE.StorageBufferAttribute {
    return this.#positions;
  }
  public colorAttribute(): THREE.StorageBufferAttribute {
    return this.#colors;
  }
  public slotAttribute(): THREE.StorageBufferAttribute | undefined {
    return this.#slots;
  }
  public poseAttribute(): THREE.StorageBufferAttribute | undefined {
    return this.#poses;
  }
  /** 12 floats (3 affine rows) per slot, plus an all-zero hidden slot at the end. Call markPoses() */
  public poses(): Float32Array | undefined {
    return this.#poses?.array as Float32Array | undefined;
  }

  /**
   * Draws from these arrays (no copy; write them in place and call markRange). `colors` is RGBA
   * bytes and `slots` one slot per point, both on 4-byte aligned whole words. Replacing the arrays
   * uploads them in full.
   */
  public setArrays(positions: Float32Array, colors: Uint8Array, slots?: Uint16Array): void {
    const capacity = Math.min(positions.length / 3, colors.length / 4);
    if (capacity > MAX_SET_POINTS) {
      throw new Error(`A point set holds at most ${MAX_SET_POINTS} points`);
    }
    if (
      positions === this.#positions.array &&
      colors.buffer === (this.#colors.array as Uint32Array).buffer &&
      colors.byteOffset === (this.#colors.array as Uint32Array).byteOffset &&
      slots?.buffer === (this.#slots?.array as Uint32Array | undefined)?.buffer
    ) {
      return;
    }
    this.#positions = new THREE.StorageBufferAttribute(positions, 1);
    this.#colors = new THREE.StorageBufferAttribute(
      new Uint32Array(colors.buffer, colors.byteOffset, capacity),
      1,
    );
    this.#slots = slots
      ? new THREE.StorageBufferAttribute(
          new Uint32Array(slots.buffer, slots.byteOffset, Math.ceil(slots.length / 2)),
          1,
        )
      : undefined;
    this.#capacity = capacity;
    this.#version++;
  }

  /** Queues an upload of points [start, start + count) */
  public markRange(start: number, count: number): void {
    addRange(this.#positions, start * 3, count * 3);
    addRange(this.#colors, start, count);
    this.markSlots(start, count);
  }

  /** Queues an upload of all points */
  public markAll(): void {
    for (const attribute of [this.#positions, this.#colors, this.#slots]) {
      if (attribute) {
        attribute.clearUpdateRanges();
        attribute.needsUpdate = true;
      }
    }
  }

  /** Queues an upload of the scan slots of points [start, start + count) */
  public markSlots(start: number, count: number): void {
    if (this.#slots) {
      const first = start >> 1;
      addRange(this.#slots, first, ((start + count + 1) >> 1) - first);
    }
  }

  /** Queues an upload of all poses */
  public markPoses(): void {
    if (this.#poses) {
      this.#poses.needsUpdate = true;
    }
  }

  /**
   * Points (`"point"`, sized by pointSize) or cubes/spheres of `cubeSize` meters, optionally with
   * cube edges. `transparent` blends shapes whose colors have alpha.
   */
  public setShape(
    shape: PointShape,
    {
      cubeSize = this.#cubeSize.value,
      outline = false,
      transparent = false,
    }: { cubeSize?: number; outline?: boolean; transparent?: boolean } = {},
  ): void {
    this.#shape = shape;
    this.#cubeSize.value = cubeSize;
    this.#outline = outline;
    this.#transparent = transparent;
    this.updateShapes();
  }

  /** Brings the instanced shapes up to date with the buffers; call before rendering */
  public updateShapes(): void {
    const shape = this.#shape;
    if (shape === "point" || this.#capacity === 0) {
      this.#disposeShapes();
      return;
    }
    const key = `${this.#version}:${shape}:${this.encoding}:${this.#transparent}:${this.#outline}`;
    if (key !== this.#meshKey) {
      this.#disposeShapes();
      this.#meshKey = key;
      const { position, color, hidden } = this.#shapeNodes();
      const material = new THREE.MeshLambertNodeMaterial({ transparent: this.#transparent });
      material.positionNode = position;
      material.colorNode = color;
      if (this.#transparent) {
        material.opacityNode = color.a;
      }
      this.#mesh = new THREE.Mesh(instancedCopy(UNIT_GEOMETRY[shape]), material);
      this.#mesh.name = `${this.name}:${shape}s`;
      this.#mesh.frustumCulled = false;
      // Keep the selection highlight (Renderer sets the layers of existing children only)
      this.#mesh.layers.mask = this.layers.mask;
      this.add(this.#mesh);
      if (shape === "cube" && this.#outline) {
        const edges = new THREE.LineBasicNodeMaterial({ color: 0x000000 });
        edges.positionNode = select(hidden, vec3(0), position);
        this.#edges = new THREE.LineSegments(instancedCopy(UNIT_CUBE_EDGES), edges);
        this.#edges.name = `${this.name}:outline`;
        this.#edges.frustumCulled = false;
        this.#edges.userData.picking = false;
        this.#edges.layers.mask = this.layers.mask;
        this.add(this.#edges);
      }
    }
    for (const object of [this.#mesh, this.#edges]) {
      if (object) {
        object.geometry.instanceCount = this.drawCount;
        object.visible = this.drawCount > 0;
      }
    }
  }

  public override dispose(): void {
    this.#disposeShapes();
    this.#capacity = 0;
    this.#positions = new THREE.StorageBufferAttribute(new Float32Array(0), 1);
    this.#colors = new THREE.StorageBufferAttribute(new Uint32Array(0), 1);
    this.#slots = undefined;
    this.#version++;
  }

  #disposeShapes(): void {
    for (const object of [this.#mesh, this.#edges]) {
      if (object) {
        object.removeFromParent();
        object.geometry.dispose();
        object.material.dispose();
      }
    }
    this.#mesh = undefined;
    this.#edges = undefined;
    this.#meshKey = "";
  }

  /** Vertex position (with the instance's scan pose applied to vertex and normal) and color */
  #shapeNodes(): {
    position: THREE.Node<"vec3">;
    color: THREE.Node<"vec4">;
    hidden: THREE.Node<"bool">;
  } {
    const capacity = this.#capacity;
    const positions = storage(this.#positions, "float", capacity * 3).toReadOnly();
    const colors = storage(this.#colors, "uint", capacity).toReadOnly();
    const slots = this.#slots
      ? storage(this.#slots, "uint", this.#slots.count).toReadOnly()
      : undefined;
    const poses = this.#poses
      ? storage(this.#poses, "vec4", this.#poses.count).toReadOnly()
      : undefined;
    const cubeSize = this.#cubeSize;
    const i = instanceIndex;
    const b = i.mul(3);
    const center = vec3(
      float(positions.element(b)),
      float(positions.element(b.add(1))),
      float(positions.element(b.add(2))),
    );
    const local = positionLocal.mul(cubeSize).add(center);
    let hidden: THREE.Node<"bool"> = float(0).greaterThan(1);
    let position: THREE.Node<"vec3"> = local;
    if (slots && poses) {
      const slot = uint(slots.element(i.shiftRight(1)))
        .shiftRight(i.bitAnd(1).mul(16))
        .bitAnd(0xffff);
      const row0 = vec4(poses.element(slot.mul(3)));
      const row1 = vec4(poses.element(slot.mul(3).add(1)));
      const row2 = vec4(poses.element(slot.mul(3).add(2)));
      hidden = row0.xyz.equal(vec3(0)).all();
      position = Fn(() => {
        // Rotate the normal with the scan, as for its vertices
        normalLocal.assign(
          vec3(dot(row0.xyz, normalLocal), dot(row1.xyz, normalLocal), dot(row2.xyz, normalLocal)),
        );
        const h = vec4(local, 1);
        // A hidden scan collapses its instances to a point, so nothing is rasterized
        return select(hidden, vec3(0), vec3(dot(row0, h), dot(row1, h), dot(row2, h)));
      })();
    }
    const c = uint(colors.element(i));
    const rgb = vec3(
      float(c.bitAnd(255)),
      float(c.shiftRight(8).bitAnd(255)),
      float(c.shiftRight(16).bitAnd(255)),
    ).div(255);
    const linear = this.encoding === "srgb" ? (sRGBTransferEOTF(rgb) as THREE.Node<"vec3">) : rgb;
    const color = vec4(linear, float(c.shiftRight(24)).div(255));
    return { position, color, hidden };
  }
}

function addRange(attribute: THREE.BufferAttribute, start: number, count: number): void {
  if (count <= 0) {
    return;
  }
  if (attribute.updateRanges.length >= MAX_UPDATE_RANGES) {
    // Not drawn for a while (hidden): upload it whole
    attribute.clearUpdateRanges();
  } else {
    attribute.addUpdateRange(start, count);
  }
  attribute.needsUpdate = true;
}

/**
 * Instanced geometry with cloned attributes: disposing a geometry deletes its attributes' GPU
 * buffers, which must not affect other point sets sharing the unit geometry.
 */
function instancedCopy(source: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  if (source.index) {
    geometry.setIndex(source.index.clone());
  }
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, (attribute as THREE.BufferAttribute).clone());
  }
  return geometry;
}
