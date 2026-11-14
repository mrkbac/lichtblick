// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import fs from "node:fs";
import path from "node:path";

import packageJson from "../package.json";

// package.json `sideEffects` lets the bundler drop modules whose exports are unused (e.g. the ROS 1
// and Velodyne data sources in the web build). A module that does work at import time (registers a
// schema, patches a global, sets a worker URL) and is not listed there may be silently dropped, or
// skipped when one of its re-exports is used. This finds modules with top-level statements and
// requires each to be listed.

const SRC = import.meta.dirname;

// Top-level statements that only decorate the module's own exports: harmless to drop with it.
const PURE_STATEMENT = /^\w+\.(displayName|panelType|defaultConfig)\s*=/;
// A line at column 0 that starts an expression statement (call, assignment, loop, branch).
const STATEMENT =
  /^(?!(export|import|const|let|var|function|async|class|type|interface|enum|declare|abstract|default)\b)([A-Za-z_$][\w$.]*\s*(\(|\.|\?\?=|=|\[)|for\s*\(|if\s*\()/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test" && entry.name !== "stories") {
        yield* sourceFiles(full);
      }
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories|d|worker)\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

describe("package.json sideEffects", () => {
  it("lists every module that does work at import time", () => {
    const listed = new Set(packageJson.sideEffects);
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const hasSideEffects = lines.some(
        (line) => STATEMENT.test(line) && !PURE_STATEMENT.test(line),
      );
      const entry = `./src/${path.relative(SRC, file).split(path.sep).join("/")}`;
      if (hasSideEffects && !listed.has(entry)) {
        missing.push(entry);
      }
    }
    expect(missing).toEqual([]);
  });
});
