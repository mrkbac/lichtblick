// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Transform } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms/Transform";

import { MAX_DURATION } from "./CoordinateFrame";
import { AddTransformResult, TransformTree } from "./TransformTree";

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

  it("keeps only maxStorageTime of history per frame, well below the capacity cap", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree(10n * sec, 10_000);
    // 10 Hz for 1000 s: the old capacity-only trim would keep all 10_000 transforms.
    for (let i = 0n; i < 10_000n; i++) {
      tfTree.addTransform(
        "b",
        "a",
        i * (sec / 10n),
        new Transform([Number(i), 0, 0], [0, 0, 0, 1]),
      );
    }
    const size = tfTree.frame("b")!.transformsSize();
    // 10 s window plus up to a quarter window of slack before the amortized trim runs.
    expect(size).toBeGreaterThanOrEqual(100);
    expect(size).toBeLessThanOrEqual(126);
  });

  it("keeps the transform just before the storage window for interpolation", () => {
    const sec = BigInt(1e9);
    const tfTree = new TransformTree(300n * sec, 10_000);
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

    it("keeps every transform beyond the storage window and capacity", () => {
      const tfTree = new TransformTree(10n * sec, 100);
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
      const tfTree = new TransformTree(undefined, undefined, 100);
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

    it("clears the tree when leaving complete mode", () => {
      const tfTree = new TransformTree();
      tfTree.setComplete(true);
      tfTree.addTransform("b", "a", 0n, at(0));
      tfTree.setComplete(false);
      expect(tfTree.frame("b")).toBeUndefined();
    });
  });
});
