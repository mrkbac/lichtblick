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
  /** Transforms epoch its pose row was computed at; undefined while it has no row */
  posedAt: number | undefined;
  /** Transforms epoch its placement last failed at (no transform), so it waits for a change */
  failedAt: number | undefined;
  /** The ring kept 1 in this many scans around this one (its intake rate, raised by thinning) */
  stride: number;
};

export type RingScanInfo = Pick<RingScan, "receiveTime" | "messageTime" | "frameId" | "pose">;

/**
 * Scans whose pose row is (re)computed per frame. New scans and ones still missing a transform go
 * first; the rest are rechecked in turns, for transforms that arrive late.
 */
const POSE_REFRESH_BUDGET = 128;
const IDENTITY_POSE = makePose();

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

/**
 * What the transforms resolve to depends on: the tree's contents (its version), the playback time
 * when the tree is complete (it then shows only transforms received by then), and frame offsets
 * edited in the settings. The offsets are folded into one number; equal sums of different edits
 * are possible but practically never happen.
 */
function transformsKey(
  tree: Renderer["transformTree"],
  currentTime: bigint,
): { version: number; time: bigint | undefined; offsets: number } {
  let offsets = 0;
  let i = 0;
  for (const frame of tree.frames().values()) {
    i++;
    const p = frame.offsetPosition;
    const r = frame.offsetEulerDegrees;
    if (p) {
      offsets += i * (p[0] + 3 * p[1] + 7 * p[2]);
    }
    if (r) {
      offsets += i * (11 * r[0] + 13 * r[1] + 17 * r[2]);
    }
  }
  return {
    version: tree.version,
    time: tree.isComplete() ? currentTime : undefined,
    offsets,
  };
}

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
 *
 * Over its limits the ring thins evenly instead of dropping its oldest scans: it drops every other
 * scan and from then on keeps 1 in twice as many new ones, so the whole decay window stays visible
 * at a lower density.
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
  /** Keeps 1 in this many pushed scans; doubles each time the history is thinned */
  #stride = 1;
  /** Scans pushed since the last kept one */
  #sinceKept = 0;
  /** One past the highest slot ever used; poses beyond it stay zero and aren't uploaded */
  #slotsUsed = 0;
  /** Fixed frame the pose rows are in, undefined until the first frame */
  #rowsFrame: string | undefined;
  /** Rows are relative to this point in the fixed frame, so they stay small in float32 */
  #rowsOrigin: THREE.Vector3 | undefined;
  /** Where the next turn of rechecking outdated rows starts */
  #recheckFrom = 0;
  /** Bumped whenever what the transforms resolve to may have changed, see #transformsKey */
  #epoch = 0;
  #lastKey: { version: number; time: bigint | undefined; offsets: number } | undefined;
  /** Rows left to (re)compute after the last frame's budget ran out */
  #posesPending = false;

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

  /** The ring keeps 1 in this many scans (1 until it is first over its limits) */
  public stride(): number {
    return this.#stride;
  }

  /** Receive time of the oldest accumulated scan */
  public oldestReceiveTime(): bigint | undefined {
    return this.#scans[0]?.receiveTime;
  }

  /**
   * Receive time of the newest scan dropped to stay in the point budget where thinning couldn't
   * help (scans too large to thin around, or a latest scan that alone fills the budget). Once this
   * is older than the decay window, nothing in the window is missing.
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
   * Copies a decoded scan into the ring, unless thinning skips it or the ring already has a scan
   * received at that time. Thins the history when the ring is out of slots, or out of space after
   * growing up to the point budget. A scan older than the newest (read back after a seek) is placed
   * in age order.
   */
  public push(info: RingScanInfo, positions: Float32Array, colors: Uint8Array): void {
    const count = positions.length / 3;
    // One point set can't address more; such a scan is only ever drawn as the latest
    if (count === 0 || count > MAX_SET_POINTS) {
      return;
    }
    // The same message pushed again (e.g. read back after a seek twice); distinct scans received at
    // the same time have their own stamps
    if (
      this.#scans.some(
        (scan) => scan.receiveTime === info.receiveTime && scan.messageTime === info.messageTime,
      )
    ) {
      return;
    }
    if (++this.#sinceKept < this.#stride) {
      return;
    }
    this.#sinceKept = 0;
    if (this.#freeSlots.length === 0) {
      this.#thin();
    }
    const start = this.#allocate(count);
    const slot = this.#freeSlots.pop()!;
    this.#slotsUsed = Math.max(this.#slotsUsed, slot + 1);
    // A reused slot still has its last scan's row: hidden until this scan is placed
    this.#points.poses()!.fill(0, slot * POSE_FLOATS, (slot + 1) * POSE_FLOATS);
    this.#points.markPoses(slot, 1);
    // Scans read back after a seek can be older than the newest: keep the list in age order
    let at = this.#scans.length;
    while (at > 0 && this.#scans[at - 1]!.receiveTime > info.receiveTime) {
      at--;
    }
    this.#scans.splice(at, 0, {
      ...info,
      slot,
      start,
      count,
      posedAt: undefined,
      failedAt: undefined,
      stride: this.#stride,
    });
    this.#livePoints += count;

    this.#positions.set(positions, start * 3);
    this.#colors.set(colors, start * 4);
    this.#slots.fill(slot, start, start + count);
    this.#points.markRange(start, count);
  }

  /**
   * Thins the history until it plus `reservePoints` (the latest scan, drawn separately) fit in the
   * point budget, and goes back to a denser history once there is room for twice the points. A
   * latest scan bigger than the budget leaves no history.
   */
  public enforceLimits({
    maxPoints,
    reservePoints,
  }: {
    maxPoints: number;
    reservePoints: number;
  }): void {
    this.#maxPoints = maxPoints;
    while (this.#scans.length > 0 && this.#livePoints + reservePoints > maxPoints) {
      // Thinning can't make room next to a latest scan that alone fills the budget
      if (this.#scans.length > 1 && reservePoints < maxPoints) {
        this.#makeRoom(this.#livePoints + reservePoints - maxPoints);
      } else {
        this.#evictOldest({ budget: true });
      }
    }
    // Keep twice as many again once the whole window was taken at the current rate (so at most
    // once per decay time) and twice the history fits in half the limits, so this doesn't undo the
    // last thinning and flip back and forth
    const oldest = this.#scans[0];
    const roomFor = (used: number, limit: number) => used * 4 <= limit;
    if (!oldest) {
      this.#stride = 1;
    } else if (
      this.#stride > 1 &&
      oldest.stride <= this.#stride &&
      roomFor(this.#livePoints * 2 + reservePoints, Math.min(maxPoints, MAX_SET_POINTS) * 2) &&
      roomFor(this.#scans.length * 2, this.#limits.maxEntries * 2)
    ) {
      this.#stride /= 2;
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
   * Places the scans for this frame. Each scan's row holds its pose in the fixed frame, which only
   * changes when transforms around its stamp do, so rows are (re)computed within a per-frame budget
   * instead of all every frame. Render ← fixed at the current time is this object's own transform.
   * Returns the frame of a scan without a transform, or undefined when all resolved.
   */
  public updatePoses(
    transformTree: Renderer["transformTree"],
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): string | undefined {
    const scans = this.#scans;
    const data = this.#points.poses()!;
    const key = transformsKey(transformTree, currentTime);
    const last = this.#lastKey;
    if (
      !last ||
      last.version !== key.version ||
      last.time !== key.time ||
      last.offsets !== key.offsets
    ) {
      this.#epoch++;
      this.#lastKey = key;
    }
    const epoch = this.#epoch;
    let budget = POSE_REFRESH_BUDGET;
    let firstSlot = Infinity;
    let lastSlot = -1;
    if (scans.length === 0) {
      this.#rowsOrigin = undefined; // the next scans may be far from the old ones
    }
    if (this.#rowsFrame !== fixedFrameId) {
      // A new fixed frame invalidates every row: place them all now rather than over frames
      data.fill(0, 0, this.#slotsUsed * POSE_FLOATS);
      firstSlot = 0;
      lastSlot = this.#slotsUsed - 1;
      for (const scan of scans) {
        scan.posedAt = undefined;
        scan.failedAt = undefined;
      }
      this.#rowsFrame = fixedFrameId;
      this.#rowsOrigin = undefined;
      budget = Infinity;
    }

    const place = (scan: RingScan) => {
      budget--;
      const o = scan.slot * POSE_FLOATS;
      firstSlot = Math.min(firstSlot, scan.slot);
      lastSlot = Math.max(lastSlot, scan.slot);
      const ok = transformTree.apply(
        tempPose,
        scan.pose,
        fixedFrameId,
        fixedFrameId,
        scan.frameId,
        scan.messageTime,
        scan.messageTime,
      );
      if (!ok) {
        // Retried once the transforms change, so it can't hold back the other scans' rows
        scan.posedAt = undefined;
        scan.failedAt = epoch;
        data.fill(0, o, o + POSE_FLOATS);
        return;
      }
      const p = tempPose.position;
      // Matrices are relative to the first placed scan, so they stay small in float32 even for
      // far-away (e.g. UTM) coordinates; this object carries the large offset in double precision
      const origin = (this.#rowsOrigin ??= new THREE.Vector3(p.x, p.y, p.z));
      const q = tempPose.orientation;
      tempPosition.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      tempQuaternion.set(q.x, q.y, q.z, q.w);
      tempMatrix.compose(tempPosition, tempQuaternion, UNIT_SCALE);
      writePoseRows(data, o, tempMatrix);
      scan.posedAt = epoch;
      scan.failedAt = undefined;
    };
    const due = (scan: RingScan) => scan.posedAt !== epoch && scan.failedAt !== epoch;
    // Scans without a row first, newest first; then the rest in turns
    for (let i = scans.length - 1; i >= 0 && budget > 0; i--) {
      if (scans[i]!.posedAt == undefined && due(scans[i]!)) {
        place(scans[i]!);
      }
    }
    let checked = 0;
    for (; checked < scans.length && budget > 0; checked++) {
      const scan = scans[(this.#recheckFrom + checked) % scans.length]!;
      if (due(scan)) {
        place(scan);
      }
    }
    this.#recheckFrom = scans.length > 0 ? (this.#recheckFrom + checked) % scans.length : 0;
    if (lastSlot >= 0) {
      this.#points.markPoses(firstSlot, lastSlot - firstSlot + 1);
    }

    let missingFrame: string | undefined;
    this.#posesPending = false;
    for (const scan of scans) {
      if (scan.failedAt === epoch) {
        missingFrame ??= scan.frameId;
      } else if (scan.posedAt !== epoch) {
        this.#posesPending = true;
      }
    }

    let end = 0;
    for (const scan of scans) {
      end = Math.max(end, scan.start + scan.count);
    }
    // One dispatch covers every live scan; points in free gaps are hidden by their slot
    this.#points.drawCount = end;
    this.#points.updateShapes();

    const renderFromFixed = transformTree.apply(
      tempPose,
      IDENTITY_POSE,
      renderFrameId,
      fixedFrameId,
      fixedFrameId,
      currentTime,
      currentTime,
    );
    const origin = this.#rowsOrigin;
    if (!renderFromFixed || !origin) {
      this.visible = false;
      return missingFrame ?? (renderFromFixed ? undefined : scans[0]?.frameId);
    }
    const { position: p, orientation: q } = renderFromFixed;
    this.quaternion.set(q.x, q.y, q.z, q.w);
    this.position
      .copy(origin)
      .applyQuaternion(this.quaternion)
      .add(tempPosition.set(p.x, p.y, p.z));
    this.visible = true;
    return missingFrame;
  }

  /** Whether rows were left for later frames; the caller then asks for another frame */
  public posesPending(): boolean {
    return this.#posesPending;
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
    // At the budget with no free range that fits: pack the live scans so the free space is one
    // range. Packing re-uploads every point, so first thin while the history fills over 3/4 of the
    // buffers: the next pack is then far off instead of a few scans away.
    while (this.#scans.length > 1 && (this.#livePoints + count) * 4 > this.#capacity * 3) {
      this.#makeRoom(this.#livePoints + count - Math.floor((this.#capacity * 3) / 4));
    }
    if (this.#livePoints + count > this.#capacity) {
      this.#evictOldest({ budget: true });
    }
    this.#resize(this.#capacity);
    return this.#livePoints;
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

  /**
   * Frees points toward a `deficit`: thins when that frees enough, or at least a quarter of the
   * points (callers repeat until the deficit is gone). Thinning keeps the newest scan and every other
   * one, so a few large scans can keep it from freeing much; then the smallest scan that alone
   * covers the deficit is dropped (or the largest, if none does), which loses the least history.
   * Such drops are reported (see budgetEvictedUntil).
   */
  #makeRoom(deficit: number): void {
    const newest = this.#scans.length - 1;
    let thinned = 0;
    for (let i = newest - 1; i >= 0; i -= 2) {
      thinned += this.#scans[i]!.count;
    }
    if (thinned >= deficit || thinned * 4 >= this.#livePoints) {
      this.#thin();
      return;
    }
    let drop = this.#scans[0]!;
    for (const scan of this.#scans) {
      const covers = scan.count >= deficit;
      const dropCovers = drop.count >= deficit;
      if (
        covers ? !dropCovers || scan.count < drop.count : !dropCovers && scan.count > drop.count
      ) {
        drop = scan;
      }
    }
    this.#scans.splice(this.#scans.indexOf(drop), 1);
    this.#budgetEvictedUntil =
      this.#budgetEvictedUntil == undefined || drop.receiveTime > this.#budgetEvictedUntil
        ? drop.receiveTime
        : this.#budgetEvictedUntil;
    this.#free(drop);
  }

  /** Drops every other scan, keeping the newest, and keeps 1 in twice as many pushed from now on */
  #thin(): void {
    const newest = this.#scans.length - 1;
    this.#stride *= 2;
    this.#scans = this.#scans.filter((scan, i) => {
      const keep = (newest - i) % 2 === 0;
      if (keep) {
        scan.stride = Math.max(scan.stride * 2, this.#stride);
      } else {
        this.#free(scan);
      }
      return keep;
    });
  }

  #evictOldest({ budget }: { budget: boolean }): void {
    const scan = this.#scans.shift();
    if (!scan) {
      return;
    }
    if (budget) {
      this.#budgetEvictedUntil = scan.receiveTime;
    }
    this.#free(scan);
  }

  #free(scan: RingScan): void {
    this.#livePoints -= scan.count;
    this.#slots.fill(this.#hiddenSlot, scan.start, scan.start + scan.count);
    this.#points.markSlots(scan.start, scan.count);
    this.#freeSlots.push(scan.slot);
  }
}
