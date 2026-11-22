// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";

import { RenderableArrow } from "./RenderableArrow";
import { RenderableCube } from "./RenderableCube";
import { RenderableCylinder } from "./RenderableCylinder";
import { RenderableLineList } from "./RenderableLineList";
import { RenderableLineStrip } from "./RenderableLineStrip";
import type { RenderableMarker } from "./RenderableMarker";
import { RenderableSphere } from "./RenderableSphere";
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

function cellKey(position: THREE.Vector3): string {
  const x = Math.floor(position.x / BATCH_CELL_SIZE);
  const y = Math.floor(position.y / BATCH_CELL_SIZE);
  const z = Math.floor(position.z / BATCH_CELL_SIZE);
  return `${x}:${y}:${z}`;
}

function isFinitePosition(position: THREE.Vector3): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

const markerMatrix = new THREE.Matrix4();
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempColor = new THREE.Color();

/**
 * Draws a topic's opaque cube, sphere, cylinder and arrow markers (with outlines) with one instanced
 * draw per shape and cell instead of one or two draws per marker. Per-object costs in the renderer dominate
 * frames with thousands of markers, more so while they move. The markers keep their own meshes on
 * LAYER_PICK_ONLY, so picking, selection and the inspector see each marker as before.
 * Transparent markers draw on their own: instances could not be sorted back to front.
 */
export class MarkerBatches extends THREE.Object3D {
  #batches = new Map<string, Batch>();
  #lineBatches = new Map<string, LineBatch>();
  #pendingLines = new Map<string, LineBatchEntry>();
  #outlineMaterial: THREE.Material;

  public constructor(outlineMaterial: THREE.Material) {
    super();
    this.#outlineMaterial = outlineMaterial;
    this.userData.picking = false;
  }

  public begin(): void {
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
    if (!(color.a >= 1)) {
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
    // A reflected matrix needs flipped winding. Non-finite poses cannot seed a batch origin.
    const position = tempPosition.setFromMatrixPosition(tempMatrix);
    const determinant = tempMatrix.determinant();
    const batch =
      isFinitePosition(position) && Number.isFinite(determinant) && determinant > 0
        ? this.#batchFor(mesh, outline, position)
        : undefined;
    setPickOnly(mesh, { pickOnly: batch != undefined });
    if (outline) {
      setPickOnly(outline, { pickOnly: batch != undefined });
    }
    if (!batch) {
      return;
    }
    if (batch.meshCount === 0) {
      batch.origin.copy(position);
    }
    tempMatrix.setPosition(position.sub(batch.origin));
    reserve(batch.mesh, batch.meshCount + 1);
    batch.mesh.setMatrixAt(batch.meshCount, tempMatrix);
    batch.mesh.setColorAt(batch.meshCount, rgbToThreeColor(tempColor, color));
    batch.meshCount++;
    if (outline?.visible === true && batch.outline) {
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
    if ((batch.count + count) * 6 > batch.positions.length) {
      const capacity = Math.min(
        MAX_BATCH_LINE_SEGMENTS,
        Math.max(batch.count + count, batch.positions.length / 3, 16),
      );
      const resizedPositions = new Float32Array(capacity * 6);
      resizedPositions.set(batch.positions);
      const resizedColors = new Uint8Array(capacity * 8);
      resizedColors.set(batch.colors);
      if (batch.positions.length > 0) {
        batch.color.geometry.dispose();
        batch.depth.geometry = batch.color.geometry = new LineSegmentsGeometry();
      }
      batch.positions = resizedPositions;
      batch.colors = resizedColors;
    }
    markerMatrix.compose(marker.position, marker.quaternion, marker.scale);
    markerMatrix.setPosition(tempPosition.subVectors(marker.position, batch.origin));
    const start = batch.count * 6;
    for (let i = 0; i < count * 6; i += 6) {
      const index = start + i;
      tempPosition.set(positions[i]!, positions[i + 1]!, positions[i + 2]);
      tempPosition.applyMatrix4(markerMatrix).toArray(batch.positions, index);
      tempPosition.set(positions[i + 3]!, positions[i + 4]!, positions[i + 5]);
      tempPosition.applyMatrix4(markerMatrix).toArray(batch.positions, index + 3);
      // Baking into a shared float32 buffer must not collapse an originally distinct endpoint.
      if (
        batch.positions[index] === batch.positions[index + 3] &&
        batch.positions[index + 1] === batch.positions[index + 4] &&
        batch.positions[index + 2] === batch.positions[index + 5] &&
        (positions[i] !== positions[i + 3] ||
          positions[i + 1] !== positions[i + 4] ||
          positions[i + 2] !== positions[i + 5])
      ) {
        return false;
      }
    }
    batch.colors.set(colors.subarray(0, count * 8), batch.count * 8);
    batch.count += count;
    setPickOnly(marker.line, { pickOnly: true });
    setPickOnly(marker.linePrepass, { pickOnly: true });
    return true;
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
    mesh: MarkerMesh,
    outline: THREE.LineSegments | undefined,
    position: THREE.Vector3,
  ): Batch {
    const key = `${mesh.geometry.id}:${cellKey(position)}`;
    let batch = this.#batches.get(key);
    if (!batch) {
      const material = new THREE.MeshStandardMaterial({
        metalness: 0,
        roughness: 1,
        dithering: true,
      });
      const instanced = new THREE.InstancedMesh(mesh.geometry, material, 0);
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.userData.picking = false;
      this.add(instanced);
      let instancedOutline: InstancedLineSegments | undefined;
      if (outline) {
        instancedOutline = new InstancedLineSegments(outline.geometry, this.#outlineMaterial);
        instancedOutline.userData.picking = false;
        this.add(instancedOutline);
      }
      batch = {
        mesh: instanced,
        outline: instancedOutline,
        meshCount: 0,
        outlineCount: 0,
        origin: new THREE.Vector3(),
      };
      this.#batches.set(key, batch);
    }
    return batch;
  }
}
