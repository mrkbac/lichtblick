// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * A/B benchmark of the decay ring against a baseline ring from another git ref, in one process with
 * shuffled rounds. Skipped unless DECAY_AB is set:
 *
 *   DECAY_AB=1 [DECAY_AB_BASE=origin/licht] pnpm vitest run --silent=false <this file>
 *
 * It writes the baseline's DecayPointRing and RasterPoints next to this file for the run (removed
 * afterwards) and simulates 60 fps playback: 100 Hz odometry in a real TransformTree, scans in a
 * sensor frame under it, render frame `base`, fixed frame `odom`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DecayPointRing } from "./DecayPointRing";
import { DEFAULT_POINT_SETTINGS } from "../../settingsNodes/topics";
import { makePose, Transform, TransformTree } from "../../transforms";
import { DECAY_HISTORY_LIMITS, pointStyle } from "../pointExtensionUtils";

type Ring = Pick<
  DecayPointRing,
  | "push"
  | "expire"
  | "enforceLimits"
  | "updatePoses"
  | "oldestReceiveTime"
  | "scanCount"
  | "capacity"
  | "dispose"
>;
type RingClass = new (...args: ConstructorParameters<typeof DecayPointRing>) => Ring;

const style = pointStyle({ ...DEFAULT_POINT_SETTINGS, visible: true });
const SEC = 1_000_000_000n;
const BASE = process.env.DECAY_AB_BASE ?? "origin/licht";
const DIR = import.meta.dirname;

type Scenario = { name: string; hz: number; points: () => number; decayS: number; seconds: number };
const scenarios: Scenario[] = [
  {
    name: "2D lidar 40 Hz x 1k pts, 60 s decay",
    hz: 40,
    points: () => 1000,
    decayS: 60,
    seconds: 100,
  },
  {
    name: "2D lidar 20 Hz x 1k pts, 100 s decay",
    hz: 20,
    points: () => 1000,
    decayS: 100,
    seconds: 120,
  },
  {
    name: "2D lidar 10 Hz x 1k pts, 60 s decay (no thinning)",
    hz: 10,
    points: () => 1000,
    decayS: 60,
    seconds: 80,
  },
  {
    name: "3D lidar 10 Hz x 90-110k pts, 30 s decay",
    hz: 10,
    points: () => 90_000 + Math.floor(Math.random() * 20_000),
    decayS: 30,
    seconds: 50,
  },
];

function run(Ring: RingClass, sc: Scenario) {
  const tree = new TransformTree();
  tree.addTransform("lidar", "base", 0n, new Transform([0.2, 0, 0.3], [0, 0, 0, 1]));
  const ring = new Ring("/s", style, DECAY_HISTORY_LIMITS);
  const maxPts = 130_000;
  const positions = new Float32Array(maxPts * 3).fill(1);
  const colors = new Uint8Array(maxPts * 4);
  const decay = BigInt(sc.decayS) * SEC;
  const frameNs = SEC / 60n;
  const scanNs = SEC / BigInt(sc.hz);
  let tfNext = 0n;
  let scanNext = 0n;
  let workMs = 0;
  const frameTimes: number[] = [];
  const end = BigInt(sc.seconds) * SEC;
  for (let now = 0n; now <= end; now += frameNs) {
    for (; tfNext <= now; tfNext += SEC / 100n) {
      const s = Number(tfNext) / 1e9;
      tree.addTransform(
        "base",
        "odom",
        tfNext,
        new Transform(
          [s * 0.5, 3 * Math.sin(s / 10), 0],
          [0, 0, Math.sin(s / 20), Math.cos(s / 20)],
        ),
      );
    }
    for (; scanNext <= now; scanNext += scanNs) {
      const n = sc.points();
      const t0 = performance.now();
      const info = {
        receiveTime: scanNext,
        messageTime: scanNext,
        frameId: "lidar",
        pose: makePose(),
        fingerprint: 0,
      };
      ring.push(info, positions.subarray(0, n * 3), colors.subarray(0, n * 4));
      workMs += performance.now() - t0;
    }
    const t0 = performance.now();
    ring.expire(now - decay);
    ring.enforceLimits({ maxPoints: DECAY_HISTORY_LIMITS.maxPoints, reservePoints: sc.points() });
    ring.updatePoses(tree, now, "base", "odom");
    const dt = performance.now() - t0;
    workMs += dt;
    if (now > decay + 5n * SEC) {
      frameTimes.push(dt);
    }
  }
  const paused: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    ring.updatePoses(tree, end, "base", "odom");
    paused.push(performance.now() - t0);
  }
  frameTimes.sort((a, b) => a - b);
  paused.sort((a, b) => a - b);
  const result = {
    window_s: Math.round(Number(end - ring.oldestReceiveTime()!) / 1e9),
    scans: ring.scanCount(),
    frame_p50_ms: frameTimes[frameTimes.length >> 1]!,
    frame_p95_ms: frameTimes[Math.floor(frameTimes.length * 0.95)]!,
    paused_ms: paused[50]!,
    cpu_per_s_ms: workMs / sc.seconds,
    buffers_MB: (ring.capacity() * (12 + 4 + 2)) / 1e6,
  };
  ring.dispose();
  return result;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

describe.runIf(process.env.DECAY_AB != undefined)("DecayPointRing A/B", () => {
  const baseline = {
    ring: path.join(DIR, "zzBaselineDecayPointRing.ts"),
    raster: path.join(DIR, "zzBaselineRasterPoints.ts"),
  };
  afterAll(() => {
    fs.rmSync(baseline.ring, { force: true });
    fs.rmSync(baseline.raster, { force: true });
  });

  it(`against ${BASE}`, async () => {
    const show = (file: string) =>
      execFileSync("git", ["show", `${BASE}:./${file}`], { cwd: DIR, encoding: "utf8" });
    fs.writeFileSync(
      baseline.ring,
      show("DecayPointRing.ts").replace('from "./RasterPoints"', 'from "./zzBaselineRasterPoints"'),
    );
    fs.writeFileSync(baseline.raster, show("RasterPoints.ts"));
    const { DecayPointRing: BaselineRing } = (await import(/* @vite-ignore */ baseline.ring)) as {
      DecayPointRing: RingClass;
    };

    for (const sc of scenarios) {
      const results: Record<"base" | "new", ReturnType<typeof run>[]> = { base: [], new: [] };
      for (let round = 0; round < 5; round++) {
        for (const variant of (["base", "new"] as const).slice().sort(() => Math.random() - 0.5)) {
          results[variant].push(run(variant === "base" ? BaselineRing : DecayPointRing, sc));
        }
      }
      const summary = (rows: ReturnType<typeof run>[]) =>
        Object.fromEntries(
          Object.keys(rows[0]!).map((key) => [
            key,
            +median(rows.map((row) => row[key as keyof typeof row])).toFixed(3),
          ]),
        );
      const base = summary(results.base);
      const next = summary(results.new);
      console.log(`${sc.name} (medians of 5 rounds)`);
      console.table({ [BASE]: base, "this branch": next });
      // Timings are left to the reader (noisy on a loaded machine); these must never get worse
      expect(next.window_s).toBeGreaterThanOrEqual(base.window_s!);
      expect(next.buffers_MB).toBeLessThanOrEqual(base.buffers_MB!);
    }
  }, 900_000);
});
