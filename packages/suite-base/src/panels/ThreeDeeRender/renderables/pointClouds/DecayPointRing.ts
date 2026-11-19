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

/** Instanced alias of one point array: its own GL buffer, viewed from a span's first point */
type InstanceAlias = { buffer: THREE.InstancedInterleavedBuffer; normalized: boolean };
type InstanceAliases = Record<"instancePosition" | "color" | "scanSlot", InstanceAlias>;

/**
 * A contiguous range of live points, drawn by its own objects over the shared buffers. Two spans
 * cover a ring that wrapped around without drawing the free gap between them.
 */
type DrawSpan = {
  geometry: THREE.BufferGeometry;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  cubes?: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshLambertMaterial>;
  outline?: THREE.LineSegments<THREE.InstancedBufferGeometry, THREE.LineBasicMaterial>;
  start: number;
  count: number;
};

const noBounds = (): void => {};

/** Queued partial uploads per buffer before it falls back to one full upload */
const MAX_UPDATE_RANGES = 64;

type UploadTarget = THREE.BufferAttribute | THREE.InterleavedBuffer;

/**
 * Older scans of a point cloud decay history, accumulated in one set of GPU buffers.
 *
 * A history of N scans used to be N objects: N buffers allocated and freed per scan and N draw
 * calls per frame. Here scans are written into a ring of preallocated buffers and drawn with at
 * most two draw calls. Every point still gets exactly its own scan's transform: each point stores
 * its scan's slot, and a small texture with one matrix per slot is refreshed every frame, so late
 * transforms and frame changes move old scans just like separate objects. Points of free slots and
 * evicted scans point at an all-zero row, which hides them.
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
  /**
   * Buffers whose queued partial uploads were dropped: they must be uploaded whole, so no partial
   * ranges are queued for them until three.js reports an upload. Frames can run without drawing
   * (a hidden tab), so only the upload itself clears this.
   */
  #fullUploadPending = new WeakSet<UploadTarget>();

  #material: THREE.PointsMaterial;
  #pickingMaterial: THREE.ShaderMaterial;
  #cubeMaterials: CubeMaterials;
  #shape: RingShape = { shape: undefined, showOutline: false };
  readonly #spans: [DrawSpan, DrawSpan];
  /** Instanced aliases of the point arrays for cubes (their own GL buffers, like PointsRenderable) */
  #instanceAttributes?: InstanceAliases;

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
    const makeSpan = (index: number): DrawSpan => {
      const geometry = new THREE.BufferGeometry();
      const points = new THREE.Points(geometry, this.#material);
      points.frustumCulled = false;
      points.name = `${topic}:PointCloud:decay:${index}`;
      points.userData = {
        pickingMaterial: this.#pickingMaterial,
        pose: this.userData.pose,
        // The first span reports the bounds of all scans
        computeBounds: index === 0 ? this.#computeBounds : noBounds,
      };
      this.add(points);
      return { geometry, points, start: 0, count: 0 };
    };
    this.#spans = [makeSpan(0), makeSpan(1)];
    this.#setAttributes();
    this.visible = false;
  }

  public override dispose(): void {
    for (const span of this.#spans) {
      span.geometry.dispose();
      span.cubes?.geometry.dispose();
      span.outline?.geometry.dispose();
    }
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

  /** The drawn ranges of live points, for tests */
  public drawSpans(): { start: number; count: number }[] {
    return this.#spans
      .filter((span) => span.count > 0)
      .map(({ start, count }) => ({ start, count }));
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
      for (const { points } of this.#spans) {
        points.material = this.#material;
        points.userData.pickingMaterial = this.#pickingMaterial;
      }
      this.#applyShape();
    } else {
      this.#material.size = settings.pointSize;
      this.#cubeMaterials.cubeSize.value = settings.cubeSize;
    }
  }

  /** Draw points as GL points (`shape` undefined) or as instanced cubes/spheres */
  public setShape(shape: RingShape): void {
    const wasPoints = this.#shape.shape == undefined;
    this.#shape = shape;
    if (shape.shape == undefined && !wasPoints) {
      // Writes were not queued while drawing shapes: upload everything
      for (const attribute of [this.#position, this.#color, this.#scanSlot]) {
        attribute.clearUpdateRanges();
        attribute.needsUpdate = true;
      }
    }
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
    this.#updateDrawSpans();
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
    for (const { geometry } of this.#spans) {
      geometry.setAttribute("position", this.#position);
      geometry.setAttribute("color", this.#color);
      geometry.setAttribute("scanSlot", this.#scanSlot);
    }
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
    let free = 0;
    for (const scan of this.#scansByStart()) {
      if (scan.start - free >= count) {
        return free;
      }
      free = scan.start + scan.count;
    }
    return this.#capacity - free >= count ? free : undefined;
  }

  #scansByStart(): RingScan[] {
    return [...this.#scans].sort((a, b) => a.start - b.start);
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
    for (const { geometry } of this.#spans) {
      geometry.dispose();
    }
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
    if (this.#shape.shape == undefined) {
      this.#addRange(this.#position, start, count);
      this.#addRange(this.#color, start, count);
    }
    this.#markSlotRange(start, count);
    if (this.#instanceAttributes) {
      this.#addRange(this.#instanceAttributes.instancePosition.buffer, start, count);
      this.#addRange(this.#instanceAttributes.color.buffer, start, count);
    }
  }

  #markSlotRange(start: number, count: number): void {
    if (this.#shape.shape == undefined) {
      this.#addRange(this.#scanSlot, start, count);
    }
    if (this.#instanceAttributes) {
      this.#addRange(this.#instanceAttributes.scanSlot.buffer, start, count);
    }
  }

  #addRange(target: UploadTarget, start: number, count: number) {
    if (target.updateRanges.length >= MAX_UPDATE_RANGES) {
      // Not drawn for a while (e.g. a hidden tab): stop queueing and upload it whole
      this.#requireFullUpload(target);
    } else if (!this.#fullUploadPending.has(target)) {
      const stride = target instanceof THREE.InterleavedBuffer ? target.stride : target.itemSize;
      target.addUpdateRange(start * stride, count * stride);
    }
    target.needsUpdate = true;
  }

  #requireFullUpload(target: UploadTarget): void {
    target.clearUpdateRanges();
    target.needsUpdate = true;
    if (!this.#fullUploadPending.has(target)) {
      this.#fullUploadPending.add(target);
      target.onUpload(() => {
        this.#fullUploadPending.delete(target);
      });
    }
  }

  /**
   * Draws the live scans as at most two spans, split at the largest free gap between them (the
   * gap left when the ring wraps around). Points inside a span that are not live are hidden by
   * their slot.
   */
  #updateDrawSpans(): void {
    const [first, second] = this.#spans;
    first.start = first.count = second.start = second.count = 0;
    const sorted = this.#scansByStart();
    if (sorted.length > 0) {
      let splitAfter = -1;
      let largestGap = 0;
      for (let i = 0; i + 1 < sorted.length; i++) {
        const gap = sorted[i + 1]!.start - (sorted[i]!.start + sorted[i]!.count);
        if (gap > largestGap) {
          largestGap = gap;
          splitAfter = i;
        }
      }
      const end = (i: number) => sorted[i]!.start + sorted[i]!.count;
      const last = sorted.length - 1;
      first.start = sorted[0]!.start;
      first.count = end(splitAfter >= 0 ? splitAfter : last) - first.start;
      if (splitAfter >= 0) {
        second.start = sorted[splitAfter + 1]!.start;
        second.count = end(last) - second.start;
      }
    }

    this.visible = sorted.length > 0;
    if (!this.visible) {
      this.#discardPendingUploads();
    }
    const drawPoints = this.#shape.shape == undefined;
    for (const span of this.#spans) {
      span.geometry.setDrawRange(span.start, span.count);
      span.points.visible = drawPoints && span.count > 0;
      for (const mesh of [span.cubes, span.outline]) {
        if (mesh) {
          mesh.visible = span.count > 0;
          mesh.geometry.instanceCount = span.count;
        }
      }
    }
    this.#setInstanceViews();
  }

  /**
   * three.js skips hidden objects, so ranges queued while the ring is empty would pile up. Drop them
   * and upload whole buffers on the next draw.
   */
  #discardPendingUploads(): void {
    const targets: UploadTarget[] = [this.#position, this.#color, this.#scanSlot];
    if (this.#instanceAttributes) {
      const { instancePosition, color, scanSlot } = this.#instanceAttributes;
      targets.push(instancePosition.buffer, color.buffer, scanSlot.buffer);
    }
    for (const target of targets) {
      this.#requireFullUpload(target);
    }
  }

  /** Points each span's instanced attributes at its first point, so nothing before it is drawn */
  #setInstanceViews(): void {
    const aliases = this.#instanceAttributes;
    if (!aliases) {
      return;
    }
    for (const span of this.#spans) {
      for (const mesh of [span.cubes, span.outline]) {
        if (!mesh) {
          continue;
        }
        const current = mesh.geometry.getAttribute("instancePosition") as
          | THREE.InterleavedBufferAttribute
          | undefined;
        if (
          current?.data === aliases.instancePosition.buffer &&
          current.offset === span.start * 3
        ) {
          continue;
        }
        for (const [name, alias] of Object.entries(aliases)) {
          const { stride } = alias.buffer;
          mesh.geometry.setAttribute(
            name,
            new THREE.InterleavedBufferAttribute(
              alias.buffer,
              stride,
              span.start * stride,
              alias.normalized,
            ),
          );
        }
      }
    }
  }

  #applyShape(): void {
    const { shape, showOutline } = this.#shape;
    const materials = this.#cubeMaterials;
    for (const [index, span] of this.#spans.entries()) {
      if (span.cubes && (shape == undefined || span.cubes.userData.shape !== shape)) {
        this.remove(span.cubes);
        span.cubes.geometry.dispose();
        span.cubes = undefined;
      }
      if (span.outline && (shape !== "cube" || !showOutline)) {
        this.remove(span.outline);
        span.outline.geometry.dispose();
        span.outline = undefined;
      }
      if (shape == undefined) {
        continue;
      }
      if (!span.cubes) {
        span.cubes = new THREE.Mesh(instancedCopy(UNIT_GEOMETRY[shape]), materials.material);
        span.cubes.frustumCulled = false;
        span.cubes.name = `${this.userData.topic}:PointCloud:decay:${shape}s:${index}`;
        this.add(span.cubes);
      }
      span.cubes.material = materials.material;
      span.cubes.userData = {
        shape,
        pickingMaterial: materials.pickingMaterial,
        computeBounds: index === 0 ? this.#computeBounds : noBounds,
      };
      if (shape === "cube" && showOutline) {
        if (!span.outline) {
          span.outline = new THREE.LineSegments(
            instancedCopy(UNIT_CUBE_EDGES),
            materials.outlineMaterial,
          );
          span.outline.frustumCulled = false;
          span.outline.userData.picking = false;
          span.outline.name = `${this.userData.topic}:PointCloud:decay:outline:${index}`;
          this.add(span.outline);
        }
        span.outline.material = materials.outlineMaterial;
      }
    }
    this.#instanceAttributes = undefined;
    this.#syncCubes();
  }

  /** (Re)creates the instanced aliases, uploaded in full on first use */
  #syncCubes(): void {
    if (this.#shape.shape == undefined) {
      this.#updateDrawSpans();
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
      for (const span of this.#spans) {
        for (const mesh of [span.cubes, span.outline]) {
          if (mesh) {
            resetInstanceLimit(mesh.geometry);
          }
        }
      }
    }
    this.#updateDrawSpans();
  }
}
