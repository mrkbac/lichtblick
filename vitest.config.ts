// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import fs from "node:fs";
import path from "node:path";
import { Plugin } from "vite";
import { defineConfig, defineProject } from "vitest/config";
import type { InlineConfig } from "vitest/node";

// nearley's compiler internals ship without types or ESM entry points
/* eslint-disable @typescript-eslint/no-require-imports */
const nearley = require("nearley") as typeof import("nearley");
const nearleyCompile = require("nearley/lib/compile") as (
  ast: unknown,
  opts: object,
) => { config: Record<string, string> };
const nearleyGenerate = require("nearley/lib/generate") as (info: unknown, name: string) => string;
const nearleyGrammar =
  require("nearley/lib/nearley-language-bootstrapped") as import("nearley").CompiledRules;
/* eslint-enable @typescript-eslint/no-require-imports */

const root = __dirname;
const suiteBaseSrc = path.join(root, "packages/suite-base/src");
const suiteBaseSetup = path.join(suiteBaseSrc, "test/setup.ts");
// Real globals (not compile-time defines) so tests can override them, as with jest's `globals`
const testGlobals = path.join(suiteBaseSrc, "test/globals.ts");

/** Compiles .ne grammars (like nearley-loader) and exposes .bin/.template/.wasm files as strings. */
function testAssets(): Plugin {
  return {
    name: "lichtblick-test-assets",
    enforce: "pre",
    load(id) {
      if (/\.(bin|template|wasm)$/.test(id)) {
        return `export default ${JSON.stringify(fs.readFileSync(id, "utf8"))};`;
      }
      if (id.endsWith(".ne")) {
        const parser = new nearley.Parser(nearley.Grammar.fromCompiled(nearleyGrammar));
        parser.feed(fs.readFileSync(id, "utf8"));
        const info = nearleyCompile(parser.results[0], {});
        info.config.preprocessor = "esmodule";
        return nearleyGenerate(info, "grammar");
      }
      return undefined;
    },
  };
}

const suiteBaseAlias = [
  { find: /^.*\.svg$/, replacement: path.join(suiteBaseSrc, "test/mocks/MockSvg.tsx") },
  { find: /^.*\.(glb|md|png)$/, replacement: path.join(suiteBaseSrc, "test/mocks/fileMock.ts") },
  // build config modules live at the package root, everything else in src/
  {
    find: /^@lichtblick\/suite-base\/(rspack|RspackArgv)$/,
    replacement: path.join(root, "packages/suite-base/$1.ts"),
  },
  { find: /^@lichtblick\/suite-base\/(?:src\/)?(.*)$/, replacement: `${suiteBaseSrc}/$1` },
];

const project = (name: string, test: InlineConfig) =>
  defineProject({
    plugins: [testAssets()],
    resolve: { alias: suiteBaseAlias },
    test: {
      name,
      globals: true,
      environment: "node",
      // jest's jsdom URL; vitest defaults to http://localhost:3000
      environmentOptions: { jsdom: { url: "http://localhost/" } },
      ...test,
      setupFiles: [testGlobals, ...[test.setupFiles ?? []].flat()],
    },
  });

export default defineConfig({
  test: {
    // Like jest: a test file's afterEach runs before the shared ones from setup files
    sequence: { hooks: "stack" },
    // lcov.info for coverage tooling
    coverage: { provider: "v8", reporter: ["text-summary", "lcov"], reportsDirectory: "coverage" },
    // Unit tests run in UTC so time formatting doesn't depend on the machine's timezone
    env: { TZ: "UTC" },
    projects: [
      project("suite-base", {
        root: "packages/suite-base",
        include: ["src/**/*.test.{ts,tsx}"],
        setupFiles: [
          suiteBaseSetup,
          "vitest-canvas-mock",
          "fake-indexeddb/auto",
          path.join(suiteBaseSrc, "test/setupTestFramework.ts"),
        ],
        restoreMocks: true,
      }),
      project("suite-web", {
        root: "packages/suite-web",
        include: ["src/**/*.test.{ts,tsx}"],
        setupFiles: [suiteBaseSetup],
        restoreMocks: true,
      }),
      project("suite-desktop", {
        root: "packages/suite-desktop",
        include: ["src/**/*.test.{ts,tsx}"],
        setupFiles: ["src/test/setup.ts"],
      }),
      project("hooks", {
        root: "packages/hooks",
        include: ["src/**/*.test.{ts,tsx}"],
      }),
      ...["den", "oxlint-plugin"].map((name) =>
        project(name, { root: `packages/${name}`, include: ["**/*.test.{ts,tsx}"] }),
      ),
      ...["mcap-support", "message-path"].map((name) =>
        project(name, { root: `packages/${name}`, include: ["src/**/*.test.{ts,tsx}"] }),
      ),
      project("benchmark", {
        root: "benchmark",
        include: ["**/*.test.{ts,tsx}"],
        exclude: ["e2e/**", "node_modules/**"],
        setupFiles: [suiteBaseSetup],
        restoreMocks: true,
      }),
      project("ci", { root: "ci", include: ["**/*.test.{ts,tsx}"] }),
      project("desktop", {
        root: "desktop",
        include: ["**/*.test.{ts,tsx}"],
        exclude: ["**/integration-test/**", "node_modules/**"],
      }),
    ],
  },
});
