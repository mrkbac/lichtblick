// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-return-promise-resolve", plugin.rules["no-return-promise-resolve"], {
  valid: [
    "async function f() { return 1; }",
    "function f() { return Promise.resolve(1); }",
    "async function f() { return () => Promise.resolve(1); }",
  ],
  invalid: [
    {
      code: "async function f() { return Promise.resolve(1); }",
      errors: [{ messageId: "returnResolve" }],
      output: "async function f() { return 1; }",
    },
    {
      code: "async function f() { return Promise.resolve(); }",
      errors: [{ messageId: "returnResolve" }],
      output: "async function f() { return undefined; }",
    },
    {
      code: "async function f() { return Promise.reject(new Error()); }",
      errors: [{ messageId: "returnReject" }],
      output: "async function f() { throw new Error(); }",
    },
    {
      code: "async function f() { return Promise.reject(); }",
      errors: [{ messageId: "returnReject" }],
      output: "async function f() { throw undefined; }",
    },
    {
      code: "const f = async () => Promise.reject();",
      errors: [{ messageId: "returnReject" }],
      output: "const f = async () => { throw undefined; };",
    },
    {
      // A throw here would be caught by the catch block, so no autofix.
      code: "async function f() { try { return Promise.reject(1); } catch { return 2; } }",
      errors: [{ messageId: "returnReject" }],
      output: null,
    },
    {
      code: "async function f() { try { return Promise.resolve(1); } catch { return 2; } }",
      errors: [{ messageId: "returnResolve" }],
      output: "async function f() { try { return 1; } catch { return 2; } }",
    },
  ],
});
