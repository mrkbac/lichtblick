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

ruleTester.run("lodash-ramda-imports", plugin.rules["lodash-ramda-imports"], {
  valid: [
    /* ts */ `
    import * as _ from "lodash-es";
    _.isEqual(1, 1);
    import * as R from "ramda";
    R.equals(1, 1);
    `,
  ],

  invalid: [
    {
      code: /* ts */ `
        import * as _ from "lodash";
        _.isEqual(1, 1);
      `,
      errors: [
        { messageId: "useDifferentPackage", data: { package: "lodash-es", convertFrom: "lodash" } },
      ],
      output: /* ts */ `
        import * as _ from "lodash-es";
        _.isEqual(1, 1);
      `,
    },

    {
      code: /* ts */ `
        import _ from "lodash-es";
        _.isEqual(1, 1);
      `,
      errors: [{ messageId: "useNamespaceImport", data: { name: "_", package: "lodash-es" } }],
      output: /* ts */ `
        import * as _ from "lodash-es";
        _.isEqual(1, 1);
      `,
    },

    {
      code: /* ts */ `
        import _, { isEmpty } from "lodash-es";
        _.isEqual(1, 1);
        isEmpty({});
      `,
      errors: [{ messageId: "useNamespaceImport", data: { name: "_", package: "lodash-es" } }],
      output: /* ts */ `
        import * as _ from "lodash-es";
        _.isEqual(1, 1);
        _.isEmpty({});
      `,
    },

    {
      code: /* ts */ `
        import lodash, { isEmpty as lodashIsEmpty } from "lodash-es";
        lodash.isEqual(1, 1);
        lodashIsEmpty({});
      `,
      errors: [{ messageId: "useNamespaceImport", data: { name: "_", package: "lodash-es" } }],
      output: /* ts */ `
        import * as _ from "lodash-es";
        _.isEqual(1, 1);
        _.isEmpty({});
      `,
    },

    {
      code: /* ts */ `
        import ramda, { isEmpty as ramdaIsEmpty } from "ramda";
        ramda.equals(1, 1);
        ramdaIsEmpty({});
      `,
      errors: [{ messageId: "useNamespaceImport", data: { name: "R", package: "ramda" } }],
      output: /* ts */ `
        import * as R from "ramda";
        R.equals(1, 1);
        R.isEmpty({});
      `,
    },
  ],
});
