// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  CoordinateFrame,
  FallbackFrameId,
  AnyFrameId,
  MAX_DURATION,
  TransformVisibility,
} from "./CoordinateFrame";
import { Transform } from "./Transform";
import { Pose } from "./geometry";
import { Duration, Time } from "./time";

/**
 * How far back each frame of a live (not complete) tree keeps transforms, relative to its newest
 * one. Long enough for long decay times; lookups older than this use the oldest kept transform.
 */
export const DEFAULT_MAX_STORAGE_TIME: Duration = 300n * BigInt(1e9);

/**
 * Live frames keep every transform received in this long before their newest one (scrubbing back
 * and short decay times need full rate), and older ones one per
 * {@link THINNED_TRANSFORM_SPACING} plus where held values start and end (steps stay exact);
 * interpolation bridges the rest. A 200 Hz frame keeps 30 s
 * at 200 Hz and the rest of its window at 20 Hz: ~11k instead of 60k samples.
 */
export const FULL_RATE_TRANSFORM_TIME: Duration = 30n * BigInt(1e9);
export const THINNED_TRANSFORM_SPACING: Duration = 50_000_000n;

/**
 * Sample budget across all frames, about 144 MB at 72 bytes per sample. Past it, every frame's
 * history is halved, so long recordings and fast live frames lose time resolution evenly instead of
 * losing their oldest transforms.
 */
export const MAX_TRANSFORM_SAMPLES = 2_000_000;

export enum AddTransformResult {
  NOT_UPDATED,
  UPDATED,
  CYCLE_DETECTED,
  /** Non-finite translation or zero/non-finite rotation; rejected before reaching the tree */
  INVALID,
}

/** Whether the transform made it into the tree */
export function isAddedTransform(result: AddTransformResult): boolean {
  return result === AddTransformResult.NOT_UPDATED || result === AddTransformResult.UPDATED;
}

// Coordinate frames named in [REP-105](https://www.ros.org/reps/rep-0105.html)
const DEFAULT_FRAME_IDS = ["base_link", "odom", "map", "earth"];

/**
 * TransformTree is a collection of coordinate frames with convenience methods
 * for getting and creating frames and adding transforms between frames.
 */
export class TransformTree {
  #frames = new Map<string, CoordinateFrame>();
  /** Bumped whenever transforms are added, removed or cleared, so readers can skip unchanged trees */
  public version = 0;
  #maxStorageTime: Duration;
  #complete = false;
  #receivedUntil: Time | undefined;
  #visibility: TransformVisibility = { complete: false, receivedUntil: undefined };
  #sampleBudget: number;
  #sampleCount = 0;
  /** How many times the histories were halved to stay within the sample budget */
  public decimations = 0;

  public defaultRootFrame: CoordinateFrame<FallbackFrameId>;

  public constructor(
    maxStorageTime = DEFAULT_MAX_STORAGE_TIME,
    sampleBudget = MAX_TRANSFORM_SAMPLES,
  ) {
    this.#maxStorageTime = maxStorageTime;
    this.#sampleBudget = sampleBudget;
    this.defaultRootFrame = new CoordinateFrame(
      CoordinateFrame.FALLBACK_FRAME_ID,
      undefined,
      this.#maxStorageTime,
      this.#visibility,
    );
    this.defaultRootFrame.addTransform(0n, Transform.Identity());
  }

  public addTransform(
    frameId: string,
    parentFrameId: string,
    time: Time,
    transform: Transform,
    receiveTime?: Time,
  ): AddTransformResult {
    this.version++;
    const existing = this.#frames.get(frameId);
    let updated = existing == undefined;
    let cycleDetected = false;
    const frame = existing ?? this.getOrCreateFrame(frameId);
    const sizeBefore = frame.transformsSize();
    const curParentFrame = frame.latestParent();
    if (curParentFrame?.id !== parentFrameId) {
      cycleDetected = this.#checkParentForCycle(frameId, parentFrameId);
      // This frame was previously unparented but now we know its parent, or we
      // are reparenting this frame
      if (!cycleDetected) {
        frame.setParent(this.getOrCreateFrame(parentFrameId));
        updated = true;
      }
    }

    if (!cycleDetected) {
      frame.addTransform(time, transform, receiveTime);
    }
    this.#sampleCount += frame.transformsSize() - sizeBefore;
    if (this.#sampleCount > this.#sampleBudget) {
      this.#decimate();
    } else if (
      !this.#complete &&
      this.decimations > 0 &&
      this.#sampleCount < this.#sampleBudget / 4
    ) {
      // A live window shrank well below the budget (thinned or dropped transforms aged out, or the
      // rate fell): keep twice as many new transforms again. Kept ones stay thinned until they
      // age out.
      this.decimations--;
      for (const other of this.#frames.values()) {
        other.setKeepEvery(Math.max(1, other.keepEvery() / 2));
      }
    }

    return cycleDetected
      ? AddTransformResult.CYCLE_DETECTED
      : updated
        ? AddTransformResult.UPDATED
        : AddTransformResult.NOT_UPDATED;
  }

  /**
   * Removes transform data from a particular parent-child link at the given timestamp. Does nothing
   * if the child does not exist or has a different parent.
   */
  public removeTransform(childFrameId: string, parentFrameId: string, stamp: bigint): void {
    const child = this.frame(childFrameId);
    if (!child) {
      return;
    }
    if (child.latestParent()?.id !== parentFrameId) {
      return;
    }
    const sizeBefore = child.transformsSize();
    child.removeTransformAt(stamp);
    this.#sampleCount += child.transformsSize() - sizeBefore;
    this.version++;
    this.#removeEmptyAncestors(child);
  }

  /**
   * Walk up the tree starting from `candidate` and prune frames with no history entries and no
   * children.
   */
  #removeEmptyAncestors(candidate: CoordinateFrame): void {
    if (candidate.transformsSize() > 0) {
      // don't want to delete this frame, it is not empty
      return;
    }

    // Build a list of children for each frame in the tree, used to check whether nodes are leaf
    // nodes
    const childrenByParentId = new Map<string, Set<string>>();
    for (const frame of this.#frames.values()) {
      childrenByParentId.set(frame.id, new Set());
    }
    for (const frame of this.#frames.values()) {
      const parent = frame.parent();
      if (parent === candidate) {
        // can't delete this frame or its ancestors, it still has children
        return;
      }
      if (parent == undefined) {
        continue;
      }
      const children = childrenByParentId.get(parent.id);
      if (!children) {
        throw new Error("invariant: should have children array");
      }
      children.add(frame.id);
    }

    // Walk upwards, deleting nodes with no history entries and no children
    for (
      let current: typeof candidate | undefined = candidate;
      current;
      current = current.parent()
    ) {
      if (current.transformsSize() > 0) {
        // don't want to delete this frame, it is not empty
        return;
      }
      const children = childrenByParentId.get(current.id);
      if (children && children.size > 0) {
        // can't delete this frame or its ancestors, it still has children
        return;
      }
      this.#frames.delete(current.id);
      childrenByParentId.delete(current.id);
      const parentId = current.parent()?.id;
      if (parentId) {
        childrenByParentId.get(parentId)?.delete(current.id);
      }
    }
  }

  public clear(): void {
    this.version++;
    this.#frames.clear();
    this.#sampleCount = 0;
    this.decimations = 0;
  }

  /**
   * A complete tree holds the whole transform history of a recording: frames keep every transform
   * (within the sample budget) instead of a time window, and lookups only see the transforms
   * received by the time set with {@link setReceivedUntil}. Turning it off clears the tree, since
   * the history would exceed the bounds.
   */
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  public setComplete(complete: boolean): void {
    if (this.#complete === complete) {
      return;
    }
    this.#complete = complete;
    this.#visibility.complete = complete;
    this.#visibility.receivedUntil = complete ? this.#receivedUntil : undefined;
    // Thinning for the live window does not carry over to a preloaded history, or back
    this.decimations = 0;
    if (!complete) {
      this.clear();
    }
    for (const frame of this.#frames.values()) {
      this.#applyLimits(frame);
    }
  }

  public isComplete(): boolean {
    return this.#complete;
  }

  /** The playback time: a complete tree hides transforms received after it */
  public setReceivedUntil(time: Time): void {
    this.#receivedUntil = time;
    if (this.#complete) {
      this.#visibility.receivedUntil = this.#receivedUntil;
    }
  }

  #applyLimits(frame: CoordinateFrame): void {
    frame.maxStorageTime = this.#complete ? MAX_DURATION : this.#maxStorageTime;
    // New frames start at full rate; #decimate thins them once they outgrow their share
    frame.setKeepEvery(1);
    // A complete history is scrubbed anywhere, so only live ones thin by age
    frame.setAgeThinning(
      this.#complete ? Infinity : FULL_RATE_TRANSFORM_TIME,
      THINNED_TRANSFORM_SPACING,
    );
  }

  #decimate(): void {
    // Only frames over an even share of the budget are halved, so a dense frame can't starve sparse
    // ones of resolution. Some frame is always over it, since the total is over the budget.
    this.decimations++;
    const share = this.#sampleBudget / this.#frames.size;
    for (const frame of this.#frames.values()) {
      if (frame.transformsSize() > share) {
        this.#sampleCount -= frame.decimate();
      }
    }
  }

  public hasFrame(id: AnyFrameId): boolean {
    if (id === CoordinateFrame.FALLBACK_FRAME_ID) {
      return true;
    }
    return this.#frames.has(id);
  }

  public frame<ID extends AnyFrameId>(id: ID): CoordinateFrame<ID> | undefined {
    if (id === CoordinateFrame.FALLBACK_FRAME_ID) {
      return this.defaultRootFrame as CoordinateFrame<ID>;
    }
    return this.#frames.get(id) as CoordinateFrame<ID>;
  }

  /**
   * Puts the history of `earlier`, a tree of transforms all received before this tree's (a
   * playhead-first read's earlier window, see Renderer.addTransformMessages), in front of each
   * frame's history: one copy per frame instead of an insert per transform.
   */
  public prepend(earlier: TransformTree): void {
    this.version++;
    for (const [id, frame] of earlier.#frames) {
      const target = this.getOrCreateFrame(id);
      const sizeBefore = target.transformsSize();
      target.prepend(frame, (parentId) => this.getOrCreateFrame(parentId));
      this.#sampleCount += target.transformsSize() - sizeBefore;
    }
    while (this.#sampleCount > this.#sampleBudget) {
      const count = this.#sampleCount;
      this.#decimate();
      if (this.#sampleCount >= count) {
        break;
      }
    }
  }

  public getOrCreateFrame(id: string): CoordinateFrame {
    let frame = this.#frames.get(id);
    if (!frame) {
      frame = new CoordinateFrame(id, undefined, this.#maxStorageTime, this.#visibility);
      this.#applyLimits(frame);
      this.#frames.set(id, frame);
    }
    return frame;
  }

  public frames(): ReadonlyMap<string, CoordinateFrame> {
    return this.#frames;
  }

  public apply(
    output: Pose,
    input: Readonly<Pose>,
    frameId: AnyFrameId,
    rootFrameId: AnyFrameId | undefined,
    srcFrameId: AnyFrameId,
    dstTime: Time,
    srcTime: Time,
    maxDelta?: Duration,
  ): Pose | undefined {
    const frame = this.frame(frameId);
    const srcFrame = this.frame(srcFrameId);
    if (!frame || !srcFrame) {
      return undefined;
    }
    const rootFrame =
      (rootFrameId != undefined ? this.frame(rootFrameId) : frame.root()) ?? frame.root();
    return frame.apply(output, input, rootFrame, srcFrame, dstTime, srcTime, maxDelta);
  }

  public frameList(): { label: string; value: string }[] {
    type FrameEntry = { id: string; children: FrameEntry[] };

    const frames = Array.from(this.#frames.values());
    const frameMap = new Map<string, FrameEntry>(
      frames.map((frame) => [frame.id, { id: frame.id, children: [] }]),
    );

    // Create a hierarchy of coordinate frames
    const rootFrames: FrameEntry[] = [];
    for (const frame of frames) {
      const frameEntry = frameMap.get(frame.id)!;
      const parentId = frame.parent()?.id;
      if (parentId == undefined) {
        rootFrames.push(frameEntry);
      } else {
        const parent = frameMap.get(parentId);
        if (parent == undefined) {
          continue;
        }
        parent.children.push(frameEntry);
      }
    }

    // Convert the `rootFrames` hierarchy into a flat list of coordinate frames with depth
    const output: { label: string; value: string }[] = [];

    function addFrame(frame: FrameEntry, depth: number) {
      const displayName = CoordinateFrame.DisplayName(frame.id);
      output.push({
        value: frame.id,
        label: `${"\u00A0\u00A0".repeat(depth)}${displayName}`,
      });
      frame.children.sort((a, b) => a.id.localeCompare(b.id));
      for (const child of frame.children) {
        addFrame(child, depth + 1);
      }
    }

    rootFrames.sort((a, b) => a.id.localeCompare(b.id));
    for (const entry of rootFrames) {
      addFrame(entry, 0);
    }

    return output;
  }

  /** Get heuristically most valid follow frame Id */
  public getDefaultFollowFrameId(): string | undefined {
    const allFrames = this.frames();
    if (allFrames.size === 0) {
      return undefined;
    }

    // Prefer frames from [REP-105](https://www.ros.org/reps/rep-0105.html)
    for (const frameId of DEFAULT_FRAME_IDS) {
      const frame = this.frame(frameId);
      if (frame) {
        return frame.id;
      }
    }

    // Choose the root frame with the most children
    const rootsToCounts = new Map<string, number>();
    for (const frame of allFrames.values()) {
      const root = frame.root();
      const rootId = root.id;

      rootsToCounts.set(rootId, (rootsToCounts.get(rootId) ?? 0) + 1);
    }
    const rootsArray = Array.from(rootsToCounts.entries());
    const rootId = rootsArray.sort((a, b) => b[1] - a[1])[0]?.[0];
    return rootId;
  }

  #checkParentForCycle(frameId: string, parentFrameId: string): boolean {
    if (frameId === parentFrameId) {
      return true;
    }
    // walk up tree from parent Frame to check if it eventually crosses the frame
    // Walk every parent a frame had, not only the latest: a preloaded history switches to earlier
    // parents at earlier playback times, and no playback time may see a cycle.
    const visited = new Set<CoordinateFrame>();
    const pending = [this.frame(parentFrameId)];
    for (let frame = pending.pop(); frame; frame = pending.pop()) {
      if (visited.has(frame)) {
        continue;
      }
      visited.add(frame);
      for (const parent of frame.allParents()) {
        if (parent.id === frameId) {
          return true;
        }
        pending.push(parent);
      }
    }
    return false;
  }
}
