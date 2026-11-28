// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Transform } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/Transform";

import { CoordinateFrame, MAX_DURATION } from "./CoordinateFrame";
import {
  AddTransformResult,
  FULL_RATE_TRANSFORM_TIME,
  THINNED_TRANSFORM_SPACING,
  TransformTree,
} from "./TransformTree";

const tf = Transform.Identity();

/** Time of the newest transform at or before `time` that lookups can see, if any */
function latestTimeAtOrBefore(frame: CoordinateFrame, time: bigint): bigint | undefined {
  const lower: [bigint, Transform] = [0n, Transform.Identity()];
  const upper: [bigint, Transform] = [0n, Transform.Identity()];
  return frame.findClosestTransforms(lower, upper, time, MAX_DURATION) && lower[0] <= time
    ? lower[0]
    : undefined;
}
describe("TransformTree", () => {
  it("updates tree when adding a transform that would not create a cycle", () => {
    const tfTree = new TransformTree();
    tfTree.addTransform("b", "a", 0n, tf);
    tfTree.addTransform("c", "b", 0n, tf);
    expect(tfTree.addTransform("d", "c", 0n, tf)).toEqual(AddTransformResult.UPDATED);
  });
  it("detects a cycle adding a transform that would create a cycle with 2 frames", () => {
    const tfTree = new TransformTree();
    // a <- b
    tfTree.addTransform("b", "a", 0n, tf);
    // b <- a <- b ERROR - cycle created
    expect(tfTree.addTransform("a", "b", 0n, tf)).toEqual(AddTransformResult.CYCLE_DETECTED);
  });
  it("detects a cycle when adding a transform that would create a cycle with 3 frames", () => {
    const tfTree = new TransformTree();
    // a <- b
    tfTree.addTransform("b", "a", 0n, tf);
    // a <- b <- c
    tfTree.addTransform("c", "b", 0n, tf);
    // c <- a <- b <- c  ERROR - cycle created
    expect(tfTree.addTransform("a", "c", 0n, tf)).toEqual(AddTransformResult.CYCLE_DETECTED);
  });
  it("detects a cycle when adding a transform with a parent as itself", () => {
    const tfTree = new TransformTree();
    expect(tfTree.addTransform("a", "a", 0n, tf)).toEqual(AddTransformResult.CYCLE_DETECTED);
  });

  it("supports deleting frames", () => {
    const tfTree = new TransformTree();
    tfTree.addTransform("b", "a", 0n, tf);
    tfTree.addTransform("c", "b", 0n, tf);
    tfTree.addTransform("c", "b", 1n, tf);
    tfTree.addTransform("d", "a", 0n, tf);

    // Remove non-existent transform is a no-op
    tfTree.removeTransform("c", "a", 0n);
    expect(tfTree.frame("a")).toBeDefined();
    expect(tfTree.frame("b")).toBeDefined();
    expect(tfTree.frame("c")).toBeDefined();
    expect(tfTree.frame("d")).toBeDefined();

    // Remove transform from a->b, a is not deleted because it still has children
    tfTree.removeTransform("b", "a", 0n);
    expect(tfTree.frame("a")).toBeDefined();
    expect(tfTree.frame("b")).toBeDefined();
    expect(tfTree.frame("c")).toBeDefined();
    expect(tfTree.frame("d")).toBeDefined();

    // Remove transform at 0 from b->c, nothing is deleted because there's still a transform at time 1
    tfTree.removeTransform("c", "b", 0n);
    expect(tfTree.frame("a")).toBeDefined();
    expect(tfTree.frame("b")).toBeDefined();
    expect(tfTree.frame("c")).toBeDefined();
    expect(tfTree.frame("d")).toBeDefined();

    // Remove transform at 1 from b->c, b and c can now be deleted, a->d still exists
    tfTree.removeTransform("c", "b", 1n);
    expect(tfTree.frame("a")).toBeDefined();
    expect(tfTree.frame("b")).toBeUndefined();
    expect(tfTree.frame("c")).toBeUndefined();
    expect(tfTree.frame("d")).toBeDefined();

    tfTree.removeTransform("d", "a", 0n);
    expect(tfTree.frame("a")).toBeUndefined();
    expect(tfTree.frame("b")).toBeUndefined();
    expect(tfTree.frame("c")).toBeUndefined();
    expect(tfTree.frame("d")).toBeUndefined();
  });

  it("keeps only maxStorageTime of history per frame", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree(10n * sec);
    // 10 Hz for 1000 s
    for (let i = 0n; i < 10_000n; i++) {
      tfTree.addTransform(
        "b",
        "a",
        i * (sec / 10n),
        new Transform([Number(i), 0, 0], [0, 0, 0, 1]),
      );
    }
    const size = tfTree.frame("b")!.transformsSize();
    // 10 s window plus up to an eighth window of slack before the amortized trim runs.
    expect(size).toBeGreaterThanOrEqual(100);
    expect(size).toBeLessThanOrEqual(113);
  });

  it("keeps the whole storage window of a fast live frame", () => {
    // 200 Hz for 120 s: 24k transforms, more than a per-frame cap used to keep
    const sec = BigInt(1e9);
    const tfTree = new TransformTree();
    const step = sec / 200n;
    for (let i = 0; i < 200 * 120; i++) {
      tfTree.addTransform("b", "a", BigInt(i) * step, new Transform([i, 0, 0], [0, 0, 0, 1]));
    }
    const frame = tfTree.frame("b")!;
    const lower: [bigint, Transform] = [0n, Transform.Empty()];
    const upper: [bigint, Transform] = [0n, Transform.Empty()];
    // 100 s before the newest transform: bracketed by kept transforms at most the thinned spacing
    // apart, and interpolating between them gives the pose (x grows linearly with time)
    const time = 20n * sec + 3n * step;
    expect(frame.findClosestTransforms(lower, upper, time, 0n)).toBe(true);
    expect(lower[0]).toBeLessThanOrEqual(time);
    expect(upper[0]).toBeGreaterThanOrEqual(time);
    expect(upper[0] - lower[0]).toBeLessThanOrEqual(2n * THINNED_TRANSFORM_SPACING);
    const fraction = Number(time - lower[0]) / Math.max(1, Number(upper[0] - lower[0]));
    const x = lower[1].position()[0] + fraction * (upper[1].position()[0] - lower[1].position()[0]);
    expect(x).toBeCloseTo(20 * 200 + 3, 6);
  });

  it("keeps full rate for recent live transforms and thins older ones to a fixed spacing", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree();
    const step = sec / 200n;
    const count = 200 * 120;
    for (let i = 0; i < count; i++) {
      tfTree.addTransform("b", "a", BigInt(i) * step, new Transform([i, 0, 0], [0, 0, 0, 1]));
    }
    const frame = tfTree.frame("b")!;
    const newest = BigInt(count - 1) * step;
    const times: bigint[] = [];
    for (let t: bigint | undefined = newest; t != undefined; ) {
      times.push(t);
      t = t > 0n ? latestTimeAtOrBefore(frame, t - 1n) : undefined;
    }
    times.reverse();
    const recent = times.filter((t) => t >= newest - FULL_RATE_TRANSFORM_TIME);
    const old = times.filter((t) => t < newest - FULL_RATE_TRANSFORM_TIME - 5n * sec);
    // Every recent transform is kept
    expect(recent.length).toBeGreaterThanOrEqual(30 * 200);
    // Older ones keep the thinned spacing, about 20 Hz instead of 200 Hz
    const gaps = old.slice(1).map((t, i) => t - old[i]!);
    expect(gaps.every((gap) => gap >= THINNED_TRANSFORM_SPACING)).toBe(true);
    expect(gaps.every((gap) => gap <= 2n * THINNED_TRANSFORM_SPACING)).toBe(true);
    expect(frame.transformsSize()).toBeLessThan(count / 2);
  });

  it("thins a live tree evenly past the sample budget instead of dropping old transforms", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree(300n * sec, 100);
    for (let i = 0; i <= 300; i++) {
      tfTree.addTransform("b", "a", BigInt(i) * sec, new Transform([i, 0, 0], [0, 0, 0, 1]));
    }
    const frame = tfTree.frame("b")!;
    expect(tfTree.decimations).toBeGreaterThan(0);
    expect(frame.transformsSize()).toBeLessThanOrEqual(100);
    expect(latestTimeAtOrBefore(frame, 0n)).toBe(0n);
    expect(latestTimeAtOrBefore(frame, 1000n * sec)).toBe(300n * sec);
  });

  it("keeps every live transform again once the thinned window ages out", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree(10n * sec, 100);
    let t = 0n;
    const add = (hz: bigint, seconds: bigint) => {
      for (const end = t + seconds * sec; t < end; t += sec / hz) {
        tfTree.addTransform("b", "a", t, new Transform([Number(t), 0, 0], [0, 0, 0, 1]));
      }
    };
    // 20 Hz over a 10 s window is 200 transforms, twice the budget
    add(20n, 30n);
    expect(tfTree.decimations).toBeGreaterThan(0);
    // The rate falls to 1 Hz: 10 transforms per window
    add(1n, 60n);
    expect(tfTree.decimations).toBe(0);
    expect(latestTimeAtOrBefore(tfTree.frame("b")!, t - 2n * sec)).toBe(t - 2n * sec);
  });

  it("keeps steps exact in thinned live history", () => {
    // 100 Hz: x = 150 until 10 s, held at 200 from 10.01 s to 20 s, then moving until 60 s
    const ms = 1_000_000n;
    const tfTree = new TransformTree();
    for (let i = 0; i <= 6000; i++) {
      const x = i <= 1000 ? 150 : i < 2000 ? 200 : i;
      tfTree.addTransform("b", "a", BigInt(i) * 10n * ms, new Transform([x, 0, 0], [0, 0, 0, 1]));
    }
    const frame = tfTree.frame("b")!;
    const lower: [bigint, Transform] = [0n, Transform.Empty()];
    const upper: [bigint, Transform] = [0n, Transform.Empty()];
    // 45 s before the newest transform, in the thinned part
    expect(frame.findClosestTransforms(lower, upper, 15_000n * ms, 0n)).toBe(true);
    expect(lower[1].position()[0]).toBe(200);
    expect(upper[1].position()[0]).toBe(200);
    // The step itself stays where it was
    expect(latestTimeAtOrBefore(frame, 10_009n * ms)).toBe(10_000n * ms);
  });

  it("thins older live transforms to one per spacing interval, also for slower streams", () => {
    // 30 Hz for 120 s: thinning keeps 20 Hz, not every other sample (15 Hz)
    const sec = BigInt(1e9);
    const tfTree = new TransformTree();
    const count = 30 * 120;
    for (let i = 0; i < count; i++) {
      tfTree.addTransform(
        "b",
        "a",
        (BigInt(i) * sec) / 30n,
        new Transform([i, 0, 0], [0, 0, 0, 1]),
      );
    }
    const frame = tfTree.frame("b")!;
    let kept = 0;
    for (let t: bigint | undefined = 20n * sec; t != undefined && t >= 10n * sec; ) {
      kept++;
      t = latestTimeAtOrBefore(frame, t - 1n);
    }
    // 10 s of thinned history at 20 Hz
    expect(kept).toBeGreaterThanOrEqual(10 * 20);
    expect(kept).toBeLessThan(10 * 30);
  });

  it("keeps pruning after transforms were removed or the history started over", () => {
    const sec = BigInt(1e9);
    const at = (x: number) => new Transform([x, 0, 0], [0, 0, 0, 1]);
    const feed = (tfTree: TransformTree, from: bigint) => {
      for (let i = 1n; i <= 1000n; i++) {
        tfTree.addTransform("b", "a", from + i * sec, at(Number(i)));
      }
      return tfTree.frame("b")!.transformsSize();
    };
    // Emptied (a child keeps the frame), then started over at a much later stamp
    const emptied = new TransformTree(10n * sec);
    emptied.addTransform("c", "b", 0n, at(0));
    emptied.addTransform("b", "a", 0n, at(0));
    emptied.addTransform("b", "a", 1000n * sec, at(1));
    emptied.removeTransform("b", "a", 0n);
    emptied.removeTransform("b", "a", 1000n * sec);
    expect(emptied.frame("b")!.transformsSize()).toBe(0);
    expect(feed(emptied, 5000n * sec)).toBeLessThanOrEqual(12);
    // The newest transform removed, then earlier ones added
    const removed = new TransformTree(10n * sec);
    removed.addTransform("b", "a", 0n, at(0));
    removed.addTransform("b", "a", 2000n * sec, at(1));
    removed.removeTransform("b", "a", 2000n * sec);
    expect(feed(removed, 0n)).toBeLessThanOrEqual(12);
  });

  it("drops late transforms that arrive already outside the storage window", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree(10n * sec);
    const at = (x: number) => new Transform([x, 0, 0], [0, 0, 0, 1]);
    tfTree.addTransform("b", "a", 0n, at(0));
    tfTree.addTransform("b", "a", 100n * sec, at(100));
    // Delayed transforms far behind the newest one, which does not advance
    for (let i = 1; i <= 600; i++) {
      tfTree.addTransform("b", "a", BigInt(i) * (sec / 10n), at(i));
    }
    // The newest one before the window and the newest one
    expect(tfTree.frame("b")!.transformsSize()).toBeLessThanOrEqual(2 + 600 / 64);
  });

  it("keeps the transform just before the storage window for interpolation", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree(300n * sec);
    tfTree.addTransform("b", "a", 0n, new Transform([0, 0, 0], [0, 0, 0, 1]));
    tfTree.addTransform("b", "a", 400n * sec, new Transform([400, 0, 0], [0, 0, 0, 1]));
    const lower: [bigint, Transform] = [0n, Transform.Empty()];
    const upper: [bigint, Transform] = [0n, Transform.Empty()];
    const frame = tfTree.frame("b")!;
    expect(frame.transformsSize()).toBe(2);
    expect(frame.findClosestTransforms(lower, upper, 350n * sec, 400n * sec)).toBe(true);
    expect(lower[0]).toBe(0n);
    expect(upper[0]).toBe(400n * sec);
  });

  describe("complete history", () => {
    const sec = BigInt(1e9);
    const at = (x: number) => new Transform([x, 0, 0], [0, 0, 0, 1]);

    it("keeps every transform beyond the storage window", () => {
      const tfTree = new TransformTree(10n * sec);
      tfTree.setComplete(true);
      for (let i = 0; i < 1000; i++) {
        tfTree.addTransform("b", "a", BigInt(i) * sec, at(i));
      }
      expect(tfTree.frame("b")!.transformsSize()).toBe(1000);
    });

    it("only shows transforms received by the playback time, whatever clock stamps use", () => {
      // Stamps are boot-relative, receive times use the recording clock
      const recordingStart = 1_700_000_000n * sec;
      const tfTree = new TransformTree();
      tfTree.setComplete(true);
      for (let i = 0; i < 10; i++) {
        tfTree.addTransform("b", "a", BigInt(i) * sec, at(i), recordingStart + BigInt(i) * sec);
      }
      const lower: [bigint, Transform] = [0n, Transform.Empty()];
      const upper: [bigint, Transform] = [0n, Transform.Empty()];
      const lookupAt = (playbackTime: bigint) => {
        tfTree.setReceivedUntil(playbackTime);
        return tfTree.frame("b")!.findClosestTransforms(lower, upper, playbackTime, MAX_DURATION)
          ? upper[1].position()[0]
          : undefined;
      };

      expect(lookupAt(recordingStart + 3n * sec)).toBe(3);
      expect(lookupAt(recordingStart + 9n * sec)).toBe(9);
      expect(lookupAt(recordingStart - 1n)).toBeUndefined();
      // An incomplete tree shows everything it has
      tfTree.setComplete(false);
      tfTree.addTransform("b", "a", 0n, at(0), recordingStart + 5n * sec);
      expect(lookupAt(recordingStart)).toBe(0);
    });

    it("interpolates between transforms inserted out of order", () => {
      const tfTree = new TransformTree();
      tfTree.setComplete(true);
      tfTree.addTransform("b", "a", 20n * sec, at(20));
      tfTree.addTransform("b", "a", 0n, at(0));
      tfTree.addTransform("b", "a", 10n * sec, at(10));
      const lower: [bigint, Transform] = [0n, Transform.Empty()];
      const upper: [bigint, Transform] = [0n, Transform.Empty()];
      expect(tfTree.frame("b")!.findClosestTransforms(lower, upper, 15n * sec, 0n)).toBe(true);
      expect([lower[0], lower[1].position()[0]]).toEqual([10n * sec, 10]);
      expect([upper[0], upper[1].position()[0]]).toEqual([20n * sec, 20]);
    });

    it("halves every frame's history past the sample budget, keeping both ends", () => {
      const tfTree = new TransformTree(undefined, 100);
      tfTree.setComplete(true);
      for (let i = 0; i <= 100; i++) {
        tfTree.addTransform("b", "a", BigInt(i) * sec, at(i));
      }
      const frame = tfTree.frame("b")!;
      expect(tfTree.decimations).toBe(1);
      expect(frame.transformsSize()).toBe(51);
      expect(latestTimeAtOrBefore(frame, 0n)).toBe(0n);
      expect(latestTimeAtOrBefore(frame, 1000n * sec)).toBe(100n * sec);
    });

    it("thins only dense frames, so sparse ones keep every transform", () => {
      const tfTree = new TransformTree(undefined, 100);
      tfTree.setComplete(true);
      for (let i = 0; i <= 1000; i++) {
        tfTree.addTransform("dense", "a", BigInt(i) * sec, at(i));
        if (i % 50 === 0) {
          tfTree.addTransform("sparse", "a", BigInt(i) * sec, at(i));
        }
      }
      expect(tfTree.decimations).toBeGreaterThan(1);
      expect(tfTree.frame("sparse")!.transformsSize()).toBe(21);
      expect(tfTree.frame("dense")!.transformsSize()).toBeLessThanOrEqual(80);
    });

    it("keeps the thinned density for transforms added after thinning", () => {
      const tfTree = new TransformTree(undefined, 100);
      tfTree.setComplete(true);
      for (let i = 0; i <= 300; i++) {
        tfTree.addTransform("b", "a", BigInt(i) * sec, at(i));
      }
      const frame = tfTree.frame("b")!;
      const times: bigint[] = [];
      for (let t: bigint | undefined = 300n * sec; t != undefined; ) {
        times.push(t);
        t = t > 0n ? latestTimeAtOrBefore(frame, t - 1n) : undefined;
      }
      const gaps = times.slice(1).map((t, i) => Number((times[i]! - t) / sec));
      // Spaced by the final thinning step all through the recording (twice that where a halving
      // dropped a sample at the seam), and the newest transform is kept
      const step = 2 ** tfTree.decimations;
      expect(times[0]).toBe(300n * sec);
      expect(Math.max(...gaps.slice(1))).toBeLessThanOrEqual(2 * step);
      expect(Math.min(...gaps.slice(1, -1))).toBeGreaterThanOrEqual(step / 2);
      expect(frame.transformsSize()).toBeLessThanOrEqual(100);
    });

    it("keeps the earlier parent until playback reaches a preloaded reparenting", () => {
      const tfTree = new TransformTree();
      tfTree.setComplete(true);
      tfTree.addTransform("b", "a", 0n, at(1), 0n);
      tfTree.addTransform("b", "c", 10n * sec, at(2), 10n * sec);
      const lower: [bigint, Transform] = [0n, Transform.Empty()];
      const upper: [bigint, Transform] = [0n, Transform.Empty()];
      const frame = tfTree.frame("b")!;

      tfTree.setReceivedUntil(5n * sec);
      expect(frame.parent()?.id).toBe("a");
      expect(frame.findClosestTransforms(lower, upper, 5n * sec, MAX_DURATION)).toBe(true);
      expect(upper[1].position()[0]).toBe(1);

      tfTree.setReceivedUntil(20n * sec);
      expect(frame.parent()?.id).toBe("c");
      expect(frame.findClosestTransforms(lower, upper, 20n * sec, MAX_DURATION)).toBe(true);
      expect(upper[1].position()[0]).toBe(2);
      expect(frame.transformsSize()).toBe(2);
    });

    it("rejects a parent that would form a cycle with an earlier parent", () => {
      const tfTree = new TransformTree();
      tfTree.setComplete(true);
      tfTree.addTransform("b", "a", 0n, at(1), 0n);
      tfTree.addTransform("b", "c", 10n * sec, at(2), 10n * sec);
      // b's earlier parent is a, so a under b would be a cycle before 10 s
      expect(tfTree.addTransform("a", "b", 20n * sec, at(3), 20n * sec)).toBe(
        AddTransformResult.CYCLE_DETECTED,
      );
    });

    it("starts preloading unthinned after a thinned live history", () => {
      const tfTree = new TransformTree(300n * sec, 100);
      for (let i = 0; i <= 300; i++) {
        tfTree.addTransform("b", "a", BigInt(i) * sec, at(i));
      }
      expect(tfTree.decimations).toBeGreaterThan(0);
      tfTree.setComplete(true);
      expect(tfTree.decimations).toBe(0);
      tfTree.addTransform("c", "a", 0n, at(0));
      tfTree.addTransform("c", "a", 1n, at(1));
      tfTree.addTransform("c", "a", 2n, at(2));
      expect(tfTree.frame("c")!.transformsSize()).toBe(3);
    });

    it("clears the tree when leaving complete mode", () => {
      const tfTree = new TransformTree();
      tfTree.setComplete(true);
      tfTree.addTransform("b", "a", 0n, at(0));
      tfTree.setComplete(false);
      expect(tfTree.frame("b")).toBeUndefined();
    });
  });

  describe("prepend", () => {
    const sec = 1_000_000_000n;
    const at = (x: number) => new Transform([x, 0, 0], [0, 0, 0, 1]);
    const complete = () => {
      const tree = new TransformTree();
      tree.setComplete(true);
      return tree;
    };
    const xAt = (tree: TransformTree, frameId: string, time: bigint) => {
      const lower: [bigint, Transform] = [0n, Transform.Empty()];
      const upper: [bigint, Transform] = [0n, Transform.Empty()];
      tree.setReceivedUntil(time);
      return tree.frame(frameId)!.findClosestTransforms(lower, upper, time, MAX_DURATION)
        ? lower[1].position()[0]
        : undefined;
    };

    it("gives the same lookups as reading the windows in time order", () => {
      // Around the playhead first (20 s to 29 s), then the earlier window (0 s to 19 s)
      const tree = complete();
      for (let t = 20; t < 30; t++) {
        tree.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      const earlier = complete();
      for (let t = 0; t < 20; t++) {
        earlier.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
        earlier.addTransform("c", "a", BigInt(t) * sec, at(-t), BigInt(t) * sec);
      }
      tree.prepend(earlier);

      const ordered = complete();
      for (let t = 0; t < 30; t++) {
        ordered.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
        if (t < 20) {
          ordered.addTransform("c", "a", BigInt(t) * sec, at(-t), BigInt(t) * sec);
        }
      }
      for (const t of [0n, 5n, 19n, 20n, 25n, 29n]) {
        expect(xAt(tree, "b", t * sec)).toBe(xAt(ordered, "b", t * sec));
        expect(xAt(tree, "c", t * sec)).toBe(xAt(ordered, "c", t * sec));
      }
      // A frame only the earlier window had is in the tree, under this tree's parent frame
      expect(tree.frame("c")!.parent()).toBe(tree.frame("a"));
    });

    it("keeps an earlier parent from the earlier window until playback reaches the reparenting", () => {
      const tree = complete();
      tree.addTransform("b", "c", 10n * sec, at(2), 10n * sec);
      const earlier = complete();
      earlier.addTransform("b", "a", 0n, at(1), 0n);
      tree.prepend(earlier);

      tree.setReceivedUntil(5n * sec);
      expect(tree.frame("b")!.parent()).toBe(tree.frame("a"));
      expect(xAt(tree, "b", 5n * sec)).toBe(1);
      tree.setReceivedUntil(20n * sec);
      expect(tree.frame("b")!.parent()).toBe(tree.frame("c"));
      expect(xAt(tree, "b", 20n * sec)).toBe(2);
    });

    it("places a seek's transform before the loaded window under the parent it had then", () => {
      // Read around the playhead (b moved from a to c at 50 s), then a seek to 10 s reads b -> a
      const tree = complete();
      tree.addTransform("b", "c", 100n * sec, at(100), 100n * sec);
      tree.addTransform("b", "c", 110n * sec, at(110), 110n * sec);
      tree.addTransform("b", "a", 9n * sec, at(9), 9n * sec);
      tree.addTransform("b", "a", 10n * sec, at(10), 10n * sec);
      expect(tree.frame("b")!.latestParent()).toBe(tree.frame("c"));
      tree.setReceivedUntil(10n * sec);
      expect(tree.frame("b")!.parent()).toBe(tree.frame("a"));
      tree.setReceivedUntil(105n * sec);
      expect(tree.frame("b")!.parent()).toBe(tree.frame("c"));

      // Then the earlier window, which has the seek's transforms and the reparenting
      const earlier = complete();
      for (const t of [0, 9, 10, 20]) {
        earlier.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      earlier.addTransform("b", "c", 60n * sec, at(60), 60n * sec);
      tree.prepend(earlier);
      tree.setReceivedUntil(15n * sec);
      expect(tree.frame("b")!.parent()).toBe(tree.frame("a"));
      expect(xAt(tree, "b", 10n * sec)).toBe(10);
      for (const t of [70n, 105n]) {
        tree.setReceivedUntil(t * sec);
        expect(tree.frame("b")!.parent()).toBe(tree.frame("c"));
      }
      expect(xAt(tree, "b", 110n * sec)).toBe(110);
      expect(tree.frame("b")!.allParents()).toEqual([tree.frame("c"), tree.frame("a")]);
      expect(tree.frame("b")!.transformsSize()).toBe(7);
    });

    it("reparents in receive order, also to a transform with an older stamp", () => {
      const tree = complete();
      tree.addTransform("b", "c", 10n * sec, at(10), 10n * sec);
      tree.addTransform("b", "a", 0n, at(0), 50n * sec);
      tree.setReceivedUntil(60n * sec);
      expect(tree.frame("b")!.parent()).toBe(tree.frame("a"));
      tree.setReceivedUntil(20n * sec);
      expect(tree.frame("b")!.parent()).toBe(tree.frame("c"));
    });

    it("drops an earlier parent that would form a cycle with this tree's parents", () => {
      const tree = complete();
      tree.addTransform("b", "a", 10n * sec, at(1), 10n * sec);
      const earlier = complete();
      earlier.addTransform("a", "b", 1n * sec, at(2), 1n * sec);
      expect(tree.prepend(earlier)).toEqual([{ frameId: "a", parentFrameId: "b" }]);
      for (const time of [1n, 10n]) {
        tree.setReceivedUntil(time * sec);
        expect(tree.frame("b")!.root()).toBe(tree.frame("a"));
        expect(tree.frame("a")!.root()).toBe(tree.frame("a"));
      }
    });

    it("gives an earlier window the room left in the budget, but at least half", () => {
      const tree = new TransformTree(undefined, 80);
      tree.setComplete(true);
      for (let t = 0; t < 30; t++) {
        tree.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      const fill = (into: TransformTree) => {
        for (let t = 0; t < 200; t++) {
          into.addTransform("c", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
        }
        return into.frame("c")!.transformsSize();
      };
      expect(fill(tree.createEarlier())).toBeLessThanOrEqual(50);
      expect(fill(tree.createEarlier())).toBeGreaterThan(20);
      for (let t = 30; t < 80; t++) {
        tree.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      // The tree is full: the floor of 80 / 2 holds 40 samples, and thins past them
      const floor = tree.createEarlier();
      for (let t = 0; t < 40; t++) {
        floor.addTransform("c", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      expect(floor.frame("c")!.transformsSize()).toBe(40);
      expect(fill(tree.createEarlier())).toBeLessThanOrEqual(40);
    });

    it("keeps about as many samples merging a full tree's earlier window as reading in time order", () => {
      const add = (into: TransformTree, t: number) =>
        into.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      const ordered = new TransformTree(undefined, 1000);
      ordered.setComplete(true);
      for (let t = 0; t < 4000; t++) {
        add(ordered, t);
      }
      const tree = new TransformTree(undefined, 1000);
      tree.setComplete(true);
      for (let t = 2000; t < 4000; t++) {
        add(tree, t);
      }
      const earlier = tree.createEarlier();
      for (let t = 0; t < 2000; t++) {
        add(earlier, t);
      }
      tree.prepend(earlier);
      // A sample over the budget at a window's edge can cost one extra halving, not more
      expect(tree.frame("b")!.keepEvery()).toBeLessThanOrEqual(2 * ordered.frame("b")!.keepEvery());
      expect(tree.frame("b")!.transformsSize()).toBeGreaterThanOrEqual(
        ordered.frame("b")!.transformsSize() / 2,
      );
    });

    it("counts thinning done by an earlier window's own budget", () => {
      const tree = new TransformTree(undefined, 100);
      tree.setComplete(true);
      for (let t = 200; t < 210; t++) {
        tree.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      const earlier = tree.createEarlier();
      for (let t = 0; t < 150; t++) {
        earlier.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      tree.prepend(earlier);
      expect(tree.decimations).toBe(Math.log2(tree.frame("b")!.keepEvery()));
      expect(tree.decimations).toBeGreaterThan(0);
    });

    it("merges an earlier window thinned further by its own budget at one rate", () => {
      // The read around the playhead plus a seek's read fill most of the budget, so the earlier
      // window's tree halves its frame more often than the main tree did
      const tree = new TransformTree(undefined, 100);
      tree.setComplete(true);
      for (let t = 300; t < 360; t++) {
        tree.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      for (let t = 100; t < 120; t++) {
        tree.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      const earlier = tree.createEarlier();
      for (let t = 0; t < 300; t++) {
        earlier.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      const earlierRate = earlier.frame("b")!.keepEvery();
      expect(earlierRate).toBeGreaterThan(tree.frame("b")!.keepEvery());

      tree.prepend(earlier);
      expect(tree.frame("b")!.keepEvery()).toBeGreaterThanOrEqual(earlierRate);
      expect(tree.frame("b")!.transformsSize()).toBeLessThanOrEqual(100);
    });

    it("stays within the sample budget", () => {
      const tree = new TransformTree(undefined, 100);
      tree.setComplete(true);
      for (let t = 50; t < 100; t++) {
        tree.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      const earlier = complete();
      for (let t = 0; t < 50; t++) {
        earlier.addTransform("b", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
        earlier.addTransform("c", "a", BigInt(t) * sec, at(t), BigInt(t) * sec);
      }
      tree.prepend(earlier);
      const total = tree.frame("b")!.transformsSize() + tree.frame("c")!.transformsSize();
      expect(total).toBeLessThanOrEqual(100);
      expect(tree.decimations).toBeGreaterThan(0);
    });
  });
});
