// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { RenderableCube } from "./RenderableCube";
import { RenderableCylinder } from "./RenderableCylinder";
import type { RenderableMarker } from "./RenderableMarker";
import { RenderableSphere } from "./RenderableSphere";
import { rgbToThreeColor } from "../../color";
import { LAYER_DEFAULT, LAYER_PICK_ONLY, LAYER_SELECTED } from "../../layers";

/** A marker drawn as one mesh (and maybe an outline) that a batch can draw instead */
type BatchableMarker = RenderableCube | RenderableSphere | RenderableCylinder;

export function isBatchable(marker: RenderableMarker): marker is BatchableMarker {
  return (
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
  if (isBatchable(marker)) {
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
  object.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(next * 16), 16);
  object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Meshes take a color per instance; outlines share the outline material's
  if (object instanceof THREE.InstancedMesh) {
    // Floats: WebGPU has no 3-component 8-bit vertex format
    const color = new THREE.InstancedBufferAttribute(new Float32Array(next * 3), 3);
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

/** Uploads only the instances in use */
function markUsed(attribute: THREE.BufferAttribute, count: number): void {
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempColor = new THREE.Color();

/**
 * Draws a topic's opaque cube, sphere and cylinder markers (and their outlines) with one instanced
 * draw per shape instead of one or two draws per marker. Per-object costs in the renderer dominate
 * frames with thousands of markers, more so while they move. The markers keep their own meshes on
 * LAYER_PICK_ONLY, so picking, selection and the inspector see each marker as before.
 * Transparent markers draw on their own: instances could not be sorted back to front.
 */
export class MarkerBatches extends THREE.Object3D {
  #batches = new Map<THREE.BufferGeometry, Batch>();
  #outlineMaterial: THREE.Material;

  public constructor(outlineMaterial: THREE.Material) {
    super();
    this.#outlineMaterial = outlineMaterial;
    this.userData.picking = false;
  }

  public begin(): void {
    for (const batch of this.#batches.values()) {
      batch.meshCount = 0;
      batch.outlineCount = 0;
    }
  }

  /** Draws `marker` through a batch if it can be, or on its own otherwise */
  public addMarker(marker: BatchableMarker): void {
    const { mesh, outline } = marker;
    const opaque = marker.userData.marker.color.a >= 1;
    setPickOnly(mesh, { pickOnly: opaque });
    if (outline) {
      setPickOnly(outline, { pickOnly: opaque });
    }
    if (!opaque) {
      return;
    }

    const batch = this.#batchFor(mesh, outline);
    if (batch.meshCount === 0) {
      batch.origin.copy(marker.position);
    }
    // The mesh (and its outline) sit at the marker's origin, so the marker's local matrix places
    // them, relative to the batch origin
    tempPosition.subVectors(marker.position, batch.origin);
    tempMatrix.compose(tempPosition, marker.quaternion, marker.scale);
    reserve(batch.mesh, batch.meshCount + 1);
    batch.mesh.setMatrixAt(batch.meshCount, tempMatrix);
    batch.mesh.setColorAt(
      batch.meshCount,
      rgbToThreeColor(tempColor, marker.userData.marker.color),
    );
    batch.meshCount++;
    if (outline?.visible === true && batch.outline) {
      reserve(batch.outline, batch.outlineCount + 1);
      tempMatrix.toArray(batch.outline.instanceMatrix.array, batch.outlineCount * 16);
      batch.outlineCount++;
    }
  }

  public end(): void {
    for (const batch of this.#batches.values()) {
      batch.mesh.count = batch.meshCount;
      batch.mesh.position.copy(batch.origin);
      markUsed(batch.mesh.instanceMatrix, batch.meshCount);
      if (batch.mesh.instanceColor) {
        markUsed(batch.mesh.instanceColor, batch.meshCount);
      }
      if (batch.outline) {
        batch.outline.count = batch.outlineCount;
        batch.outline.position.copy(batch.origin);
        markUsed(batch.outline.instanceMatrix, batch.outlineCount);
      }
    }
  }

  public override dispose(): void {
    for (const batch of this.#batches.values()) {
      batch.mesh.material.dispose();
      batch.mesh.dispose();
      batch.outline?.dispose();
    }
    this.#batches.clear();
    this.clear();
  }

  // One batch per shared geometry: markers of one shape and detail level share theirs
  #batchFor(mesh: BatchableMarker["mesh"], outline: THREE.LineSegments | undefined): Batch {
    let batch = this.#batches.get(mesh.geometry);
    if (!batch) {
      const material = new THREE.MeshStandardMaterial({
        metalness: 0,
        roughness: 1,
        dithering: true,
      });
      const instanced = new THREE.InstancedMesh(mesh.geometry, material, 0);
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.frustumCulled = false;
      instanced.userData.picking = false;
      this.add(instanced);
      let instancedOutline: InstancedLineSegments | undefined;
      if (outline) {
        instancedOutline = new InstancedLineSegments(outline.geometry, this.#outlineMaterial);
        instancedOutline.frustumCulled = false;
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
      this.#batches.set(mesh.geometry, batch);
    }
    return batch;
  }
}
