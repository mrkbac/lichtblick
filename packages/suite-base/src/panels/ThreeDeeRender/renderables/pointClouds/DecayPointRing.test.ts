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
  frames: () => new Map(),
  isComplete: () => false,
  version: 0,
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

function pts(count: number): [Float32Array, Uint8Array] {
  const { positions, colors } = scan(count, 0);
  return [positions, colors];
}

function push(ring: DecayPointRing, time: bigint, count: number, frameId = "lidar") {
  const { positions, colors } = scan(count, Number(time));
  ring.push(
    { receiveTime: time, messageTime: time, frameId, pose: makePose(), fingerprint: 0 },
    positions,
    colors,
  );
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

  it("keeps distinct records with the same times apart by their payload fingerprint", () => {
    const { ring } = makeRing();
    const info = { receiveTime: 1n, messageTime: 1n, frameId: "lidar", pose: makePose() };
    ring.push({ ...info, fingerprint: 1 }, ...pts(1)); // e.g. two segments of one sweep
    ring.push({ ...info, fingerprint: 2 }, ...pts(1));
    ring.push({ ...info, fingerprint: 2 }, ...pts(1)); // the second one again

    expect(ring.scanCount()).toBe(2);
    expect(ring.has(1n, 1n, 2)).toBe(true);
    expect(ring.has(1n, 1n, 3)).toBe(false);
  });

  it("places scans older than the newest in age order and skips ones it already has", () => {
    const { ring } = makeRing();
    push(ring, 5n, 1); // e.g. the latest scan before the seek read's older ones arrive
    push(ring, 2n, 1);
    push(ring, 3n, 1);
    push(ring, 3n, 1);

    expect(ring.scanCount()).toBe(3);
    expect(ring.oldestReceiveTime()).toBe(2n);
    // A different scan received at the same time is kept
    ring.push(
      { receiveTime: 3n, messageTime: 99n, frameId: "lidar", pose: makePose(), fingerprint: 0 },
      ...pts(1),
    );
    expect(ring.scanCount()).toBe(4);
    ring.expire(4n);
    expect(ring.scanCount()).toBe(1);
    expect(ring.oldestReceiveTime()).toBe(5n);
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

  it("thins every other scan at the point budget, keeping the newest, and packs the rest", () => {
    const { ring, positions } = makeRing({ maxEntries: 100, maxPoints: 10 });
    push(ring, 1n, 4);
    push(ring, 2n, 4);
    push(ring, 3n, 4);

    expect(ring.pointCount()).toBe(8);
    expect(ring.oldestReceiveTime()).toBe(2n);
    expect(ring.stride()).toBe(2);
    expect(ring.budgetEvictedUntil()).toBeUndefined();
    expect(positions()[0]).toBe(2);
    expect(positions()[4 * 3]).toBe(3);
  });

  it("keeps the whole window at a lower density when out of slots", () => {
    const { ring } = makeRing({ maxEntries: 4, maxPoints: 1000 });
    for (let i = 1; i <= 16; i++) {
      push(ring, BigInt(i), 1);
    }

    // Dropping the oldest would keep only 13-16
    expect(ring.scanCount()).toBe(4);
    expect(ring.oldestReceiveTime()).toBe(4n);
    expect(ring.stride()).toBe(4);
    expect(ring.budgetEvictedUntil()).toBeUndefined();
  });

  it("keeps 1 in `stride` new scans, and goes back to every scan once there is room", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    for (let i = 1; i <= 3; i++) {
      push(ring, BigInt(i), 4);
    }
    expect(ring.stride()).toBe(2);
    push(ring, 4n, 1); // skipped
    push(ring, 5n, 1);
    expect(ring.scanCount()).toBe(3);

    ring.expire(5n); // e.g. the decay time was lowered: 1 point left
    ring.enforceLimits({ maxPoints: 10, reservePoints: 0 });
    expect(ring.stride()).toBe(1);
    push(ring, 6n, 1);
    push(ring, 7n, 1);
    expect(ring.scanCount()).toBe(3);
  });

  it("keeps thinning that one point set's size forced, with a larger point budget", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 100_000_000 });
    for (let i = 1; i <= 5; i++) {
      push(ring, BigInt(i), 1_000_000); // the buffers stop at 4M points (mocked set size)
    }
    expect(ring.stride()).toBe(2);

    ring.enforceLimits({ maxPoints: 100_000_000, reservePoints: 0 });

    expect(ring.stride()).toBe(2);
  });

  it("empties without thinning when the latest scan alone exceeds the budget", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 10 });
    for (let i = 1; i <= 4; i++) {
      push(ring, BigInt(i), 1);
    }

    ring.enforceLimits({ maxPoints: 10, reservePoints: 50 });

    expect(ring.scanCount()).toBe(0);
    expect(ring.stride()).toBe(1);
  });

  it("recomputes no pose rows until the transforms change, then rechecks them", () => {
    const { ring, points } = makeRing();
    push(ring, 1n, 1);
    push(ring, 2n, 1);
    const tree = {
      apply: (...args: Parameters<Renderer["transformTree"]["apply"]>) =>
        transformTree.apply(...args),
      frames: () => new Map(),
      isComplete: () => false,
      version: 1,
    } as unknown as Renderer["transformTree"];
    const apply = vi.spyOn(tree, "apply");
    ring.updatePoses(tree, 0n, "map", "map");
    points.poseAttribute()!.clearUpdateRanges();
    apply.mockClear();

    ring.updatePoses(tree, 0n, "map", "map");
    expect(apply).toHaveBeenCalledTimes(1); // render <- fixed only
    expect(points.poseAttribute()!.updateRanges).toEqual([]);

    (tree as { version: number }).version = 2;
    ring.updatePoses(tree, 0n, "map", "map");
    expect(apply).toHaveBeenCalledTimes(1 + 2 + 1);
    expect(points.poseAttribute()!.updateRanges).toEqual([{ start: 0, count: 2 * 12 }]);
  });

  it("places the whole ring by the render frame's transform", () => {
    const { ring, poseRow } = makeRing();
    push(ring, 10n, 1);
    push(ring, 20n, 1);
    ring.updatePoses(transformTree, 5n, "map", "odom"); // render <- fixed: x + 5

    // Rows are relative to the first placed scan (the newest) in the fixed frame
    expect(poseRow(1)).toEqual(rows(new THREE.Matrix4()));
    expect(poseRow(0)).toEqual(rows(new THREE.Matrix4().makeTranslation(-10, 0, 0)));
    expect(ring.position.x).toBe(25);
  });

  it("halves the stride at most once until the window was refilled at the new rate", () => {
    const { ring } = makeRing({ maxEntries: 4, maxPoints: 1000 });
    for (let i = 1; i <= 16; i++) {
      push(ring, BigInt(i), 1);
    }
    expect(ring.stride()).toBe(4);
    ring.expire(13n); // e.g. a shorter decay time: 1 scan left, taken at the current rate
    ring.enforceLimits({ maxPoints: 1000, reservePoints: 0 });
    expect(ring.stride()).toBe(2);

    for (let i = 0; i < 10; i++) {
      ring.enforceLimits({ maxPoints: 1000, reservePoints: 0 });
    }
    expect(ring.stride()).toBe(2); // the kept scan was taken at 1 in 4
  });

  it("drops a scan holding over half the points instead of thinning around it", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 20 });
    push(ring, 1n, 1);
    push(ring, 2n, 1);
    push(ring, 3n, 1);
    push(ring, 4n, 12); // the newest, which thinning always keeps

    ring.enforceLimits({ maxPoints: 20, reservePoints: 8 });

    expect(ring.pointCount()).toBe(3);
    expect(ring.stride()).toBe(1);
    expect(ring.budgetEvictedUntil()).toBe(4n); // reported as history lost to the budget
  });

  it("recomputes rows when the tree changes or a complete tree's playback time moves", () => {
    const { ring } = makeRing();
    push(ring, 1n, 1);
    let complete = false;
    const apply = vi.fn((...args: Parameters<Renderer["transformTree"]["apply"]>) =>
      transformTree.apply(...args),
    );
    const tree = {
      apply,
      isComplete: () => complete,
      version: 1,
    } as unknown as Renderer["transformTree"] & { version: number };
    ring.updatePoses(tree, 0n, "map", "map");
    const placements = () => apply.mock.calls.filter(([, , , , src]) => src === "lidar").length;
    expect(placements()).toBe(1);
    ring.updatePoses(tree, 0n, "map", "map");
    expect(placements()).toBe(1);

    tree.version++; // e.g. a new transform, or a frame offset edited in the settings
    ring.updatePoses(tree, 0n, "map", "map");
    expect(placements()).toBe(2);

    ring.updatePoses(tree, 5n, "map", "map"); // time moves, but the tree shows everything
    expect(placements()).toBe(2);
    complete = true; // a preloaded tree shows only transforms received by the playback time
    ring.updatePoses(tree, 6n, "map", "map");
    expect(placements()).toBe(3);
  });

  it("places every scan over a few redraws, without scans missing a transform holding them back", () => {
    const { ring, poseRow } = makeRing({ maxEntries: 1000, maxPoints: 10_000 });
    ring.updatePoses(transformTree, 0n, "map", "map"); // a first frame places everything at once
    for (let i = 1; i <= 60; i++) {
      push(ring, BigInt(i), 1);
    }
    for (let i = 61; i <= 210; i++) {
      push(ring, BigInt(i), 1, "missing"); // the newest, so they are tried first
    }

    expect(ring.updatePoses(transformTree, 0n, "map", "map")).toBe("missing");
    expect(ring.posesPending()).toBe(true); // the per-frame budget ran out
    ring.updatePoses(transformTree, 0n, "map", "map");

    expect(ring.posesPending()).toBe(false);
    for (let slot = 0; slot < 60; slot++) {
      expect(poseRow(slot)).not.toEqual(Array(12).fill(0));
    }
    expect(ring.updatePoses(transformTree, 0n, "map", "map")).toBe("missing");
  });

  it("corrects the newest outdated rows first, and retries only a few scans missing a transform", () => {
    const { ring } = makeRing({ maxEntries: 1000, maxPoints: 10_000 });
    const apply = vi.fn((...args: Parameters<Renderer["transformTree"]["apply"]>) =>
      transformTree.apply(...args),
    );
    const tree = {
      apply,
      isComplete: () => false,
      version: 1,
    } as unknown as Renderer["transformTree"] & {
      version: number;
    };
    ring.updatePoses(tree, 0n, "map", "map");
    for (let i = 1; i <= 300; i++) {
      push(ring, BigInt(i), 1, i <= 200 ? "missing" : "lidar");
    }
    for (let frame = 0; frame < 3; frame++) {
      ring.updatePoses(tree, 0n, "map", "map"); // every scan tried once
    }
    expect(ring.posesPending()).toBe(false);
    apply.mockClear();

    tree.version++; // every row outdated, every missing scan worth a retry
    ring.updatePoses(tree, 0n, "map", "map");

    const times = apply.mock.calls.slice(0, -1).map(([, , , , src, , time]) => [src, time]);
    expect(times.filter(([src]) => src === "missing")).toHaveLength(16);
    // The newest placed scan is rechecked in this frame
    expect(times).toContainEqual(["lidar", 300n]);
  });

  it("rebases the rows once the scans are far from their origin", () => {
    const { ring, poseRow } = makeRing();
    push(ring, 1n, 1);
    ring.updatePoses(transformTree, 0n, "map", "map");
    push(ring, 5000n, 1); // placed at x = 5000, 5 km away

    ring.updatePoses(transformTree, 0n, "map", "map");
    ring.updatePoses(transformTree, 0n, "map", "map");

    // Relative to the newest scan again, so float32 rows stay small
    expect(ring.position.x).toBe(5000);
    expect(poseRow(1)).toEqual(rows(new THREE.Matrix4()));

    // The older scan, still 5 km from the new origin, doesn't trigger another rebase
    const apply = vi.fn((...args: Parameters<Renderer["transformTree"]["apply"]>) =>
      transformTree.apply(...args),
    );
    const tree = {
      apply,
      isComplete: () => false,
      version: 0,
    } as unknown as Renderer["transformTree"];
    ring.updatePoses(tree, 0n, "map", "map");
    expect(apply).toHaveBeenCalledTimes(1); // render <- fixed only
  });

  it("thins at most once per push, also when it already thinned for a slot", () => {
    const { ring } = makeRing({ maxEntries: 4, maxPoints: 8 });
    for (let i = 1; i <= 4; i++) {
      push(ring, BigInt(i), 2); // every slot and point in use
    }

    push(ring, 5n, 4); // out of slots, and short of space after that thinning

    expect(ring.stride()).toBe(2);
  });

  it("packs instead of dropping a scan when thinning wouldn't free enough", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 100 });
    push(ring, 1n, 60); // [0, 60), buffers at the 100-point budget
    push(ring, 2n, 30); // [60, 90)
    ring.expire(2n); // frees [0, 60)
    push(ring, 3n, 2); // [90, 92)
    push(ring, 4n, 50); // [0, 50); free: [50, 60) and [92, 100)

    push(ring, 5n, 12); // no free range fits, but 94 points fit once packed

    expect(ring.pointCount()).toBe(94);
    expect(ring.scanCount()).toBe(4);
    expect(ring.budgetEvictedUntil()).toBeUndefined();
  });

  it("keeps reporting a scan still missing a transform while its retry waits its turn", () => {
    const { ring } = makeRing({ maxEntries: 1000, maxPoints: 10_000 });
    const tree = {
      apply: (...args: Parameters<Renderer["transformTree"]["apply"]>) =>
        transformTree.apply(...args),
      isComplete: () => false,
      version: 1,
    } as unknown as Renderer["transformTree"] & { version: number };
    ring.updatePoses(tree, 0n, "map", "map");
    for (let i = 1; i <= 40; i++) {
      push(ring, BigInt(i), 1, "missing");
    }
    ring.updatePoses(tree, 0n, "map", "map");

    for (let frame = 0; frame < 5; frame++) {
      tree.version++;
      expect(ring.updatePoses(tree, 0n, "map", "map")).toBe("missing");
    }
  });

  it("remembers the newest scan dropped for the budget, whatever the order of drops", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 20 });
    push(ring, 1n, 1);
    push(ring, 2n, 1);
    push(ring, 3n, 1);
    push(ring, 4n, 12);
    ring.enforceLimits({ maxPoints: 20, reservePoints: 8 }); // drops the 12-point scan (4n)
    expect(ring.budgetEvictedUntil()).toBe(4n);

    ring.enforceLimits({ maxPoints: 20, reservePoints: 30 }); // then the oldest ones

    expect(ring.scanCount()).toBe(0);
    expect(ring.budgetEvictedUntil()).toBe(4n);
  });

  it("retries scans missing a transform in turns", () => {
    const { ring } = makeRing({ maxEntries: 1000, maxPoints: 10_000 });
    const apply = vi.fn((...args: Parameters<Renderer["transformTree"]["apply"]>) =>
      transformTree.apply(...args),
    );
    const tree = {
      apply,
      isComplete: () => false,
      version: 1,
    } as unknown as Renderer["transformTree"] & {
      version: number;
    };
    ring.updatePoses(tree, 0n, "map", "map");
    for (let i = 1; i <= 40; i++) {
      push(ring, BigInt(i), 1, "missing");
    }
    ring.updatePoses(tree, 0n, "map", "map"); // all tried once
    apply.mockClear();

    for (let frame = 0; frame < 3; frame++) {
      tree.version++; // e.g. live transforms keep arriving
      ring.updatePoses(tree, 0n, "map", "map");
    }

    const retried = new Set(
      apply.mock.calls.map(([, , , , src, , time]) => `${String(src)} ${time}`),
    );
    retried.delete("map 0"); // render <- fixed
    expect(retried.size).toBe(40); // 3 x 16 retries reach every scan, not the 16 newest again
  });

  it("thins at most once while making room for one scan", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 16 });
    for (let i = 1; i <= 8; i++) {
      push(ring, BigInt(i), 2); // fills the 16-point buffers
    }
    expect(ring.stride()).toBe(1);

    push(ring, 9n, 12); // needs far more than one thinning frees

    expect(ring.stride()).toBe(2);
  });

  it("names the fixed frame when the render frame can't be placed in it", () => {
    const { ring } = makeRing();
    push(ring, 1n, 1);
    const tree = {
      apply: (out: Pose, input: Pose, _r: string, _f: string, src: string, ...rest: bigint[]) =>
        src === "odom"
          ? undefined
          : transformTree.apply(out, input, _r, _f, src, rest[0]!, rest[1]!),
      isComplete: () => false,
      version: 0,
    } as unknown as Renderer["transformTree"];

    expect(ring.updatePoses(tree, 0n, "map", "odom")).toBe("odom");
  });

  it("frees only about as much as the budget needs", () => {
    const { ring } = makeRing({ maxEntries: 100, maxPoints: 20 });
    push(ring, 1n, 1);
    push(ring, 2n, 1);
    push(ring, 3n, 1);
    push(ring, 4n, 10);

    ring.enforceLimits({ maxPoints: 20, reservePoints: 8 }); // 1 point over

    expect(ring.pointCount()).toBe(11); // two 1-point scans thinned, the 10-point scan kept
    expect(ring.budgetEvictedUntil()).toBeUndefined();
  });

  it("uploads only the poses of slots in use", () => {
    const { ring, points } = makeRing();
    push(ring, 1n, 1);
    push(ring, 2n, 1);
    points.poseAttribute()!.clearUpdateRanges();

    ring.updatePoses(transformTree, 0n, "map", "map");

    expect(points.poseAttribute()!.updateRanges).toEqual([{ start: 0, count: 2 * 12 }]);
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
    expect(ring.oldestReceiveTime()).toBe(3n);
    expect(ring.stride()).toBe(2);
  });

  it("reserves room for the latest scan, and empties when the latest alone fills the budget", () => {
    const { ring } = makeRing({ maxEntries: 3, maxPoints: 10 });
    push(ring, 1n, 3);
    push(ring, 2n, 3);

    ring.enforceLimits({ maxPoints: 10, reservePoints: 5 }); // 3 + 3 + 5 > 10
    expect(ring.oldestReceiveTime()).toBe(2n);
    expect(ring.budgetEvictedUntil()).toBeUndefined();

    ring.enforceLimits({ maxPoints: 10, reservePoints: 50 }); // the latest alone exceeds the budget
    expect(ring.scanCount()).toBe(0);
    expect(ring.budgetEvictedUntil()).toBe(2n);
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
        {
          receiveTime: time,
          messageTime: time,
          frameId: "lidar",
          pose: makePose(),
          fingerprint: 0,
        },
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
    expect(ring.stride()).toBe(4);
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
