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

ruleTester.run("ramda-usage", plugin.rules["ramda-usage"], {
  valid: [
    {
      code: /* ts */ `
    import * as R from "ramda";
    R.max(1)(2);
    R.max;
    R.keys;
    R.values;
    R.map((x) => x + 1);
    R.map((x) => x + 1, {a: 1, b: 2});
    R.all((x) => x === 1);
    R.any((x) => x === 1);
    `,
    },
  ],

  invalid: [
    {
      code: /* ts */ `
        import * as R from "ramda";
        R.min(1, 2);
        R.max(1, 2);
      `,
      errors: [
        { messageId: "useMath", data: { name: "min" }, line: 3 },
        { messageId: "useMath", data: { name: "max" }, line: 4 },
      ],
      output: /* ts */ `
        import * as R from "ramda";
        Math.min(1, 2);
        Math.max(1, 2);
      `,
    },

    {
      code: /* ts */ `
        import * as R from "ramda";
        R.keys({a: 1, b: 2});
        R.values({a: 1, b: 2});
      `,
      errors: [
        { messageId: "useObject", data: { name: "keys" }, line: 3 },
        { messageId: "useObject", data: { name: "values" }, line: 4 },
      ],
      output: /* ts */ `
        import * as R from "ramda";
        Object.keys({a: 1, b: 2});
        Object.values({a: 1, b: 2});
      `,
    },

    {
      code: /* ts */ `
        import * as R from "ramda";
        R.map((x) => x + 1, [1, 2]);
        R.map((x) => x + 1, [1] as const);
        foo("bar", R.map((x) => x + 1, [1]));
      `,
      errors: [
        { messageId: "useArrayMethod", line: 3, data: { arrayName: "map", ramdaName: "map" } },
        { messageId: "useArrayMethod", line: 4, data: { arrayName: "map", ramdaName: "map" } },
        { messageId: "useArrayMethod", line: 5, data: { arrayName: "map", ramdaName: "map" } },
      ],
      output: /* ts */ `
        import * as R from "ramda";
        ([1, 2]).map((x) => x + 1);
        ([1] as const).map((x) => x + 1);
        foo("bar", ([1]).map((x) => x + 1));
      `,
    },

    {
      code: /* ts */ `
        import * as R from "ramda";
        R.find((x) => x === 1, [1, 2]);
        R.find((x) => x === 1, [1] as const);
        foo("bar", R.find((x) => x === 1, [1]));
      `,
      errors: [
        { messageId: "useArrayMethod", line: 3, data: { arrayName: "find", ramdaName: "find" } },
        { messageId: "useArrayMethod", line: 4, data: { arrayName: "find", ramdaName: "find" } },
        { messageId: "useArrayMethod", line: 5, data: { arrayName: "find", ramdaName: "find" } },
      ],
      output: /* ts */ `
        import * as R from "ramda";
        ([1, 2]).find((x) => x === 1);
        ([1] as const).find((x) => x === 1);
        foo("bar", ([1]).find((x) => x === 1));
      `,
    },

    {
      code: /* ts */ `
        import * as R from "ramda";
        R.all((x) => x === 1, [1, 2]);
        R.all((x) => x === 1, [1] as const);
        R.any((x) => x === 1, [1, 2]);
        R.any((x) => x === 1, [1] as const);
        foo("bar", R.all((x) => x === 1, [1]));
        foo("bar", R.any((x) => x === 1, [1]));
      `,
      errors: [
        { messageId: "useArrayMethod", line: 3, data: { ramdaName: "all", arrayName: "every" } },
        { messageId: "useArrayMethod", line: 4, data: { ramdaName: "all", arrayName: "every" } },
        { messageId: "useArrayMethod", line: 5, data: { ramdaName: "any", arrayName: "some" } },
        { messageId: "useArrayMethod", line: 6, data: { ramdaName: "any", arrayName: "some" } },
        { messageId: "useArrayMethod", line: 7, data: { ramdaName: "all", arrayName: "every" } },
        { messageId: "useArrayMethod", line: 8, data: { ramdaName: "any", arrayName: "some" } },
      ],
      output: /* ts */ `
        import * as R from "ramda";
        ([1, 2]).every((x) => x === 1);
        ([1] as const).every((x) => x === 1);
        ([1, 2]).some((x) => x === 1);
        ([1] as const).some((x) => x === 1);
        foo("bar", ([1]).every((x) => x === 1));
        foo("bar", ([1]).some((x) => x === 1));
      `,
    },
  ],
});
