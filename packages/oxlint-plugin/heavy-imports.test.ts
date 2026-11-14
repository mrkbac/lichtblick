// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const SHARED = "/repo/packages/suite-base/src/components/Foo.tsx";
const PANEL = "/repo/packages/suite-base/src/panels/ThreeDeeRender/Foo.ts";
const errors = [{ messageId: "heavyImport" }];

ruleTester.run("heavy-imports", plugin.rules["heavy-imports"], {
  valid: [
    { filename: PANEL, code: `import * as THREE from "three";` },
    { filename: PANEL, code: `import { Renderer } from "./Renderer";` },
    {
      filename: SHARED,
      code: `import type { Renderer } from "../panels/ThreeDeeRender/Renderer";`,
    },
    { filename: SHARED, code: `import { type Vector3 } from "three";` },
    { filename: SHARED, code: `const m = await import("maplibre-gl");` },
    {
      filename: SHARED,
      code: `import { DEFAULT_CAMERA_STATE } from "@lichtblick/suite-base/panels/ThreeDeeRender/defaults";`,
    },
    { filename: "/repo/packages/suite-base/src/components/Foo.test.tsx", code: `import "three";` },
    {
      filename: "/repo/packages/suite-base/src/dataSources/Ros1SocketDataSourceFactory.ts",
      code: `import Ros1Player from "@lichtblick/suite-base/players/Ros1Player";`,
    },
  ],
  invalid: [
    { filename: SHARED, code: `import * as THREE from "three";`, errors },
    {
      filename: SHARED,
      code: `import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";`,
      errors,
    },
    { filename: SHARED, code: `import { Map } from "maplibre-gl";`, errors },
    { filename: SHARED, code: `import * as monaco from "monaco-editor";`, errors },
    {
      filename: SHARED,
      code: `import { Renderer } from "../panels/ThreeDeeRender/Renderer";`,
      errors,
    },
    {
      filename: "/repo/packages/suite-base/src/panels/Plot/Foo.ts",
      code: `export { ThreeDeeRender } from "@lichtblick/suite-base/panels/ThreeDeeRender/ThreeDeeRender";`,
      errors,
    },
    {
      filename: SHARED,
      code: `import Ros1Player from "@lichtblick/suite-base/players/Ros1Player";`,
      errors,
    },
  ],
});
