// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

ruleTester.run("no-map-type-argument", plugin.rules["no-map-type-argument"], {
  valid: [
    /* ts */ `
    [1, 2].map((x) => x + 1);
    [1, 2].map((x): number => x + 1);
    [1, 2].map<number>((x): number => x + 1);
    [1, 2].map<number, string>((x) => x + 1);
    `,
  ],

  invalid: [
    {
      code: /* ts */ `
        [1, 2].map<number>(x => x + 1);
        [1, 2].map<number>((x) => x + 1);
      `,
      errors: [
        { messageId: "preferReturnTypeAnnotation", line: 2 },
        { messageId: "preferReturnTypeAnnotation", line: 3 },
      ],
      output: /* ts */ `
        [1, 2].map((x): number => x + 1);
        [1, 2].map((x): number => x + 1);
      `,
    },
  ],
});
