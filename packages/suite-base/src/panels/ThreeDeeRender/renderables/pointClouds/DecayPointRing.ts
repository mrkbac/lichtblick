// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import type { RosValue } from "@lichtblick/suite-base/players/types";

import { BaseUserData, Renderable } from "../../Renderable";
import type { Renderer } from "../../Renderer";
import type { LayerSettingsPointExtension } from "../../settingsNodes/topics";
import { makePose, Pose } from "../../transforms";
import {
  createCubeMaterials,
  createPickingMaterial,
  CubeMaterials,
  disposeCubeMaterials,
  HistoryLimits,
  instancedCopy,
  PointMeshShape,
  pointCloudMaterial,
  resetInstanceLimit,
  ScanPoses,
  UNIT_CUBE_EDGES,
  UNIT_GEOMETRY,
} from "../pointExtensionUtils";

/** One accumulated scan: a contiguous range of the ring's buffers */
type RingScan = {
  receiveTime: bigint;
  messageTime: bigint;
  frameId: string;
  /** The message's own pose in its frame */
  pose: Pose;
  slot: number;
  start: number;
  count: number;
};

export type RingScanInfo = Pick<RingScan, "receiveTime" | "messageTime" | "frameId" | "pose">;

export type RingShape = { shape: PointMeshShape | undefined; showOutline: boolean };

const tempPose = makePose();
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const tempPoint = new THREE.Vector3();

/** Instanced alias of one point array: its own GL buffer, viewed from the first live point */
type InstanceAlias = { buffer: THREE.InstancedInterleavedBuffer; normalized: boolean };

/**
 * Older scans of a point cloud decay history, accumulated in one set of GPU buffers.
 *
 * A history of N scans used to be N objects: N buffers allocated and freed per scan and N draw
 * calls per frame. Here scans are written into a ring of preallocated buffers and drawn with one
 * draw call. Every point still gets exactly its own scan's transform: each point stores its scan's
 * slot, and a small texture with one matrix per slot is refreshed every frame, so late transforms
 * and frame changes move old scans just like separate objects. Points of free slots and evicted
 * scans point at an all-zero row, which hides them.
 */
export class DecayPointRing extends Renderable<BaseUserData, /*TRenderer=*/ undefined> {
  public override pickable = true;
  // Old scans keep only their geometry (as before), so there are no per-point details to show
  public override pickableInstances = false;

  readonly #limits: HistoryLimits;
  /** Row index of the all-zero matrix */
  readonly #hiddenSlot: number;
  #capacity = 0;
  #position = new THREE.BufferAttribute(new Float32Array(0), 3);
  #color = new THREE.BufferAttribute(new Uint8Array(0), 4, true);
  #scanSlot = new THREE.BufferAttribute(new Uint16Array(0), 1);
  #scans: RingScan[] = [];
  #freeSlots: number[];
  #poseData: Float32Array;
  #poseTexture: THREE.DataTexture;
  readonly #scanPoses: ScanPoses;
  /** Receive time of the newest scan evicted to stay in budget, not because it expired */
  #budgetEvictedUntil: bigint | undefined;
  /** Points across live scans (the buffers can be larger, e.g. after one oversized scan) */
  #livePoints = 0;
  /** First live point of the current draw, where the instance views start */
  #drawStart = 0;

  #geometry = new THREE.BufferGeometry();
  #points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  #material: THREE.PointsMaterial;
  #pickingMaterial: THREE.ShaderMaterial;
  #cubeMaterials: CubeMaterials;
  #shape: RingShape = { shape: undefined, showOutline: false };
  #cubes?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshLambertMaterial>;
  #outline?: THREE.LineSegments<THREE.InstancedBufferGeometry, THREE.LineBasicMaterial>;
  /** Instanced aliases of the point arrays for cubes (their own GL buffers, like PointsRenderable) */
  #instanceAttributes?: {
    instancePosition: InstanceAlias;
    color: InstanceAlias;
    scanSlot: InstanceAlias;
  };

  public constructor(topic: string, settings: LayerSettingsPointExtension, limits: HistoryLimits) {
    super(`${topic}:decay`, undefined, {
      receiveTime: -1n,
      messageTime: -1n,
      frameId: "",
      pose: makePose(),
      settingsPath: [],
      settings: { visible: true },
      topic,
    });
    this.#limits = limits;
    this.#hiddenSlot = limits.maxEntries;
    this.#freeSlots = Array.from(
      { length: limits.maxEntries },
      (_, i) => limits.maxEntries - 1 - i,
    );
    this.#poseData = new Float32Array(4 * 4 * (limits.maxEntries + 1));
    this.#poseTexture = new THREE.DataTexture(
      this.#poseData,
      4,
      limits.maxEntries + 1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.#poseTexture.needsUpdate = true;
    this.#scanPoses = { value: this.#poseTexture };

    this.#material = pointCloudMaterial(settings, this.#scanPoses);
    this.#pickingMaterial = createPickingMaterial(settings, this.#scanPoses);
    this.#cubeMaterials = createCubeMaterials(settings, this.#scanPoses);
    this.#setAttributes();
    this.#points = new THREE.Points(this.#geometry, this.#material);
    this.#points.frustumCulled = false;
    this.#points.name = `${topic}:PointCloud:decay`;
    this.#points.userData = {
      pickingMaterial: this.#pickingMaterial,
      pose: this.userData.pose,
      computeBounds: this.#computeBounds,
    };
    this.add(this.#points);
    this.visible = false;
  }

  public override dispose(): void {
    this.#geometry.dispose();
    this.#cubes?.geometry.dispose();
    this.#outline?.geometry.dispose();
    this.#material.dispose();
    this.#pickingMaterial.dispose();
    disposeCubeMaterials(this.#cubeMaterials);
    this.#poseTexture.dispose();
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    return {};
  }

  /** Number of accumulated scans */
  public scanCount(): number {
    return this.#scans.length;
  }

  /** Total points across accumulated scans */
  public pointCount(): number {
    return this.#livePoints;
  }

  /** Receive time of the oldest accumulated scan */
  public oldestReceiveTime(): bigint | undefined {
    return this.#scans[0]?.receiveTime;
  }

  /**
   * Receive time of the newest scan that was dropped to stay within the limits rather than because
   * it expired. Once this is older than the decay window, nothing in the window is missing.
   */
  public budgetEvictedUntil(): bigint | undefined {
    return this.#budgetEvictedUntil;
  }

  /** Rebuilds materials when `rebuild` is set, otherwise updates the sizes in place */
  public updateSettings(
    settings: LayerSettingsPointExtension,
    { rebuild }: { rebuild: boolean },
  ): void {
    if (rebuild) {
      this.#material.dispose();
      this.#pickingMaterial.dispose();
      disposeCubeMaterials(this.#cubeMaterials);
      this.#material = pointCloudMaterial(settings, this.#scanPoses);
      this.#pickingMaterial = createPickingMaterial(settings, this.#scanPoses);
      this.#cubeMaterials = createCubeMaterials(settings, this.#scanPoses);
      this.#points.material = this.#material;
      this.#points.userData.pickingMaterial = this.#pickingMaterial;
      this.#applyShape();
    } else {
      this.#material.size = settings.pointSize;
      this.#cubeMaterials.cubeSize.value = settings.cubeSize;
    }
  }

  /** Draw points as GL points (`shape` undefined) or as instanced cubes/spheres */
  public setShape(shape: RingShape): void {
    this.#shape = shape;
    this.#applyShape();
  }

  /**
   * Copies a decoded scan into the ring. Evicts the oldest scans when the ring is out of space or
   * slots, after growing up to the point budget.
   */
  public push(info: RingScanInfo, positions: Float32Array, colors: Uint8Array): void {
    const count = positions.length / 3;
    if (count === 0) {
      return;
    }
    if (this.#freeSlots.length === 0) {
      this.#evictOldest({ budget: true });
    }
    const start = this.#allocate(count);
    const slot = this.#freeSlots.pop()!;
    this.#scans.push({ ...info, slot, start, count });
    this.#livePoints += count;

    this.#position.array.set(positions, start * 3);
    this.#color.array.set(colors, start * 4);
    (this.#scanSlot.array as Uint16Array).fill(slot, start, start + count);
    this.#markRange(start, count);
  }

  /**
   * Evicts the oldest scans until the history plus `reservePoints` and one scan (the latest, drawn
   * separately) fit in the limits. A latest scan bigger than the budget leaves no history.
   */
  public enforceLimits({ reservePoints }: { reservePoints: number }): void {
    while (
      this.#scans.length > 0 &&
      (this.#livePoints + reservePoints > this.#limits.maxPoints ||
        this.#scans.length + 1 > this.#limits.maxEntries)
    ) {
      this.#evictOldest({ budget: true });
    }
  }

  /** Drops scans received before `expireTime` */
  public expire(expireTime: bigint): void {
    while (this.#scans.length > 0 && this.#scans[0]!.receiveTime < expireTime) {
      this.#evictOldest({ budget: false });
    }
  }

  /**
   * Refreshes every scan's matrix for this frame. Returns the frame of the first scan without a
   * transform, or undefined when all resolved.
   */
  public updatePoses(
    transformTree: Renderer["transformTree"],
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): string | undefined {
    let missingFrame: string | undefined;
    const data = this.#poseData;
    data.fill(0);
    // Matrices are relative to the newest scan's origin so they stay small in float32 even for
    // far-away (e.g. UTM) coordinates; this object carries the large offset in double precision
    let haveOrigin = false;
    for (let i = this.#scans.length - 1; i >= 0; i--) {
      const scan = this.#scans[i]!;
      const ok = transformTree.apply(
        tempPose,
        scan.pose,
        renderFrameId,
        fixedFrameId,
        scan.frameId,
        currentTime,
        scan.messageTime,
      );
      if (!ok) {
        missingFrame ??= scan.frameId;
        continue;
      }
      const p = tempPose.position;
      if (!haveOrigin) {
        this.position.set(p.x, p.y, p.z);
        haveOrigin = true;
      }
      const q = tempPose.orientation;
      tempPosition.set(p.x - this.position.x, p.y - this.position.y, p.z - this.position.z);
      tempQuaternion.set(q.x, q.y, q.z, q.w);
      tempMatrix.compose(tempPosition, tempQuaternion, UNIT_SCALE);
      data.set(tempMatrix.elements, scan.slot * 16);
    }
    this.#poseTexture.needsUpdate = true;
    this.#updateDrawRange();
    return missingFrame;
  }

  /**
   * Zoom to Data bounds in this object's space: live, resolved scans placed by their matrices, as
   * the shader draws them (the raw buffers hold scan-local and expired points).
   */
  #computeBounds = (box: THREE.Box3): void => {
    const positions = this.#position.array;
    for (const scan of this.#scans) {
      if (this.#poseData[scan.slot * 16 + 15] === 0) {
        continue; // hidden: no transform
      }
      tempMatrix.fromArray(this.#poseData, scan.slot * 16);
      for (let i = scan.start * 3; i < (scan.start + scan.count) * 3; i += 3) {
        tempPoint.fromArray(positions, i).applyMatrix4(tempMatrix);
        if (Number.isFinite(tempPoint.x + tempPoint.y + tempPoint.z)) {
          box.expandByPoint(tempPoint);
        }
      }
    }
  };

  #setAttributes(): void {
    this.#geometry.setAttribute("position", this.#position);
    this.#geometry.setAttribute("color", this.#color);
    this.#geometry.setAttribute("scanSlot", this.#scanSlot);
    this.#instanceAttributes = undefined;
    this.#syncCubes();
  }

  /**
   * Start of a free range of `count` points: after the newest scan, else at the start (space freed
   * by expired scans), else any other free gap, else in grown buffers, else evicting the oldest
   * scans once at the budget.
   */
  #allocate(count: number): number {
    const fits = (start: number) =>
      start + count <= this.#capacity && !this.#overlapsScan(start, count);
    const newest = this.#scans[this.#scans.length - 1];
    const next = newest ? newest.start + newest.count : 0;
    if (fits(next)) {
      return next;
    }
    if (fits(0)) {
      return 0;
    }
    const gap = this.#findGap(count);
    if (gap != undefined) {
      return gap;
    }
    // A single scan bigger than the budget still fits; the budget only limits accumulation
    const maxCapacity = Math.max(this.#limits.maxPoints, count);
    if (this.#capacity < maxCapacity) {
      let top = 0;
      for (const scan of this.#scans) {
        top = Math.max(top, scan.start + scan.count);
      }
      this.#grow(Math.min(maxCapacity, Math.max(this.#capacity * 2, top + count, count * 4)));
      if (top + count <= this.#capacity) {
        return top;
      }
    }
    const start = next + count <= this.#capacity ? next : 0;
    // Evict in age order: an older scan never outlives a newer one
    while (this.#overlapsScan(start, count)) {
      this.#evictOldest({ budget: true });
    }
    return start;
  }

  /** First free range of `count` points between live scans or after the last one */
  #findGap(count: number): number | undefined {
    const byStart = [...this.#scans].sort((a, b) => a.start - b.start);
    let free = 0;
    for (const scan of byStart) {
      if (scan.start - free >= count) {
        return free;
      }
      free = scan.start + scan.count;
    }
    return this.#capacity - free >= count ? free : undefined;
  }

  #overlapsScan(start: number, count: number): boolean {
    const end = start + count;
    return this.#scans.some((scan) => scan.start < end && scan.start + scan.count > start);
  }

  /** Grows the buffers, keeping every scan at its offset */
  #grow(capacity: number): void {
    const position = new Float32Array(capacity * 3);
    const color = new Uint8Array(capacity * 4);
    const scanSlot = new Uint16Array(capacity);
    position.set(this.#position.array);
    color.set(this.#color.array);
    scanSlot.set(this.#scanSlot.array);
    scanSlot.fill(this.#hiddenSlot, this.#capacity);
    this.#capacity = capacity;
    // three.js frees GL buffers only for the attributes installed when the geometry is disposed
    this.#geometry.dispose();
    // New attribute objects get new GL buffers, uploaded in full on first use
    this.#position = new THREE.BufferAttribute(position, 3);
    this.#color = new THREE.BufferAttribute(color, 4, true);
    this.#scanSlot = new THREE.BufferAttribute(scanSlot, 1);
    for (const attribute of [this.#position, this.#color, this.#scanSlot]) {
      attribute.setUsage(THREE.DynamicDrawUsage);
    }
    this.#setAttributes();
  }

  #evictOldest({ budget }: { budget: boolean }): void {
    const scan = this.#scans.shift();
    if (!scan) {
      return;
    }
    if (budget) {
      this.#budgetEvictedUntil = scan.receiveTime;
    }
    this.#livePoints -= scan.count;
    (this.#scanSlot.array as Uint16Array).fill(
      this.#hiddenSlot,
      scan.start,
      scan.start + scan.count,
    );
    this.#markSlotRange(scan.start, scan.count);
    this.#freeSlots.push(scan.slot);
  }

  /**
   * Queues a partial upload of newly written points. Only for attributes that get drawn: three.js
   * uploads (and clears the ranges of) visible objects only.
   */
  #markRange(start: number, count: number): void {
    if (this.#points.visible) {
      addRange(this.#position, start, count);
      addRange(this.#color, start, count);
    }
    this.#markSlotRange(start, count);
    if (this.#instanceAttributes) {
      addRange(this.#instanceAttributes.instancePosition.buffer, start, count);
      addRange(this.#instanceAttributes.color.buffer, start, count);
    }
  }

  #markSlotRange(start: number, count: number): void {
    if (this.#points.visible) {
      addRange(this.#scanSlot, start, count);
    }
    if (this.#instanceAttributes) {
      addRange(this.#instanceAttributes.scanSlot.buffer, start, count);
    }
  }

  /** Draws only the span holding live scans; anything else in it is hidden by its slot */
  #updateDrawRange(): void {
    let start = Infinity;
    let end = 0;
    for (const scan of this.#scans) {
      start = Math.min(start, scan.start);
      end = Math.max(end, scan.start + scan.count);
    }
    this.visible = this.#scans.length > 0;
    if (!this.visible) {
      start = end = 0;
      this.#discardPendingUploads();
    }
    this.#geometry.setDrawRange(start, end - start);
    if (start !== this.#drawStart) {
      this.#drawStart = start;
      this.#setInstanceViews();
    }
    for (const geometry of [this.#cubes?.geometry, this.#outline?.geometry]) {
      if (geometry) {
        geometry.instanceCount = end - start;
      }
    }
  }

  /**
   * three.js skips hidden objects, so ranges queued while the ring is empty would pile up. Drop them
   * and upload everything once the ring is drawn again.
   */
  #discardPendingUploads(): void {
    const targets: (THREE.BufferAttribute | THREE.InterleavedBuffer)[] = [
      this.#position,
      this.#color,
      this.#scanSlot,
    ];
    if (this.#instanceAttributes) {
      const { instancePosition, color, scanSlot } = this.#instanceAttributes;
      targets.push(instancePosition.buffer, color.buffer, scanSlot.buffer);
    }
    for (const target of targets) {
      target.clearUpdateRanges();
      target.needsUpdate = true;
    }
  }

  /** Points the instanced attributes at the first live point, so expired ones are not submitted */
  #setInstanceViews(): void {
    if (!this.#instanceAttributes) {
      return;
    }
    for (const geometry of [this.#cubes?.geometry, this.#outline?.geometry]) {
      for (const [name, alias] of Object.entries(this.#instanceAttributes)) {
        const { stride } = alias.buffer;
        geometry?.setAttribute(
          name,
          new THREE.InterleavedBufferAttribute(
            alias.buffer,
            stride,
            this.#drawStart * stride,
            alias.normalized,
          ),
        );
      }
    }
  }

  #applyShape(): void {
    const { shape, showOutline } = this.#shape;
    if (shape == undefined && !this.#points.visible) {
      // Writes were not queued while hidden: upload everything
      for (const attribute of [this.#position, this.#color, this.#scanSlot]) {
        attribute.clearUpdateRanges();
        attribute.needsUpdate = true;
      }
    }
    this.#points.visible = shape == undefined;
    if (this.#cubes && (shape == undefined || this.#cubes.userData.shape !== shape)) {
      this.remove(this.#cubes);
      this.#cubes.geometry.dispose();
      this.#cubes = undefined;
    }
    if (this.#outline && (shape !== "cube" || !showOutline)) {
      this.remove(this.#outline);
      this.#outline.geometry.dispose();
      this.#outline = undefined;
    }
    if (shape == undefined) {
      this.#instanceAttributes = undefined;
      return;
    }
    const materials = this.#cubeMaterials;
    if (!this.#cubes) {
      this.#cubes = new THREE.Mesh(instancedCopy(UNIT_GEOMETRY[shape]), materials.material);
      this.#cubes.frustumCulled = false;
      this.#cubes.name = `${this.userData.topic}:PointCloud:decay:${shape}s`;
      this.add(this.#cubes);
    }
    this.#cubes.material = materials.material;
    this.#cubes.userData = {
      shape,
      pickingMaterial: materials.pickingMaterial,
      computeBounds: this.#computeBounds,
    };
    if (shape === "cube" && showOutline) {
      if (!this.#outline) {
        this.#outline = new THREE.LineSegments(
          instancedCopy(UNIT_CUBE_EDGES),
          materials.outlineMaterial,
        );
        this.#outline.frustumCulled = false;
        this.#outline.userData.picking = false;
        this.#outline.name = `${this.userData.topic}:PointCloud:decay:outline`;
        this.add(this.#outline);
      }
      this.#outline.material = materials.outlineMaterial;
    }
    this.#instanceAttributes = undefined;
    this.#syncCubes();
  }

  /** (Re)creates the instanced aliases, uploaded in full on first use */
  #syncCubes(): void {
    if (!this.#cubes) {
      return;
    }
    if (!this.#instanceAttributes) {
      const alias = (array: THREE.TypedArray, stride: number, { normalized = false } = {}) => ({
        buffer: new THREE.InstancedInterleavedBuffer(array, stride, 1),
        normalized,
      });
      this.#instanceAttributes = {
        instancePosition: alias(this.#position.array, 3),
        color: alias(this.#color.array, 4, { normalized: true }),
        scanSlot: alias(this.#scanSlot.array, 1),
      };
      resetInstanceLimit(this.#cubes.geometry);
      if (this.#outline) {
        resetInstanceLimit(this.#outline.geometry);
      }
    }
    this.#setInstanceViews();
    this.#updateDrawRange();
  }
}

function addRange(
  target: THREE.BufferAttribute | THREE.InterleavedBuffer,
  start: number,
  count: number,
): void {
  const stride = target instanceof THREE.InterleavedBuffer ? target.stride : target.itemSize;
  target.addUpdateRange(start * stride, count * stride);
  target.needsUpdate = true;
}
