// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Transform } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/Transform";

import { MAX_DURATION } from "./CoordinateFrame";
import {
  AddTransformResult,
  FULL_RATE_TRANSFORM_TIME,
  THINNED_TRANSFORM_SPACING,
  TransformTree,
} from "./TransformTree";

const tf = Transform.Identity();
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
      t = t > 0n ? frame.latestTimeAtOrBefore(t - 1n) : undefined;
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
    expect(frame.latestTimeAtOrBefore(0n)).toBe(0n);
    expect(frame.latestTimeAtOrBefore(1000n * sec)).toBe(300n * sec);
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
    expect(tfTree.frame("b")!.latestTimeAtOrBefore(t - 2n * sec)).toBe(t - 2n * sec);
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
      expect(frame.latestTimeAtOrBefore(0n)).toBe(0n);
      expect(frame.latestTimeAtOrBefore(1000n * sec)).toBe(100n * sec);
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
        t = t > 0n ? frame.latestTimeAtOrBefore(t - 1n) : undefined;
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

    it("clears the tree when leaving complete mode", () => {
      const tfTree = new TransformTree();
      tfTree.setComplete(true);
      tfTree.addTransform("b", "a", 0n, at(0));
      tfTree.setComplete(false);
      expect(tfTree.frame("b")).toBeUndefined();
    });
  });
});
