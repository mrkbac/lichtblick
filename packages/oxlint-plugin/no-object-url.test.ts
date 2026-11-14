// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-object-url", plugin.rules["no-object-url"], {
  valid: ["URL.revokeObjectURL(url);", "new URL(path, base);", "const f = URL.createObjectURL;"],
  invalid: [
    { code: "const url = URL.createObjectURL(blob);", errors: [{ messageId: "objectUrl" }] },
    { code: "const url = window.URL.createObjectURL(blob);", errors: [{ messageId: "objectUrl" }] },
  ],
});
