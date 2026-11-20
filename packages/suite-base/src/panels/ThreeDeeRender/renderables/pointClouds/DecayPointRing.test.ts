// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import type { Renderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/Renderer";
import { DEFAULT_POINT_SETTINGS } from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import { makePose, Pose } from "@lichtblick/suite-base/panels/ThreeDeeRender/transforms";

import { DecayPointRing } from "./DecayPointRing";

const settings = { ...DEFAULT_POINT_SETTINGS, visible: true };

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
  const ring = new DecayPointRing("/points", settings, limits);
  const points = ring.children[0] as THREE.Points;
  const geometry = points.geometry;
  const poses = (points.userData.pickingMaterial as THREE.ShaderMaterial).uniforms.scanPoses!
    .value as THREE.DataTexture;
  return {
    ring,
    geometry,
    slots: () => Array.from(geometry.attributes.scanSlot!.array),
    positions: () => Array.from(geometry.attributes.position!.array),
    /** Buffer size in points, without copying the (possibly huge) array */
    capacity: () => geometry.attributes.position!.array.length / 3,
    poseRow: (slot: number) =>
      Array.from((poses.image.data as Float32Array).slice(slot * 12, slot * 12 + 12)),
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
    const { ring, geometry, slots, positions } = makeRing();
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
    expect(geometry.drawRange).toEqual({ start: 0, count: 5 });
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

  it("draws a wrapped ring as two spans without the free gap", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 6); // [0, 6)
    push(ring, 2n, 1); // [6, 7)
    ring.expire(2n);
    push(ring, 3n, 4); // wraps to [0, 4); [4, 6) is free

    ring.updatePoses(transformTree, 0n, "map", "map");

    expect(ring.drawSpans()).toEqual([
      { start: 0, count: 4 },
      { start: 6, count: 1 },
    ]);
  });

  it("uploads whole buffers after the ring was empty, until three.js uploads them", () => {
    const { ring, geometry } = makeRing();
    push(ring, 1n, 20); // sizes the buffers so later pushes don't reallocate
    ring.expire(2n);
    ring.updatePoses(transformTree, 0n, "map", "map"); // empty: queued ranges dropped
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const version = position.version;

    push(ring, 2n, 2);
    // A frame without a draw (hidden tab) must not end the full upload
    ring.updatePoses(transformTree, 0n, "map", "map");
    push(ring, 3n, 2);
    expect(position.updateRanges).toEqual([]); // no ranges: three.js uploads everything
    expect(position.version).toBeGreaterThan(version);

    position.onUploadCallback(); // three.js uploaded it
    push(ring, 4n, 2);
    expect(position.updateRanges).toHaveLength(1);
  });

  it("uploads whole point buffers after switching back from cubes", () => {
    const { ring, geometry } = makeRing();
    ring.setShape({ shape: "cube", showOutline: false });
    push(ring, 1n, 20); // sizes the buffers so later pushes don't reallocate // written while drawing cubes: not queued for the point buffers
    ring.setShape({ shape: undefined, showOutline: false });
    const position = geometry.attributes.position as THREE.BufferAttribute;

    push(ring, 2n, 2);
    expect(position.updateRanges).toEqual([]);

    position.onUploadCallback();
    push(ring, 3n, 2);
    expect(position.updateRanges).toHaveLength(1);
  });

  it("uploads whole instance buffers after the ring was empty, until three.js uploads them", () => {
    const { ring } = makeRing();
    ring.setShape({ shape: "cube", showOutline: false });
    push(ring, 1n, 20); // sizes the buffers so later pushes don't reallocate
    ring.expire(2n);
    ring.updatePoses(transformTree, 0n, "map", "map"); // empty: queued ranges dropped
    const cubes = ring.children.find((child) => child instanceof THREE.Mesh)!;
    const instances = (
      cubes.geometry.getAttribute("instancePosition") as THREE.InterleavedBufferAttribute
    ).data;

    push(ring, 2n, 2);
    ring.updatePoses(transformTree, 0n, "map", "map"); // a frame without a draw
    push(ring, 3n, 2);
    expect(instances.updateRanges).toEqual([]);

    instances.onUploadCallback();
    push(ring, 4n, 2);
    expect(instances.updateRanges).toHaveLength(1);
  });

  it("caps queued uploads while nothing is drawn", () => {
    const { ring, geometry } = makeRing({ maxEntries: 1000, maxPoints: 1000 });
    push(ring, 0n, 200); // sizes the buffers for everything below
    ring.expire(1n);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    position.onUploadCallback(); // the first full upload happened

    for (let i = 1; i <= 100; i++) {
      push(ring, BigInt(i), 1);
      ring.updatePoses(transformTree, 0n, "map", "map");
    }

    expect(geometry.attributes.position).toBe(position); // no regrow
    // Past the cap the queue was dropped for one full upload, instead of 100 partial ranges
    expect(position.updateRanges).toEqual([]);

    position.onUploadCallback();
    push(ring, 101n, 1);
    expect(position.updateRanges).toHaveLength(1);
  });

  it("grows the buffers by at most 1.5x what the scans need", () => {
    const { ring, capacity } = makeRing({ maxEntries: 100, maxPoints: 1_000_000 });
    for (let i = 1; i <= 10; i++) {
      push(ring, BigInt(i), 100);
    }

    expect(ring.pointCount()).toBe(1000);
    expect(capacity()).toBeLessThanOrEqual(1500);
  });

  it("shrinks the buffers once the history needs far less, keeping the live scans", () => {
    const { ring, geometry, capacity } = makeRing({ maxEntries: 100, maxPoints: 5_000_000 });
    push(ring, 1n, 1_000_000);
    push(ring, 2n, 1_000_000);
    push(ring, 3n, 1_000_000);
    push(ring, 4n, 10_000);
    expect(capacity()).toBeGreaterThanOrEqual(3_010_000);

    ring.expire(4n); // e.g. the decay time was lowered

    expect(ring.pointCount()).toBe(10_000);
    expect(capacity()).toBe(15_000);
    expect(Array.from(geometry.attributes.position!.array.subarray(0, 3))).toEqual([4, 0, 0]);
    ring.updatePoses(transformTree, 0n, "map", "map");
    expect(ring.drawSpans()).toEqual([{ start: 0, count: 10_000 }]);
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

  it("applies a raised point budget before the next push", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 4);
    push(ring, 2n, 4);
    ring.setMaxPoints(100); // raised, and more scans arrive before the next frame
    push(ring, 3n, 4);

    expect(ring.scanCount()).toBe(3);
    expect(ring.budgetEvictedUntil()).toBeUndefined();
  });

  it("puts new shape objects in the ring's layers (the selection highlight)", () => {
    const { ring } = makeRing();
    push(ring, 1n, 4);
    ring.layers.set(5);
    ring.setShape({ shape: "cube", showOutline: true });

    const meshes = ring.children.filter((c) => !(c instanceof THREE.Points));
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => m.layers.mask === ring.layers.mask)).toBe(true);
  });

  it("drops its point arrays on dispose, in case it stays selected", () => {
    const { ring, geometry } = makeRing();
    push(ring, 1n, 50);
    ring.dispose();

    expect(ring.pointCount()).toBe(0);
    expect(geometry.attributes.position!.array).toHaveLength(0);
  });

  it("bounds live scans where the shader draws them", () => {
    const { ring, geometry } = makeRing();
    push(ring, 10n, 1); // local x = 10, placed at x = 10 + 10
    push(ring, 20n, 1, "missing");
    ring.updatePoses(transformTree, 0n, "map", "map");

    const box = new THREE.Box3();
    const points = ring.children[0] as THREE.Points;
    (points.userData.computeBounds as (box: THREE.Box3) => void)(box);
    box.applyMatrix4(new THREE.Matrix4().makeTranslation(ring.position));

    expect(box.min.x).toBe(20);
    expect(box.max.x).toBe(20);
    expect(geometry.drawRange.count).toBe(2);
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
});
