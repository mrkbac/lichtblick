// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

const path = require("path");

const SUITE_BASE = "/packages/suite-base/src/";

/**
 * Heavy modules and the only places that may import them statically. Everywhere else they must be
 * loaded with `import()` (or imported with `import type`), so they stay out of the startup bundle.
 * The startup budget in packages/suite-web/src/rspackConfigs.ts catches what gets in transitively.
 *
 * `module` matches a package name, or a normalized path for @lichtblick/suite-base and relative
 * imports ("/packages/suite-base/src/…"). `allowIn` matches the importing file's path.
 */
const HEAVY_MODULES = [
  {
    name: "three",
    module: /^three(\/|$)/,
    allowIn: [
      /\/panels\/ThreeDeeRender\//,
      // loaded with import() only
      /\/components\/DataSourceDialog\/Snow\.tsx$/,
      // math classes only (Color, Quaternion, Euler), which tree-shake to a few KB
      /\/util\/(colorUtils|quatToEuler)\.ts$/,
    ],
  },
  {
    name: "maplibre",
    module: /^(maplibre-gl|pmtiles)(\/|$)/,
    // CatalogMap is loaded with import() only; the 3D panel draws map tiles
    allowIn: [/\/panels\/(Map|ThreeDeeRender)\//, /\/components\/Catalog\/CatalogMap\.tsx$/],
  },
  {
    name: "monaco",
    module: /^(monaco-editor|@monaco-editor\/|react-monaco-editor)/,
    allowIn: [/\/panels\/(UserScriptEditor|Notes)\//],
  },
  {
    name: "the 3D renderer",
    module: /\/panels\/ThreeDeeRender\/(Renderer|ThreeDeeRender|SceneExtension)(\.tsx?)?$/,
    allowIn: [/\/panels\/ThreeDeeRender\//],
  },
  {
    name: "the Map panel",
    module: /\/panels\/Map\/(MapPanel|maplibre)(\.tsx?)?$/,
    allowIn: [/\/panels\/Map\//],
  },
  {
    name: "the script editor",
    module: /\/panels\/UserScriptEditor\/(Editor|MonacoEditor)(\.tsx?)?$/,
    allowIn: [/\/panels\/(UserScriptEditor|Notes)\//],
  },
  {
    name: "a player implementation",
    module:
      /\/players\/(Ros1Player|RosbridgePlayer|VelodynePlayer|FoxgloveWebSocketPlayer)(\/|\.tsx?$|$)/,
    allowIn: [/\/suite-base\/src\/(players|dataSources)\//],
  },
];

// Tests, stories and test helpers never reach the app bundle
const EXEMPT_FILE = /\.(test|stories)\.tsx?$|\/(testing|test|stories)\//;

/** Map an import source to the form HEAVY_MODULES matches against. */
function normalizeSource(source, filename) {
  if (source.startsWith(".")) {
    return path.resolve(path.dirname(filename), source).split(path.sep).join("/");
  }
  if (source.startsWith("@lichtblick/suite-base/")) {
    return SUITE_BASE + source.slice("@lichtblick/suite-base/".length);
  }
  return source;
}

/** True for `import type …` and `import { type A, type B } …` */
function isTypeOnly(node) {
  if (node.importKind === "type" || node.exportKind === "type") {
    return true;
  }
  const specifiers = node.specifiers ?? [];
  return (
    specifiers.length > 0 &&
    specifiers.every(
      (specifier) => specifier.importKind === "type" || specifier.exportKind === "type",
    )
  );
}

/**
 * Forbid static imports of heavy libraries, panels and players outside the code that owns them.
 * @type {import("eslint").Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: "problem",
    messages: {
      heavyImport:
        "Static import of {{name}} ({{source}}) outside the code that owns it pulls it into every bundle that imports this file. Load it with import(), use `import type`, or move the shared part into a light module.",
    },
  },
  create: (context) => {
    const filename = context.filename.split(path.sep).join("/");
    if (EXEMPT_FILE.test(filename)) {
      return {};
    }
    const check = (node) => {
      if (!node.source || typeof node.source.value !== "string" || isTypeOnly(node)) {
        return;
      }
      const normalized = normalizeSource(node.source.value, filename);
      for (const heavy of HEAVY_MODULES) {
        if (heavy.module.test(normalized) && !heavy.allowIn.some((re) => re.test(filename))) {
          context.report({
            node,
            messageId: "heavyImport",
            data: { name: heavy.name, source: node.source.value },
          });
          return;
        }
      }
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};
