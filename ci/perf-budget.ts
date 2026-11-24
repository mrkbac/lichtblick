// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Perf budget: builds benchmark/src/perf/cases.ts and the web app from this checkout and from a
// base commit (default: the merge base with origin/licht), runs both builds in one process in
// shuffled rounds, and fails when a metric gets worse than its budget allows.
//
//   pnpm perf:budget [--base <ref>]
//
// Wall times are only compared within one run (paired rounds, median ratio), never against fixed
// numbers, so a slow or busy machine doesn't fail it. Bytes read and bundle bytes are exact.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import zlib from "node:zlib";

type Metrics = Record<string, number>;
type Bundle = {
  generateMcap: () => Promise<Uint8Array>;
  cases: Record<string, (ctx: { mcap: Blob; measureHeap?: boolean }) => Promise<Metrics>>;
};
type Variant = "base" | "head";

/** Allowed head/base ratio per unit (the unit is the parenthesized suffix of a metric name) */
const BUDGETS: Record<string, number> = {
  ms: 1.1,
  "us/msg": 1.1,
  "us/op": 1.1,
  bytes: 1.01,
  heap: 1.1,
  "gzip bytes": 1.01,
};
/** Exit codes; ci.yml lets the perf-budget-accepted label accept only EXIT_OVER_BUDGET */
const EXIT_NOT_COMPARABLE = 2;
const EXIT_OVER_BUDGET = 3;
const ROUNDS = 10;
const HEAP_ROUNDS = 3;
/** Measured in a fresh process per run (see childMain) */
const HEAP_CASE = "mcap full pass";

const ROOT = path.join(import.meta.dirname, "..");
/** Files that define the benchmark; the base build uses this checkout's copy */
const BENCH_FILES = [
  "benchmark/src/perf",
  "benchmark/rspack.perf.config.ts",
  "benchmark/package.json",
];

const unitOf = (metric: string) => /\(([^)]+)\)$/.exec(metric)?.[1] ?? "";
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const gc = () => {
  (globalThis as { gc?: () => void }).gc?.();
};

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

async function run(cwd: string, cmd: string, args: string[]): Promise<void> {
  console.error(`[${path.basename(cwd)}] ${cmd} ${args.join(" ")}`);
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "inherit"] });
  const [code] = (await once(child, "exit")) as [number | null];
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${code}`);
  }
}

// The app loads WASM with fetch(); Node's fetch doesn't read file: URLs
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("file:")) {
    return new Response(await fs.promises.readFile(new URL(url)), {
      headers: { "content-type": url.endsWith(".wasm") ? "application/wasm" : "" },
    });
  }
  return await realFetch(input, init);
};

async function loadBundle(dir: string): Promise<Bundle> {
  return (await import(path.join(dir, "benchmark/.perf/cases.mjs"))) as Bundle;
}

/** Child process mode: one heap measurement in a fresh process */
async function childMain(dir: string, mcapPath: string): Promise<void> {
  const bundle = await loadBundle(dir);
  const mcap = await fs.openAsBlob(mcapPath);
  const heap = await bundle.cases[HEAP_CASE]!({ mcap, measureHeap: true });
  // maxRSS is in KiB
  heap["max RSS (heap)"] = process.resourceUsage().maxRSS * 1024;
  process.stdout.write(JSON.stringify(heap));
}

async function measureHeap(dir: string, mcapPath: string): Promise<Metrics> {
  const out = execFileSync(
    process.execPath,
    ["--expose-gc", import.meta.filename, "--child", dir, mcapPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(out) as Metrics;
}

/** JS the app loads before its first render, as listed by the web build (rspackConfigs.ts) */
function startupBytes(dir: string): Metrics {
  const out = path.join(dir, "web/.webpack");
  const list = path.join(out, "startup-js.json");
  // Bases from before the list existed (2026-11-23) have none, e.g. older branches or --base: no row
  if (!fs.existsSync(list)) {
    return {};
  }
  let raw = 0;
  let gzip = 0;
  for (const file of JSON.parse(fs.readFileSync(list, "utf8")) as string[]) {
    const data = fs.readFileSync(path.join(out, file));
    raw += data.length;
    gzip += zlib.gzipSync(data, { level: 9 }).length;
  }
  return { "startup JS (bytes)": raw, "startup JS (gzip bytes)": gzip };
}

async function prepareBase(baseDir: string, sha: string): Promise<void> {
  // Forget worktrees whose directory was deleted (e.g. a purged $TMPDIR), or `add` refuses the path
  execFileSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
  if (!fs.existsSync(baseDir)) {
    execFileSync("git", ["worktree", "add", "--detach", baseDir, sha], {
      cwd: ROOT,
      stdio: "ignore",
    });
  }
  execFileSync("git", ["checkout", "--force", "--detach", sha], { cwd: baseDir, stdio: "ignore" });
  for (const file of BENCH_FILES) {
    fs.rmSync(path.join(baseDir, file), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, file), path.join(baseDir, file), { recursive: true });
  }
  // Not frozen: the copied benchmark/package.json may need lockfile entries the base lacks
  await run(baseDir, "pnpm", ["install", "--no-frozen-lockfile", "--prefer-offline"]);
}

async function build(dir: string): Promise<void> {
  await run(dir, "pnpm", [
    "rspack",
    "build",
    "--mode",
    "production",
    "--config",
    "benchmark/rspack.perf.config.ts",
  ]);
  await run(dir, "pnpm", ["web:build:prod"]);
}

function fmt(value: number, unit: string): string {
  if (unit === "heap" || unit.endsWith("bytes")) {
    return value >= 1e6 ? `${(value / 1e6).toFixed(2)} MB` : `${(value / 1e3).toFixed(1)} kB`;
  }
  return value >= 100 ? value.toFixed(0) : value.toPrecision(3);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    // --no-build: reuse the builds of the previous run
    options: { base: { type: "string" }, "no-build": { type: "boolean" } },
  });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  const sha = git("rev-parse", values.base ?? git("merge-base", "HEAD", "origin/licht"));
  // Outside the repository, so the base resolves only its own node_modules (inside it, a dependency
  // the base lacks would silently resolve from this checkout's), and one directory per checkout
  const work = path.join(
    os.tmpdir(),
    `lichtblick-perf-budget-${createHash("sha256").update(ROOT).digest("hex").slice(0, 12)}`,
  );
  const baseDir = path.join(work, "base");
  fs.mkdirSync(work, { recursive: true });
  console.error(`Comparing ${git("rev-parse", "--short", "HEAD")} against base ${sha.slice(0, 9)}`);

  // CI has the memory to build all four at once; locally other work may be running
  const parallel = process.env.CI === "true";
  const skip = values["no-build"] === true;
  const revisions = path.join(work, "revisions");
  const expected = [git("rev-parse", "HEAD"), sha].join("\n");
  if (skip) {
    if (!fs.existsSync(revisions) || fs.readFileSync(revisions, "utf8") !== expected) {
      throw new Error("Run without --no-build to build these revisions first");
    }
  } else {
    fs.rmSync(revisions, { force: true });
  }
  const headBuild = skip ? Promise.resolve() : build(ROOT);
  if (!parallel) {
    await headBuild;
  }
  const baseBuild = (async () => {
    if (!skip) {
      await prepareBase(baseDir, sha);
      await build(baseDir);
    }
    await fs.promises.access(path.join(baseDir, "benchmark/.perf/cases.mjs"));
  })();
  await headBuild;
  // Cases that can't be compared (e.g. the PR changed an API they call). Nothing was measured for
  // them, so they fail and the label can't accept them: the cases must run on both builds
  const problems: string[] = [];
  // A run that compared nothing (failed base build) must fail, and the label can't change that
  const baseError = await baseBuild.then(
    () => undefined,
    (err: unknown) => String(err),
  );
  const baseOk = baseError == undefined;
  if (baseOk && !skip) {
    fs.writeFileSync(revisions, expected);
  }
  const variants: Variant[] = baseOk ? ["base", "head"] : ["head"];
  const dirs: Record<Variant, string> = { base: baseDir, head: ROOT };

  const bundles = {} as Record<Variant, Bundle>;
  for (const v of variants) {
    bundles[v] = await loadBundle(dirs[v]);
  }
  const mcapPath = path.join(work, "perf.mcap");
  fs.writeFileSync(mcapPath, await bundles.head.generateMcap());
  const mcap = await fs.openAsBlob(mcapPath);
  console.error(`Generated ${(mcap.size / 1e6).toFixed(0)} MB MCAP`);

  // samples[metric][variant] = one value per round
  const samples: Record<string, Partial<Record<Variant, number[]>>> = {};
  const caseOf: Record<string, string> = {};
  const record = (variant: Variant, name: string, metrics: Metrics) => {
    for (const [metric, value] of Object.entries(metrics)) {
      ((samples[metric] ??= {})[variant] ??= []).push(value);
      caseOf[metric] = name;
    }
  };

  // A case that throws on either build (e.g. the PR changed an API the cases call, so they no
  // longer fit the base) can't be compared: drop its samples and report it as a failure
  const broken = new Set<string>();
  const fail = (name: string, variant: Variant, err: unknown) => {
    broken.add(name);
    problems.push(`${name}: not comparable, throws on ${variant}: ${String(err)}`);
  };

  for (let round = 0; round <= ROUNDS; round++) {
    // Each case runs on both builds back to back, in random order, so a pair sees the same load
    const jobs = shuffle(Object.keys(bundles.head.cases)).flatMap((c) =>
      shuffle([...variants]).map((v) => [v, c] as const),
    );
    for (const [variant, name] of jobs) {
      const testCase = bundles[variant].cases[name];
      if (!testCase || broken.has(name)) {
        continue; // a case the base doesn't have
      }
      gc();
      try {
        const metrics = await testCase({ mcap });
        if (round > 0) {
          record(variant, name, metrics);
        }
      } catch (err) {
        fail(name, variant, err);
      }
    }
    console.error(`round ${round}/${ROUNDS} done`);
  }
  for (let round = 0; round < HEAP_ROUNDS && !broken.has(HEAP_CASE); round++) {
    for (const variant of shuffle([...variants])) {
      try {
        record(variant, HEAP_CASE, await measureHeap(dirs[variant], mcapPath));
      } catch (err) {
        fail(HEAP_CASE, variant, err);
      }
    }
  }
  for (const metric of Object.keys(samples)) {
    if (broken.has(caseOf[metric]!)) {
      delete samples[metric];
    }
  }
  for (const variant of variants) {
    record(variant, "startup bundle", startupBytes(dirs[variant]));
  }

  const rows = [
    "| Metric | Base | This PR | Change | Budget | |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];
  let failed = 0;
  for (const [metric, byVariant] of Object.entries(samples).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const unit = unitOf(metric);
    const budget = BUDGETS[unit];
    const { base, head } = byVariant;
    if (!base) {
      rows.push(`| ${metric} | – | ${fmt(median(head!), unit)} | | | new |`);
      continue;
    }
    if (!head) {
      rows.push(`| ${metric} | ${fmt(median(base), unit)} | – | | | removed |`);
      continue;
    }
    if (base.length !== head.length) {
      problems.push(`${metric}: not comparable, ${base.length} base vs ${head.length} PR samples`);
      continue;
    }
    const div = (h: number, b: number) => (b === 0 ? (h === 0 ? 1 : Infinity) : h / b);
    // Paired by round, so drift over the run (thermal, other jobs) cancels out. Load only ever
    // adds time, so a slower best run too is required before a time counts as a regression.
    const ratio = Math.min(
      median(head.map((h, i) => div(h, base[i]!))),
      div(Math.min(...head), Math.min(...base)),
    );
    const ok = budget == undefined || ratio <= budget;
    failed += ok ? 0 : 1;
    const change = `${ratio >= 1 ? "+" : ""}${((ratio - 1) * 100).toFixed(1)}%`;
    const allowed = budget == undefined ? "" : `+${((budget - 1) * 100).toFixed(0)}%`;
    rows.push(
      `| ${metric} | ${fmt(median(base), unit)} | ${fmt(median(head), unit)} | ${change} | ${allowed} | ${ok ? "✅" : "❌"} |`,
    );
  }

  const report = [
    `### Perf budget: ${git("rev-parse", "--short", "HEAD")} vs ${baseOk ? sha.slice(0, 9) : "(base build failed)"}`,
    "",
    `Change: the smaller of the median paired ratio and the best-run ratio over ${ROUNDS} shuffled in-process rounds (heap: ${HEAP_ROUNDS} fresh processes each). Lower is better.`,
    "",
    ...rows,
    "",
    ...problems.map((problem) => `- ❌ ${problem}`),
    ...(baseOk ? [] : [`- ❌ Base build failed, nothing was compared: ${baseError}`]),
    "",
    !baseOk
      ? "**Nothing was compared.** This fails regardless of labels; re-run once the base builds."
      : problems.length > 0
        ? `**${problems.length} case(s) not comparable.** This fails regardless of labels: make the cases in benchmark/src/perf/cases.ts run on both builds.`
        : failed > 0
          ? `**${failed} metric(s) over budget.** A deliberate trade-off can be accepted with the \`perf-budget-accepted\` PR label, then re-run this job.`
          : "All metrics within budget.",
    "",
  ].join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  // Only "over budget and nothing else" may be accepted by the label (ci.yml checks it then). A
  // failed base build, a case that isn't comparable or a crash (exit 1) never is.
  process.exitCode = !baseOk
    ? 1
    : problems.length > 0
      ? EXIT_NOT_COMPARABLE
      : failed > 0
        ? EXIT_OVER_BUDGET
        : 0;
}

if (process.argv[2] === "--child") {
  await childMain(process.argv[3]!, process.argv[4]!);
} else {
  await main();
}
