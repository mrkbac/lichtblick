// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Guards extension compatibility: `@lichtblick/suite` must stay identical to the upstream
// `@lichtblick/suite` release (no fork-only API), and what we hand extensions at runtime must
// implement the whole stable `@foxglove/extension` API so Foxglove-built extensions work too. To follow a new upstream release, bump the
// `@lichtblick/suite-upstream` / `@foxglove/extension` devDependencies and fix what this reports.

import type * as Foxglove from "@foxglove/extension";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expectTypeOf } from "vitest";

import type { PanelExtensionContext, RenderState } from "@lichtblick/suite";
import type { ExtensionRenderState } from "@lichtblick/suite-base/components/PanelExtensionAdapter/renderState";
import type { ExtensionPanelContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter/types";

const require = createRequire(import.meta.url);
const srcDir = (pkg: string) =>
  path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "src");

/** Code lines without comments or indentation, so only the API shape is compared (as a line diff). */
const normalize = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "")
    // We use the maintained @foxglove fork of the same package; the types are identical.
    .replaceAll("@lichtblick/message-definition", "@foxglove/message-definition")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const ours = srcDir("@lichtblick/suite");
const upstream = srcDir("@lichtblick/suite-upstream");
const sourceFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => !f.includes(".test."))
    .sort();

describe("extension API compatibility", () => {
  it("@lichtblick/suite has the same files as the upstream release", () => {
    expect(sourceFiles(ours)).toEqual(sourceFiles(upstream));
  });

  // Fails on any added, removed or changed API. Internal-only fields belong in suite-base types.
  it.each(sourceFiles(upstream))("@lichtblick/suite %s matches the upstream release", (file) => {
    expect(normalize(readFileSync(path.join(ours, file), "utf8"))).toEqual(
      normalize(readFileSync(path.join(upstream, file), "utf8")),
    );
  });

  it("hands extensions objects that implement the whole @foxglove/extension API", () => {
    // Type-only. The runtime objects are typed with these intersections, so tsc already fails when
    // our implementation misses or narrows any Foxglove member; this pins that they stay that way.
    expectTypeOf<ExtensionPanelContext>().toExtend<Foxglove.PanelExtensionContext>();
    expectTypeOf<ExtensionPanelContext>().toExtend<PanelExtensionContext>();
    expectTypeOf<ExtensionRenderState>().toExtend<Foxglove.RenderState>();
    expectTypeOf<ExtensionRenderState>().toExtend<RenderState>();
  });
});
