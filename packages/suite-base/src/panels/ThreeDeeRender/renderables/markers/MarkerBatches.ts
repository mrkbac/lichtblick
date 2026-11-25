// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";

import { LineMaterialWithAlphaVertex } from "@lichtblick/suite-base/panels/ThreeDeeRender/LineMaterialWithAlphaVertex";

import { RenderableArrow } from "./RenderableArrow";
import { RenderableCube } from "./RenderableCube";
import { RenderableCylinder } from "./RenderableCylinder";
import { RenderableLineList } from "./RenderableLineList";
import { RenderableLineStrip } from "./RenderableLineStrip";
import type { RenderableMarker } from "./RenderableMarker";
import { RenderableSphere } from "./RenderableSphere";
import { RenderableTextViewFacing } from "./RenderableTextViewFacing";
import { makeLineMaterial, makeLinePrepassMaterial } from "./materials";
import { rgbToThreeColor } from "../../color";
import { LAYER_DEFAULT, LAYER_PICK_ONLY, LAYER_SELECTED } from "../../layers";
import { ColorRGBA } from "../../ros";
import { setLineColors, setLinePositions } from "../../setLinePositions";

/** A marker drawn as one mesh (and maybe an outline) that a batch can draw instead */
type LineMarker = RenderableLineList | RenderableLineStrip;
type BatchableMarker =
  | RenderableArrow
  | RenderableCube
  | RenderableSphere
  | RenderableCylinder
  | LineMarker;

function isLineMarker(marker: RenderableMarker): marker is LineMarker {
  return marker instanceof RenderableLineList || marker instanceof RenderableLineStrip;
}
type MarkerMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

export function isBatchable(marker: RenderableMarker): marker is BatchableMarker {
  return (
    isLineMarker(marker) ||
    marker instanceof RenderableArrow ||
    marker instanceof RenderableCube ||
    marker instanceof RenderableSphere ||
    marker instanceof RenderableCylinder
  );
}

/**
 * Moves an object between drawing on its own and drawing through a batch. A selected object keeps
 * its selection layer; deselecting it restores the layer chosen here.
 */
export function setPickOnly(object: THREE.Object3D, { pickOnly }: { pickOnly: boolean }): void {
  object.userData.pickOnly = pickOnly;
  if (!object.layers.isEnabled(LAYER_SELECTED)) {
    object.layers.set(pickOnly ? LAYER_PICK_ONLY : LAYER_DEFAULT);
  }
}

/** The marker's own mesh and outline draw again, e.g. before the pool hands it to someone else */
export function unbatch(marker: RenderableMarker): void {
  if (marker instanceof RenderableTextViewFacing) {
    setPickOnly(marker.label.mesh, { pickOnly: false });
    return;
  }
  if (!isBatchable(marker)) {
    return;
  }
  if (isLineMarker(marker)) {
    setPickOnly(marker.line, { pickOnly: false });
    setPickOnly(marker.linePrepass, { pickOnly: false });
  } else if (marker instanceof RenderableArrow) {
    setPickOnly(marker.shaftMesh, { pickOnly: false });
    setPickOnly(marker.headMesh, { pickOnly: false });
    setPickOnly(marker.shaftOutline, { pickOnly: false });
    setPickOnly(marker.headOutline, { pickOnly: false });
  } else {
    setPickOnly(marker.mesh, { pickOnly: false });
    if (marker.outline) {
      setPickOnly(marker.outline, { pickOnly: false });
    }
  }
}

/** Instanced LineSegments: the node materials instance any object that carries an instanceMatrix */
class InstancedLineSegments extends THREE.LineSegments<
  THREE.BufferGeometry,
  THREE.Material,
  THREE.Object3DEventMap & { dispose: object }
> {
  public readonly isInstancedMesh = true;
  public instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(0), 16);
  public instanceColor = null;
  public morphTexture = null;
  public boundingSphere = new THREE.Sphere();
  public override count = 0;

  /** Frees the renderer's resources for this object, as InstancedMesh.dispose() does */
  public override dispose(): void {
    this.dispatchEvent({ type: "dispose" });
  }
}

type Instanced = THREE.InstancedMesh | InstancedLineSegments;

/** Grows the instance buffers to hold `count` instances */
function reserve(object: Instanced, count: number): void {
  const capacity = object.instanceMatrix.count;
  if (count <= capacity) {
    return;
  }
  const next = Math.max(count, Math.ceil(capacity * 1.5) + 16);
  // Keep the instances written so far this fill
  const matrices = new Float32Array(next * 16);
  matrices.set(object.instanceMatrix.array);
  object.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16);
  object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Meshes take a color per instance; outlines share the outline material's
  if (object instanceof THREE.InstancedMesh) {
    // Floats: WebGPU has no 3-component 8-bit vertex format
    const colors = new Float32Array(next * 3);
    if (object.instanceColor) {
      colors.set(object.instanceColor.array);
    }
    const color = new THREE.InstancedBufferAttribute(colors, 3);
    color.setUsage(THREE.DynamicDrawUsage);
    object.instanceColor = color;
  }
}

type Batch = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  outline: InstancedLineSegments | undefined;
  meshCount: number;
  outlineCount: number;
  /**
   * The first instance's position this fill; instances are stored relative to it, since float32
   * instance coordinates at map scale (e.g. 1e6 m) would flatten small markers
   */
  origin: THREE.Vector3;
  /** Set when the instances changed since they were last sorted (transparent batches only) */
  unsorted: boolean;
  /** The view direction in the mesh's frame the instances were last sorted for */
  sortedFor: [number, number, number];
};

type LineBatchEntry = {
  marker: LineMarker;
  positions: THREE.TypedArray;
  colors: THREE.TypedArray;
  count: number;
};

type LineBatch = {
  depth: LineSegments2;
  color: LineSegments2;
  origin: THREE.Vector3;
  positions: Float32Array;
  colors: Uint8Array;
  count: number;
};

/** Transparent lines with per-point alpha (scene entity lines), drawn in one pass */
type AlphaLineBatch = {
  line: LineSegments2;
  origin: THREE.Vector3;
  positions: Float32Array;
  colors: Float32Array;
  count: number;
};

/**
 * Grows a line batch's buffers to hold `total` segments, keeping the segments written so far.
 * True if they grew.
 */
function reserveSegments<C extends Float32Array | Uint8Array>(
  batch: { positions: Float32Array; colors: C },
  total: number,
  makeColors: (length: number) => C,
): boolean {
  if (total * 6 <= batch.positions.length) {
    return false;
  }
  const capacity = Math.min(
    MAX_BATCH_LINE_SEGMENTS,
    Math.max(total, batch.positions.length / 3, 16),
  );
  const positions = new Float32Array(capacity * 6);
  positions.set(batch.positions);
  const colors = makeColors(capacity * 8);
  colors.set(batch.colors);
  batch.positions = positions;
  batch.colors = colors;
  return true;
}

/**
 * Writes `count` segments (start/end point pairs) transformed by `matrix` into `target` from
 * segment `at`. False if baking into float32 collapsed an originally distinct segment.
 */
function bakeSegments(
  target: Float32Array,
  at: number,
  positions: ArrayLike<number>,
  count: number,
  matrix: THREE.Matrix4,
): boolean {
  const start = at * 6;
  for (let i = 0; i < count * 6; i += 6) {
    const index = start + i;
    tempPosition.set(positions[i]!, positions[i + 1]!, positions[i + 2]);
    tempPosition.applyMatrix4(matrix).toArray(target, index);
    tempPosition.set(positions[i + 3]!, positions[i + 4]!, positions[i + 5]);
    tempPosition.applyMatrix4(matrix).toArray(target, index + 3);
    if (
      target[index] === target[index + 3] &&
      target[index + 1] === target[index + 4] &&
      target[index + 2] === target[index + 5] &&
      (positions[i] !== positions[i + 3] ||
        positions[i + 1] !== positions[i + 4] ||
        positions[i + 2] !== positions[i + 5])
    ) {
      return false;
    }
  }
  return true;
}

/** Uploads only the instances in use */
function markUsed(attribute: THREE.BufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

/** A 5 km cube keeps every instance within 10 km of any other instance in its cell. */
const BATCH_CELL_SIZE = 5_000;

// Merging saves draws for many small markers. Keep long paths in their existing GPU buffers.
const MAX_BATCH_LINE_SEGMENTS = 8_192;

export function cellKey(position: THREE.Vector3): string {
  const x = Math.floor(position.x / BATCH_CELL_SIZE);
  const y = Math.floor(position.y / BATCH_CELL_SIZE);
  const z = Math.floor(position.z / BATCH_CELL_SIZE);
  return `${x}:${y}:${z}`;
}

export function isFinitePosition(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

const markerMatrix = new THREE.Matrix4();
const instancesMatrix = new THREE.Matrix4();
const viewMatrix = new THREE.Matrix4();

/**
 * Orders a transparent batch's instances back to front for `camera`, as three orders transparent
 * objects (by view-space depth). The order only depends on the view direction, so the instances
 * are sorted again only when it or the instances change.
 */
function sortBackToFront(batch: Batch, camera: THREE.Camera): void {
  const { mesh } = batch;
  viewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
  const e = viewMatrix.elements;
  const [dx, dy, dz] = batch.sortedFor;
  if (!batch.unsorted && e[2] === dx && e[6] === dy && e[10] === dz) {
    return;
  }
  batch.unsorted = false;
  batch.sortedFor = [e[2], e[6], e[10]];
  const count = mesh.count;
  const matrices = mesh.instanceMatrix.array;
  const colors = mesh.instanceColor?.array;
  const depths = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    depths[i] =
      e[2] * matrices[i * 16 + 12]! +
      e[6] * matrices[i * 16 + 13]! +
      e[10] * matrices[i * 16 + 14]!;
  }
  // The camera looks down -z: the farthest instance has the lowest depth and draws first
  const order = Uint32Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => depths[a]! - depths[b]!,
  );
  const sortedMatrices = matrices.slice(0, count * 16);
  const sortedColors = colors?.slice(0, count * 3);
  order.forEach((from, to) => {
    sortedMatrices.set(matrices.subarray(from * 16, from * 16 + 16), to * 16);
    sortedColors?.set(colors!.subarray(from * 3, from * 3 + 3), to * 3);
  });
  matrices.set(sortedMatrices);
  markUsed(mesh.instanceMatrix, count);
  if (mesh.instanceColor && sortedColors) {
    mesh.instanceColor.array.set(sortedColors);
    markUsed(mesh.instanceColor, count);
  }
}
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempColor = new THREE.Color();

/**
 * Draws a topic's opaque cube, sphere, cylinder and arrow markers (with outlines) with one instanced
 * draw per shape and cell instead of one or two draws per marker. Per-object costs in the renderer dominate
 * frames with thousands of markers, more so while they move. The markers keep their own meshes on
 * LAYER_PICK_ONLY, so picking, selection and the inspector see each marker as before.
 * Transparent shapes batch by opacity, and their instances are sorted back to front before each
 * draw. Like separate transparent objects, batches are ordered by their own position.
 */
export class MarkerBatches extends THREE.Object3D {
  #batches = new Map<string, Batch>();
  #lineBatches = new Map<string, LineBatch>();
  #pendingLines = new Map<string, LineBatchEntry>();
  #alphaLineBatches = new Map<string, AlphaLineBatch>();
  #outlineMaterial: THREE.Material;

  public constructor(outlineMaterial: THREE.Material) {
    super();
    this.#outlineMaterial = outlineMaterial;
    this.userData.picking = false;
  }

  public begin(): void {
    for (const batch of this.#alphaLineBatches.values()) {
      batch.count = 0;
    }
    for (const batch of this.#lineBatches.values()) {
      batch.count = 0;
    }
    for (const batch of this.#batches.values()) {
      batch.meshCount = 0;
      batch.outlineCount = 0;
    }
  }

  /** Draws `marker` through a batch if it can be, or on its own otherwise */
  public addMarker(marker: BatchableMarker): void {
    if (isLineMarker(marker)) {
      this.#addLine(marker);
      return;
    }
    const { color } = marker.userData.marker;
    if (!(color.a > 0)) {
      unbatch(marker);
      return;
    }
    markerMatrix.compose(marker.position, marker.quaternion, marker.scale);
    if (marker instanceof RenderableArrow) {
      marker.shaftMesh.updateMatrix();
      tempMatrix.multiplyMatrices(markerMatrix, marker.shaftMesh.matrix);
      this.#addMesh(marker.shaftMesh, marker.shaftOutline, color);
      marker.headMesh.updateMatrix();
      tempMatrix.multiplyMatrices(markerMatrix, marker.headMesh.matrix);
      this.#addMesh(marker.headMesh, marker.headOutline, color);
    } else {
      tempMatrix.copy(markerMatrix);
      this.#addMesh(marker.mesh, marker.outline, color);
    }
  }

  #addMesh(mesh: MarkerMesh, outline: THREE.LineSegments | undefined, color: ColorRGBA): void {
    const batch = this.#batchAt(mesh.geometry, outline?.geometry, color.a);
    setPickOnly(mesh, { pickOnly: batch != undefined });
    if (outline) {
      setPickOnly(outline, { pickOnly: batch != undefined });
    }
    if (batch) {
      this.#push(batch, rgbToThreeColor(tempColor, color), { outlined: outline?.visible === true });
    }
  }

  /**
   * Draws every instance of an instanced shape (e.g. a scene entity's cubes) through the batches,
   * or none of them: a mesh drawing on its own draws all its instances. `geometry` and `edges` are
   * the shared shape the mesh's own geometry was cloned from, so equal shapes share a batch.
   * `parent` maps the mesh's parent into this object's space.
   */
  public addInstances(
    mesh: THREE.InstancedMesh,
    outline: THREE.LineSegments | undefined,
    shape: { geometry: THREE.BufferGeometry; edges: THREE.BufferGeometry | undefined },
    parent: THREE.Matrix4,
  ): void {
    const { instanceColor, count } = mesh;
    const opacities = mesh.geometry.getAttribute("instanceOpacity") as
      | THREE.BufferAttribute
      | undefined;
    mesh.updateMatrix();
    instancesMatrix.multiplyMatrices(parent, mesh.matrix);
    const outlineShape = outline ? shape.edges : undefined;
    // An invisible instance still draws its outline on its own, so it keeps the mesh unbatched
    let batched = mesh.visible && count > 0 && instanceColor != undefined && opacities != undefined;
    for (let i = 0; batched && i < count; i++) {
      mesh.getMatrixAt(i, tempMatrix);
      tempMatrix.premultiply(instancesMatrix);
      const opacity = opacities!.getX(i);
      batched = opacity > 0 && this.#batchAt(shape.geometry, outlineShape, opacity) != undefined;
    }
    setPickOnly(mesh, { pickOnly: batched });
    if (outline) {
      setPickOnly(outline, { pickOnly: batched });
    }
    if (!batched) {
      return;
    }
    for (let i = 0; i < count; i++) {
      mesh.getMatrixAt(i, tempMatrix);
      tempMatrix.premultiply(instancesMatrix);
      const batch = this.#batchAt(shape.geometry, outlineShape, opacities!.getX(i))!;
      this.#push(batch, tempColor.fromBufferAttribute(instanceColor!, i), {
        outlined: outline?.visible === true,
      });
    }
  }

  /** The batch for the instance at `tempMatrix`, or undefined if it must draw on its own */
  #batchAt(
    geometry: THREE.BufferGeometry,
    edges: THREE.BufferGeometry | undefined,
    opacity: number,
  ): Batch | undefined {
    // A reflected matrix needs flipped winding. Non-finite poses cannot seed a batch origin.
    const position = tempPosition.setFromMatrixPosition(tempMatrix);
    const determinant = tempMatrix.determinant();
    return isFinitePosition(position) && Number.isFinite(determinant) && determinant > 0
      ? this.#batchFor(geometry, edges, position, Math.min(opacity, 1))
      : undefined;
  }

  /** Appends the instance at `tempMatrix` */
  #push(batch: Batch, color: THREE.Color, { outlined }: { outlined: boolean }): void {
    const position = tempPosition.setFromMatrixPosition(tempMatrix);
    if (batch.meshCount === 0) {
      batch.origin.copy(position);
    }
    tempMatrix.setPosition(position.sub(batch.origin));
    reserve(batch.mesh, batch.meshCount + 1);
    batch.mesh.setMatrixAt(batch.meshCount, tempMatrix);
    batch.mesh.setColorAt(batch.meshCount, color);
    batch.meshCount++;
    if (outlined && batch.outline) {
      reserve(batch.outline, batch.outlineCount + 1);
      tempMatrix.toArray(batch.outline.instanceMatrix.array, batch.outlineCount * 16);
      batch.outlineCount++;
    }
  }

  #addLine(marker: LineMarker): void {
    const { line } = marker;
    const sourceGeometry = line.geometry;
    const sourcePositions = sourceGeometry.getAttribute("instanceStart");
    const sourceColors = sourceGeometry.getAttribute("instanceColorStart");
    const count = sourceGeometry.instanceCount;
    const width = marker.userData.marker.scale.x;
    if (
      line.material.transparent ||
      !isFinitePosition(marker.position) ||
      !Number.isFinite(width) ||
      !line.visible ||
      count <= 0 ||
      count >= MAX_BATCH_LINE_SEGMENTS ||
      !(sourcePositions instanceof THREE.InterleavedBufferAttribute) ||
      !(sourceColors instanceof THREE.InterleavedBufferAttribute)
    ) {
      unbatch(marker);
      return;
    }

    const key = `${width}:${cellKey(marker.position)}`;
    const entry: LineBatchEntry = {
      marker,
      count,
      positions: sourcePositions.data.array,
      colors: sourceColors.data.array,
    };
    const batch = this.#lineBatches.get(key);
    if (batch && batch.count > 0) {
      if (batch.count + count > MAX_BATCH_LINE_SEGMENTS || !this.#appendLine(batch, entry)) {
        unbatch(marker);
      }
      return;
    }

    // A single marker already draws in two passes. Wait for a second before copying any vertices.
    const first = this.#pendingLines.get(key);
    if (!first) {
      unbatch(marker);
      this.#pendingLines.set(key, entry);
      return;
    }
    if (first.count + count > MAX_BATCH_LINE_SEGMENTS) {
      unbatch(marker);
      if (count < first.count) {
        this.#pendingLines.set(key, entry);
      }
      return;
    }

    const target = batch ?? this.#createLineBatch(first.marker);
    this.#lineBatches.set(key, target);
    target.origin.copy(first.marker.position);
    if (this.#appendLine(target, first) && this.#appendLine(target, entry)) {
      this.#pendingLines.delete(key);
    } else {
      target.count = 0;
      unbatch(first.marker);
      unbatch(marker);
      this.#pendingLines.set(key, entry);
    }
  }

  #createLineBatch(marker: LineMarker): LineBatch {
    const { line, linePrepass } = marker;
    const geometry = new LineSegmentsGeometry();
    const depth = new LineSegments2(geometry, makeLinePrepassMaterial(marker.userData.marker, {}));
    const color = new LineSegments2(geometry, makeLineMaterial(marker.userData.marker, {}));
    depth.renderOrder = linePrepass.renderOrder;
    color.renderOrder = line.renderOrder;
    for (const pass of [depth, color]) {
      pass.userData.picking = false;
      pass.frustumCulled = false;
      this.add(pass);
    }
    return {
      depth,
      color,
      origin: new THREE.Vector3(),
      positions: new Float32Array(),
      colors: new Uint8Array(),
      count: 0,
    };
  }

  #appendLine(batch: LineBatch, { marker, count, positions, colors }: LineBatchEntry): boolean {
    const hadSegments = batch.positions.length > 0;
    if (reserveSegments(batch, batch.count + count, (n) => new Uint8Array(n)) && hadSegments) {
      batch.color.geometry.dispose();
      batch.depth.geometry = batch.color.geometry = new LineSegmentsGeometry();
    }
    markerMatrix.compose(marker.position, marker.quaternion, marker.scale);
    markerMatrix.setPosition(tempPosition.subVectors(marker.position, batch.origin));
    // Baking into a shared float32 buffer must not collapse an originally distinct endpoint.
    if (!bakeSegments(batch.positions, batch.count, positions, count, markerMatrix)) {
      return false;
    }
    batch.colors.set(colors.subarray(0, count * 8), batch.count * 8);
    batch.count += count;
    setPickOnly(marker.line, { pickOnly: true });
    setPickOnly(marker.linePrepass, { pickOnly: true });
    return true;
  }

  /**
   * Draws a scene entity line (always transparent, alpha per point or from its material) through a
   * batch of lines with the same width and units, or on its own when it can't be. `parent` maps the
   * line's parent into this object's space.
   */
  public addAlphaLine(
    line: LineSegments2,
    material: LineMaterialWithAlphaVertex,
    parent: THREE.Matrix4,
  ): void {
    const geometry = line.geometry;
    const positions = geometry.getAttribute("instanceStart");
    const colors = material.vertexColors ? geometry.getAttribute("instanceColorStart") : undefined;
    const count = geometry.instanceCount;
    line.updateMatrix();
    tempMatrix.multiplyMatrices(parent, line.matrix);
    const origin = tempPosition.setFromMatrixPosition(tempMatrix);
    const batchable =
      line.visible &&
      count > 0 &&
      count < MAX_BATCH_LINE_SEGMENTS &&
      isFinitePosition(origin) &&
      Number.isFinite(material.linewidth) &&
      positions instanceof THREE.InterleavedBufferAttribute &&
      (colors == undefined ||
        (colors instanceof THREE.InterleavedBufferAttribute &&
          colors.data.array instanceof Float32Array));
    const key = `${material.worldUnits}:${material.linewidth}:${cellKey(origin)}`;
    const batch = batchable ? this.#alphaLineBatchFor(key, material) : undefined;
    const appended =
      batch != undefined &&
      batch.count + count <= MAX_BATCH_LINE_SEGMENTS &&
      this.#appendAlphaLine(
        batch,
        (positions as THREE.InterleavedBufferAttribute).data.array as Float32Array,
        (colors as THREE.InterleavedBufferAttribute | undefined)?.data.array as
          | Float32Array
          | undefined,
        count,
        material,
      );
    setPickOnly(line, { pickOnly: appended });
  }

  #alphaLineBatchFor(key: string, material: LineMaterialWithAlphaVertex): AlphaLineBatch {
    let batch = this.#alphaLineBatches.get(key);
    if (!batch) {
      const line = new LineSegments2(
        new LineSegmentsGeometry(),
        new LineMaterialWithAlphaVertex({
          worldUnits: material.worldUnits,
          linewidth: material.linewidth,
          transparent: true,
          depthWrite: false,
          vertexColors: true,
        }),
      );
      line.userData.picking = false;
      line.frustumCulled = false;
      this.add(line);
      batch = {
        line,
        origin: new THREE.Vector3(),
        positions: new Float32Array(),
        colors: new Float32Array(),
        count: 0,
      };
      this.#alphaLineBatches.set(key, batch);
    }
    return batch;
  }

  /** Appends `count` segments at `tempMatrix`; false (and nothing appended) if they don't fit */
  #appendAlphaLine(
    batch: AlphaLineBatch,
    positions: Float32Array,
    colors: Float32Array | undefined,
    count: number,
    material: LineMaterialWithAlphaVertex,
  ): boolean {
    reserveSegments(batch, batch.count + count, (n) => new Float32Array(n));
    if (batch.count === 0) {
      batch.origin.setFromMatrixPosition(tempMatrix);
    }
    tempMatrix.setPosition(tempPosition.setFromMatrixPosition(tempMatrix).sub(batch.origin));
    if (!bakeSegments(batch.positions, batch.count, positions, count, tempMatrix)) {
      return false;
    }
    const colorStart = batch.count * 8;
    if (colors) {
      batch.colors.set(colors.subarray(0, count * 8), colorStart);
    } else {
      const { r, g, b } = material.color;
      const a = material.opacity;
      for (let i = colorStart; i < colorStart + count * 8; i += 4) {
        batch.colors[i] = r;
        batch.colors[i + 1] = g;
        batch.colors[i + 2] = b;
        batch.colors[i + 3] = a;
      }
    }
    batch.count += count;
    return true;
  }

  #disposeAlphaLineBatch(batch: AlphaLineBatch): void {
    batch.line.removeFromParent();
    batch.line.material.dispose();
    batch.line.geometry.dispose();
  }

  #disposeLineBatch(batch: LineBatch): void {
    batch.depth.removeFromParent();
    batch.color.removeFromParent();
    batch.depth.material.dispose();
    batch.color.material.dispose();
    batch.color.geometry.dispose();
  }

  public end(): void {
    this.#pendingLines.clear();
    for (const [key, batch] of this.#alphaLineBatches) {
      if (batch.count === 0) {
        this.#disposeAlphaLineBatch(batch);
        this.#alphaLineBatches.delete(key);
        continue;
      }
      batch.line.position.copy(batch.origin);
      // Only the segments in use: the buffers keep their capacity across fills
      setLinePositions(batch.line.geometry, batch.positions);
      setLineColors(batch.line.geometry, batch.colors);
      batch.line.geometry.instanceCount = batch.count;
    }
    for (const [key, batch] of this.#lineBatches) {
      if (batch.count === 0) {
        this.#disposeLineBatch(batch);
        this.#lineBatches.delete(key);
        continue;
      }
      batch.depth.position.copy(batch.origin);
      batch.color.position.copy(batch.origin);
      setLinePositions(batch.color.geometry, batch.positions);
      setLineColors(batch.color.geometry, batch.colors);
      batch.color.geometry.instanceCount = batch.count;
    }
    for (const [key, batch] of this.#batches) {
      // Moving topics can visit arbitrarily many cells. Release the inactive cells each fill.
      if (batch.meshCount === 0) {
        this.#disposeBatch(batch);
        this.#batches.delete(key);
        continue;
      }
      batch.mesh.count = batch.meshCount;
      batch.mesh.position.copy(batch.origin);
      batch.unsorted = true;
      markUsed(batch.mesh.instanceMatrix, batch.meshCount);
      batch.mesh.computeBoundingSphere();
      if (batch.mesh.instanceColor) {
        markUsed(batch.mesh.instanceColor, batch.meshCount);
      }
      if (batch.outline) {
        batch.outline.count = batch.outlineCount;
        batch.outline.position.copy(batch.origin);
        if (batch.mesh.boundingSphere) {
          batch.outline.boundingSphere.copy(batch.mesh.boundingSphere);
        }
        markUsed(batch.outline.instanceMatrix, batch.outlineCount);
      }
    }
  }

  public override dispose(): void {
    this.#pendingLines.clear();
    for (const batch of this.#alphaLineBatches.values()) {
      this.#disposeAlphaLineBatch(batch);
    }
    this.#alphaLineBatches.clear();
    for (const batch of this.#lineBatches.values()) {
      this.#disposeLineBatch(batch);
    }
    this.#lineBatches.clear();
    for (const batch of this.#batches.values()) {
      this.#disposeBatch(batch);
    }
    this.#batches.clear();
    this.clear();
  }

  #disposeBatch(batch: Batch): void {
    batch.mesh.removeFromParent();
    batch.mesh.material.dispose();
    batch.mesh.dispose();
    batch.outline?.removeFromParent();
    batch.outline?.dispose();
  }

  #batchFor(
    geometry: THREE.BufferGeometry,
    edges: THREE.BufferGeometry | undefined,
    position: THREE.Vector3,
    opacity: number,
  ): Batch {
    // A shape batches with or without its outline, never both ways in one batch
    const key = `${geometry.id}:${edges?.id}:${cellKey(position)}:${opacity}`;
    let batch = this.#batches.get(key);
    if (!batch) {
      const transparent = opacity < 1;
      const material = new THREE.MeshStandardMaterial({
        metalness: 0,
        roughness: 1,
        dithering: true,
        opacity,
        transparent,
        depthWrite: !transparent,
      });
      const instanced = new THREE.InstancedMesh(geometry, material, 0);
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.userData.picking = false;
      this.add(instanced);
      let instancedOutline: InstancedLineSegments | undefined;
      if (edges) {
        instancedOutline = new InstancedLineSegments(edges, this.#outlineMaterial);
        instancedOutline.userData.picking = false;
        this.add(instancedOutline);
      }
      batch = {
        mesh: instanced,
        outline: instancedOutline,
        meshCount: 0,
        outlineCount: 0,
        origin: new THREE.Vector3(),
        unsorted: true,
        sortedFor: [0, 0, 0],
      };
      if (transparent) {
        const sorted = batch;
        instanced.onBeforeRender = (_renderer, _scene, camera) => {
          sortBackToFront(sorted, camera);
        };
      }
      this.#batches.set(key, batch);
    }
    return batch;
  }
}
