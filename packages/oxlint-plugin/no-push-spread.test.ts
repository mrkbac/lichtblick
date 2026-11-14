// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-push-spread", plugin.rules["no-push-spread"], {
  valid: ["arr.push(a, b);", "pushAll(arr, items);", "const c = [...a, ...b];", "f(...args);"],
  invalid: [
    { code: "arr.push(...items);", errors: [{ messageId: "spread" }] },
    { code: "this.#x.full.push(a, ...items);", errors: [{ messageId: "spread" }] },
  ],
});
