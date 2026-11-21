// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three/webgpu";

import type { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_POINT_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import { makePose, Pose } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";

import { DecayPointRing } from "./DecayPointRing";
import { pointStyle } from "../pointExtensionUtils";

// Small enough to test the per-set point limit without huge arrays
vi.mock("./PointRaster", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MAX_SET_POINTS: 4_000_000,
}));

const style = pointStyle({ ...DEFAULT_POINT_SETTINGS, visible: true });

/** Places each scan at x = its message time, so pose rows are easy to check */
const transformTree = {
  apply: (
    out: Pose,
    input: Pose,
    _r: string,
    _f: string,
    src: string,
    _dst: bigint,
    srcTime: bigint,
  ) => {
    if (src === "missing") {
      return undefined;
    }
    out.position = { x: input.position.x + Number(srcTime), y: 0, z: 0 };
    out.orientation = { ...input.orientation };
    return out;
  },
} as unknown as Renderer["transformTree"];

function makeRing(limits = { maxEntries: 100, maxPoints: 1000 }) {
  const ring = new DecayPointRing("/points", style, limits);
  const points = ring.points();
  return {
    ring,
    points,
    slots: () => {
      const words = points.slotAttribute()!.array as Uint32Array;
      return Array.from(new Uint16Array(words.buffer, words.byteOffset, ring.capacity()));
    },
    positions: () => Array.from(points.positionAttribute().array),
    poseRow: (slot: number) => Array.from(points.poses()!.slice(slot * 12, slot * 12 + 12)),
  };
}

/** The top 3 rows of an affine matrix, as the pose texture stores them */
function rows(m: THREE.Matrix4): number[] {
  return [0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => m.elements[c * 4 + r]!));
}

/** A scan of `count` points whose x coordinates are `value` */
function scan(count: number, value: number) {
  return {
    positions: new Float32Array(count * 3).map((_, i) => (i % 3 === 0 ? value : 0)),
    colors: new Uint8Array(count * 4).fill(value),
  };
}

function push(ring: DecayPointRing, time: bigint, count: number, frameId = "lidar") {
  const { positions, colors } = scan(count, Number(time));
  ring.push({ receiveTime: time, messageTime: time, frameId, pose: makePose() }, positions, colors);
}

describe("DecayPointRing", () => {
  it("writes scans back to back with their slot on every point", () => {
    const { ring, slots, positions } = makeRing();
    push(ring, 1n, 2);
    push(ring, 2n, 3);

    expect(ring.scanCount()).toBe(2);
    expect(ring.pointCount()).toBe(5);
    expect(slots().slice(0, 5)).toEqual([0, 0, 1, 1, 1]);
    expect(
      positions()
        .filter((_, i) => i % 3 === 0)
        .slice(0, 5),
    ).toEqual([1, 1, 2, 2, 2]);

    ring.updatePoses(transformTree, 0n, "map", "map");
    expect(ring.drawCount()).toBe(5);
    expect(ring.visible).toBe(true);
  });

  it("hides expired scans", () => {
    const { ring, slots } = makeRing();
    push(ring, 1n, 4);
    push(ring, 2n, 4);
    push(ring, 3n, 4);

    ring.expire(3n);

    expect(ring.scanCount()).toBe(1);
    expect(ring.pointCount()).toBe(4);
    const hidden = 100; // maxEntries
    expect(slots().slice(0, 8)).toEqual(Array(8).fill(hidden));
    expect(ring.budgetEvictedUntil()).toBeUndefined();
  });

  it("reuses space freed by expired scans before growing", () => {
    const { ring, positions } = makeRing();
    push(ring, 1n, 4); // capacity grows to 16
    push(ring, 2n, 4);
    push(ring, 3n, 4);
    ring.expire(3n);

    push(ring, 4n, 4); // fits after the newest scan
    push(ring, 5n, 4); // wraps into the expired space

    expect(positions()).toHaveLength(16 * 3);
    expect(positions()[0]).toBe(5);
  });

  it("uses a free gap between scans instead of evicting a live one", () => {
    const { ring, positions } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 4); // [0, 4), capacity 10
    push(ring, 2n, 4); // [4, 8)
    ring.expire(2n);
    push(ring, 3n, 3); // wraps to [0, 3)

    push(ring, 4n, 2); // only [8, 10) is free

    expect(ring.scanCount()).toBe(3);
    expect(ring.budgetEvictedUntil()).toBeUndefined();
    expect(positions()[8 * 3]).toBe(4);
  });

  it("evicts the oldest scans at the point budget and reports it", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 4);
    push(ring, 2n, 4);
    push(ring, 3n, 4);

    expect(ring.pointCount()).toBeLessThanOrEqual(10);
    expect(ring.oldestReceiveTime()).toBe(2n);
    expect(ring.budgetEvictedUntil()).toBe(1n);
  });

  it("evicts the oldest scan when out of slots", () => {
    const { ring } = makeRing({ maxEntries: 2, maxPoints: 1000 });
    push(ring, 1n, 1);
    push(ring, 2n, 1);
    push(ring, 3n, 1);

    expect(ring.scanCount()).toBe(2);
    expect(ring.oldestReceiveTime()).toBe(2n);
    expect(ring.budgetEvictedUntil()).toBe(1n);
  });

  it("keeps a single scan larger than the budget", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 25);
    expect(ring.pointCount()).toBe(25);
  });

  it("enforces the point budget on live points, not buffer size", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 15); // buffers grow to 15
    ring.expire(2n);
    push(ring, 2n, 6);
    push(ring, 3n, 6); // fits in the buffers, but 12 points exceed the budget

    ring.enforceLimits({ maxPoints: 10, reservePoints: 0 });

    expect(ring.pointCount()).toBe(6);
    expect(ring.budgetEvictedUntil()).toBe(2n);
  });

  it("reserves room for the latest scan in both limits", () => {
    const { ring } = makeRing({ maxEntries: 3, maxPoints: 10 });
    push(ring, 1n, 3);
    push(ring, 2n, 3);

    ring.enforceLimits({ maxPoints: 10, reservePoints: 5 }); // 3 + 3 + 5 > 10
    expect(ring.oldestReceiveTime()).toBe(2n);

    push(ring, 3n, 1);
    push(ring, 4n, 1);
    ring.enforceLimits({ maxPoints: 10, reservePoints: 0 }); // 3 history scans + the latest > 3 slots
    expect(ring.scanCount()).toBe(2);

    ring.enforceLimits({ maxPoints: 10, reservePoints: 50 }); // the latest alone exceeds the budget
    expect(ring.scanCount()).toBe(0);
  });

  it("walks one range covering every live scan, free gaps hidden by their slot", () => {
    const { ring, slots } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 6); // [0, 6)
    push(ring, 2n, 1); // [6, 7)
    ring.expire(2n);
    push(ring, 3n, 4); // wraps to [0, 4); [4, 6) is free

    ring.updatePoses(transformTree, 0n, "map", "map");

    expect(ring.drawCount()).toBe(7);
    // The third scan reuses the expired scan's slot 0; slot 100 is the hidden slot
    expect(slots().slice(0, 7)).toEqual([0, 0, 0, 0, 100, 100, 1]);
  });

  it("queues partial uploads, and one full upload once too many piled up", () => {
    const { ring, points } = makeRing({ maxEntries: 1000, maxPoints: 1000 });
    push(ring, 0n, 200); // sizes the buffers for everything below
    const position = points.positionAttribute();
    position.clearUpdateRanges();

    push(ring, 1n, 1);
    expect(position.updateRanges).toHaveLength(1);

    // e.g. while nothing is drawn (a hidden tab)
    for (let i = 2; i <= 66; i++) {
      push(ring, BigInt(i), 1);
    }
    // The full upload stays queued ahead of later edits instead of being replaced by them
    expect(position.updateRanges[0]).toEqual({ start: 0, count: position.array.length });
    expect(position.updateRanges).toHaveLength(2);
    for (let i = 67; i <= 100; i++) {
      push(ring, BigInt(i), 1);
    }
    expect(points.positionAttribute()).toBe(position); // no regrow
    expect(position.updateRanges.length).toBeLessThanOrEqual(64);
    expect(position.version).toBeGreaterThan(0);
  });

  it("grows the buffers by at most 1.5x what the scans need", () => {
    const { ring, positions } = makeRing({ maxEntries: 100, maxPoints: 1_000_000 });
    for (let i = 1; i <= 10; i++) {
      push(ring, BigInt(i), 100);
    }

    expect(ring.pointCount()).toBe(1000);
    expect(positions().length / 3).toBeLessThanOrEqual(1500);
  });

  it("shrinks the buffers once the history needs far less, keeping the live scans", () => {
    const { ring, points } = makeRing({ maxEntries: 100, maxPoints: 5_000_000 });
    push(ring, 1n, 1_000_000);
    push(ring, 2n, 1_000_000);
    push(ring, 3n, 1_000_000);
    push(ring, 4n, 10_000);
    expect(ring.capacity()).toBeGreaterThanOrEqual(3_010_000);

    ring.expire(4n); // e.g. the decay time was lowered

    expect(ring.pointCount()).toBe(10_000);
    expect(ring.capacity()).toBe(15_000);
    expect(points.positionAttribute().array.length).toBe(45_000);
    expect(Array.from(points.positionAttribute().array.subarray(0, 3))).toEqual([4, 0, 0]);
    ring.updatePoses(transformTree, 0n, "map", "map");
    expect(ring.drawCount()).toBe(10_000);
  });

  it("grows no larger than one point set can hold, and skips scans that can't fit at all", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 70_000_000 });
    const pushZeros = (time: bigint, count: number) => {
      ring.push(
        { receiveTime: time, messageTime: time, frameId: "lidar", pose: makePose() },
        new Float32Array(count * 3),
        new Uint8Array(count * 4),
      );
    };

    pushZeros(1n, 3_000_000); // growth would ask for 6M points
    pushZeros(2n, 5_000_000);

    expect(ring.capacity()).toBe(4_000_000);
    expect(ring.scanCount()).toBe(1);
  });

  it("applies a lowered point budget at runtime", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 1000 });
    push(ring, 1n, 100);
    push(ring, 2n, 100);
    push(ring, 3n, 100);

    ring.enforceLimits({ maxPoints: 150, reservePoints: 0 }); // the setting was lowered

    expect(ring.pointCount()).toBe(100);
    expect(ring.oldestReceiveTime()).toBe(3n);
    expect(ring.budgetEvictedUntil()).toBe(2n);
  });

  it("bounds live scans where the shader draws them", () => {
    const { ring, points } = makeRing();
    push(ring, 10n, 1); // local x = 10, placed at x = 10 + 10
    push(ring, 20n, 1, "missing");
    ring.updatePoses(transformTree, 0n, "map", "map");

    const box = new THREE.Box3();
    (points.userData.computeBounds as (box: THREE.Box3) => void)(box);
    box.applyMatrix4(new THREE.Matrix4().makeTranslation(ring.position));

    expect(box.min.x).toBe(20);
    expect(box.max.x).toBe(20);
    expect(ring.drawCount()).toBe(2);
  });

  it("poses each scan relative to the newest scan's origin and hides scans without a transform", () => {
    const { ring, poseRow } = makeRing();
    push(ring, 10n, 1);
    push(ring, 20n, 1, "missing");
    push(ring, 30n, 1);

    expect(ring.updatePoses(transformTree, 0n, "map", "map")).toBe("missing");
    // Origin is the newest resolved scan; its own matrix is the identity
    expect(ring.position.x).toBe(30);
    expect(poseRow(2)).toEqual(rows(new THREE.Matrix4()));
    expect(poseRow(0)).toEqual(rows(new THREE.Matrix4().makeTranslation(-20, 0, 0)));
    expect(poseRow(1)).toEqual(Array(12).fill(0));
    // The all-zero row hides free slots and evicted points
    expect(poseRow(100)).toEqual(Array(12).fill(0));
  });

  it("applies a raised point budget before the next push", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 4);
    push(ring, 2n, 4);
    ring.setMaxPoints(100); // raised, and more scans arrive before the next frame
    push(ring, 3n, 4);

    expect(ring.scanCount()).toBe(3);
    expect(ring.budgetEvictedUntil()).toBeUndefined();
  });

  it("puts new shape objects in the point set's layers (the selection highlight)", () => {
    const { ring, points } = makeRing();
    push(ring, 1n, 4);
    ring.updatePoses(transformTree, 0n, "map", "map");
    points.layers.set(5);
    ring.setStyle({ ...style, shape: "cube", outline: true });

    const shapes = points.children;
    expect(shapes.length).toBe(2);
    expect(shapes.every((child) => child.layers.mask === points.layers.mask)).toBe(true);
  });

  it("drops its point arrays on dispose, in case it stays selected", () => {
    const { ring, points } = makeRing();
    push(ring, 1n, 50);
    ring.dispose();

    expect(ring.pointCount()).toBe(0);
    expect(points.positionAttribute().array).toHaveLength(0);
  });
});
