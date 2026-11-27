// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-crypto-random-uuid", plugin.rules["no-crypto-random-uuid"], {
  valid: ["randomUUID();", "crypto.getRandomValues(bytes);"],
  invalid: [
    { code: "const id = crypto.randomUUID();", errors: [{ messageId: "randomUUID" }] },
    { code: "const id = globalThis.crypto.randomUUID();", errors: [{ messageId: "randomUUID" }] },
    { code: "const id = window.crypto.randomUUID();", errors: [{ messageId: "randomUUID" }] },
  ],
});
