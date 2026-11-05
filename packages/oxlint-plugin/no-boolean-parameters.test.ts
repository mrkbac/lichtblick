// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-boolean-parameters", plugin.rules["no-boolean-parameters"], {
  valid: [
    "function f(x: number, y: string | undefined): void {}",
    "function f({ flag }: { flag: boolean }): void {}",
    "const f = (x = 1) => x;",
    "function f(x: boolean | number): void {}",
    { code: "function f(x: boolean): void {}", options: [{ allowLoneParameter: true }] },
  ],
  invalid: [
    { code: "function f(x: boolean): void {}", errors: 1 },
    { code: "function f(x?: true | undefined | null): void {}", errors: 1 },
    { code: "const f = (a: number, b = false) => a;", errors: 1 },
    { code: "type F = (x: boolean) => void;", errors: 1 },
    { code: "class A { public m(x: false): void {} }", errors: 1 },
  ],
});
