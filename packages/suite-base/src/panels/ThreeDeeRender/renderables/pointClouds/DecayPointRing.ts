// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three/webgpu";

import type { RosValue } from "@lichtblick/suite-base/players/types";

import { MAX_SET_POINTS } from "./PointRaster";
import { POSE_FLOATS, PointColorEncoding, PointShape, RasterPoints } from "./RasterPoints";
import { BaseUserData, Renderable } from "../../Renderable";
import type { Renderer } from "../../Renderer";
import { makePose, Pose } from "../../transforms";
import type { HistoryLimits } from "../pointExtensionUtils";

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

/** How the ring draws its points (mirrors the topic's point settings) */
export type RingStyle = {
  shape: PointShape;
  /** Squares instead of circles, for the point shape */
  square: boolean;
  pointSize: number;
  cubeSize: number;
  outline: boolean;
  transparent: boolean;
  encoding: PointColorEncoding;
};

const tempPose = makePose();
const tempMatrix = new THREE.Matrix4();
const tempPosition = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const tempPoint = new THREE.Vector3();

/** Capacity growth factor: bounds overshoot to 50% at the cost of a few more reallocations */
const GROWTH = 1.5;
/** Shrink once live points use less than 1/SHRINK_BELOW of the buffers (hysteresis vs. GROWTH) */
const SHRINK_BELOW = 4;
/** Buffers below this many points are never shrunk; not worth a reallocation */
const MIN_SHRINK_CAPACITY = 1_000_000;

/** Writes the top 3 rows of an affine matrix (three.js stores columns) */
function writePoseRows(out: Float32Array, offset: number, m: THREE.Matrix4): void {
  const e = m.elements;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      out[offset + row * 4 + col] = e[col * 4 + row]!;
    }
  }
}

/**
 * Older scans of a point cloud decay history, accumulated in one set of GPU buffers.
 *
 * Scans are written into a ring of preallocated buffers and drawn as one point set. Every point
 * still gets exactly its own scan's transform: each point stores its scan's slot, and one matrix
 * per slot is refreshed every frame, so late transforms and frame changes move old scans just like
 * separate objects. Points of free slots and evicted scans point at an all-zero row, which hides
 * them.
 */
export class DecayPointRing extends Renderable<BaseUserData, /*TRenderer=*/ undefined> {
  public override pickable = true;
  // Old scans keep only their geometry (as before), so there are no per-point details to show
  public override pickableInstances = false;

  readonly #limits: HistoryLimits;
  /** Point budget (a setting, so it can change at runtime; see enforceLimits) */
  #maxPoints: number;
  /** Slot index of the all-zero pose */
  readonly #hiddenSlot: number;
  #capacity = 0;
  #positions = new Float32Array(0);
  #colors = new Uint8Array(0);
  #slots = new Uint16Array(0);
  #scans: RingScan[] = [];
  #freeSlots: number[];
  readonly #points: RasterPoints;
  /** Receive time of the newest scan evicted to stay in budget, not because it expired */
  #budgetEvictedUntil: bigint | undefined;
  /** Points across live scans (the buffers can be larger, e.g. after one oversized scan) */
  #livePoints = 0;

  public constructor(topic: string, style: RingStyle, limits: HistoryLimits) {
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
    this.#maxPoints = limits.maxPoints;
    this.#hiddenSlot = limits.maxEntries;
    this.#freeSlots = Array.from(
      { length: limits.maxEntries },
      (_, i) => limits.maxEntries - 1 - i,
    );
    this.#points = new RasterPoints(`${topic}:PointCloud:decay`, {
      scanSlots: limits.maxEntries,
    });
    this.#points.userData.computeBounds = this.#computeBounds;
    this.add(this.#points);
    this.setStyle(style);
    this.visible = false;
  }

  /** The drawn point set */
  public points(): RasterPoints {
    return this.#points;
  }

  public override dispose(): void {
    // A disposed ring can stay reachable (e.g. as the selection), so drop the point arrays too
    this.#scans = [];
    this.#livePoints = 0;
    this.#resize(0);
    this.#points.dispose();
    super.dispose();
  }

  /** Point budget for growing the buffers; set before push() so a raised limit applies at once */
  public setMaxPoints(maxPoints: number): void {
    this.#maxPoints = maxPoints;
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

  public setStyle(style: RingStyle): void {
    const points = this.#points;
    points.pointSize = style.pointSize;
    points.square = style.square;
    points.encoding = style.encoding;
    points.setShape(style.shape, {
      cubeSize: style.cubeSize,
      outline: style.outline,
      transparent: style.transparent,
    });
  }

  /**
   * Copies a decoded scan into the ring. Evicts the oldest scans when the ring is out of space or
   * slots, after growing up to the point budget.
   */
  public push(info: RingScanInfo, positions: Float32Array, colors: Uint8Array): void {
    const count = positions.length / 3;
    // One point set can't address more; such a scan is only ever drawn as the latest
    if (count === 0 || count > MAX_SET_POINTS) {
      return;
    }
    if (this.#freeSlots.length === 0) {
      this.#evictOldest({ budget: true });
    }
    const start = this.#allocate(count);
    const slot = this.#freeSlots.pop()!;
    this.#scans.push({ ...info, slot, start, count });
    this.#livePoints += count;

    this.#positions.set(positions, start * 3);
    this.#colors.set(colors, start * 4);
    this.#slots.fill(slot, start, start + count);
    this.#points.markRange(start, count);
  }

  /**
   * Evicts the oldest scans until the history plus `reservePoints` and one scan (the latest, drawn
   * separately) fit in the limits. A latest scan bigger than the budget leaves no history.
   */
  public enforceLimits({
    maxPoints,
    reservePoints,
  }: {
    maxPoints: number;
    reservePoints: number;
  }): void {
    this.#maxPoints = maxPoints;
    while (
      this.#scans.length > 0 &&
      (this.#livePoints + reservePoints > maxPoints ||
        this.#scans.length + 1 > this.#limits.maxEntries)
    ) {
      this.#evictOldest({ budget: true });
    }
  }

  /**
   * Drops scans received before `expireTime`, and shrinks the buffers once the history needs far
   * less than they hold (e.g. after lowering the decay time).
   */
  public expire(expireTime: bigint): void {
    while (this.#scans.length > 0 && this.#scans[0]!.receiveTime < expireTime) {
      this.#evictOldest({ budget: false });
    }
    if (this.#capacity > MIN_SHRINK_CAPACITY && this.#livePoints * SHRINK_BELOW < this.#capacity) {
      this.#resize(Math.ceil(this.#livePoints * GROWTH));
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
    const data = this.#points.poses()!;
    data.fill(0);
    // Matrices are relative to the newest scan's origin so they stay small in float32 even for
    // far-away (e.g. UTM) coordinates; this object carries the large offset in double precision
    let haveOrigin = false;
    let end = 0;
    for (let i = this.#scans.length - 1; i >= 0; i--) {
      const scan = this.#scans[i]!;
      end = Math.max(end, scan.start + scan.count);
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
      writePoseRows(data, scan.slot * POSE_FLOATS, tempMatrix);
    }
    this.#points.markPoses();
    // One dispatch covers every live scan; points in free gaps are hidden by their slot
    this.#points.drawCount = end;
    this.#points.updateShapes();
    this.visible = this.#scans.length > 0;
    return missingFrame;
  }

  /** Points [0, drawCount) the GPU walks each frame, for tests */
  public drawCount(): number {
    return this.#points.drawCount;
  }

  /** Buffer capacity in points, for tests */
  public capacity(): number {
    return this.#capacity;
  }

  /**
   * Zoom to Data bounds in this object's space: live, resolved scans placed by their matrices, as
   * the GPU draws them (the raw buffers hold scan-local and expired points).
   */
  #computeBounds = (box: THREE.Box3): void => {
    const positions = this.#positions;
    const d = this.#points.poses()!;
    for (const scan of this.#scans) {
      const o = scan.slot * POSE_FLOATS;
      if (d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 0) {
        continue; // hidden: no transform (a rotation row is never zero)
      }
      // prettier-ignore
      tempMatrix.set(
        d[o]!,
        d[o + 1]!,
        d[o + 2]!,
        d[o + 3]!,
        d[o + 4]!,
        d[o + 5]!,
        d[o + 6]!,
        d[o + 7]!,
        d[o + 8]!,
        d[o + 9]!,
        d[o + 10]!,
        d[o + 11]!,
        0,
        0,
        0,
        1,
      );
      for (let i = scan.start * 3; i < (scan.start + scan.count) * 3; i += 3) {
        tempPoint.fromArray(positions, i).applyMatrix4(tempMatrix);
        if (Number.isFinite(tempPoint.x + tempPoint.y + tempPoint.z)) {
          box.expandByPoint(tempPoint);
        }
      }
    }
  };

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
    const maxCapacity = Math.min(MAX_SET_POINTS, Math.max(this.#maxPoints, count));
    if (this.#capacity < maxCapacity) {
      // Resizing packs live scans from 0, so the new scan goes right after them
      this.#resize(
        Math.min(
          maxCapacity,
          Math.max(Math.ceil(this.#capacity * GROWTH), this.#livePoints + count * 2),
        ),
      );
      if (this.#livePoints + count <= this.#capacity) {
        return this.#livePoints;
      }
    }
    const newestNow = this.#scans[this.#scans.length - 1];
    const after = newestNow ? newestNow.start + newestNow.count : 0;
    const start = after + count <= this.#capacity ? after : 0;
    // Evict in age order: an older scan never outlives a newer one
    while (this.#overlapsScan(start, count)) {
      this.#evictOldest({ budget: true });
    }
    return start;
  }

  /** First free range of `count` points between live scans or after the last one */
  #findGap(count: number): number | undefined {
    let free = 0;
    for (const scan of [...this.#scans].sort((a, b) => a.start - b.start)) {
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

  /**
   * Reallocates the buffers at `capacity` points with the live scans packed from 0 in age order,
   * which also drops any gaps between them.
   */
  #resize(capacity: number): void {
    const positions = new Float32Array(capacity * 3);
    const colors = new Uint8Array(capacity * 4);
    // Two 16-bit slots per 32-bit word on the GPU, so round up to whole words
    const slots = new Uint16Array(Math.ceil(capacity / 2) * 2).fill(this.#hiddenSlot);
    let next = 0;
    for (const scan of this.#scans) {
      const { start, count } = scan;
      positions.set(this.#positions.subarray(start * 3, (start + count) * 3), next * 3);
      colors.set(this.#colors.subarray(start * 4, (start + count) * 4), next * 4);
      slots.fill(scan.slot, next, next + count);
      scan.start = next;
      next += count;
    }
    this.#capacity = capacity;
    this.#positions = positions;
    this.#colors = colors;
    this.#slots = slots;
    // New arrays are uploaded in full on first use
    this.#points.setArrays(positions, colors, slots);
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
    this.#slots.fill(this.#hiddenSlot, scan.start, scan.start + scan.count);
    this.#points.markSlots(scan.start, scan.count);
    this.#freeSlots.push(scan.slot);
  }
}
