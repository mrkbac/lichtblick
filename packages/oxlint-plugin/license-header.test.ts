// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const year = new Date().getFullYear();
const header = `// SPDX-FileCopyrightText: Copyright (C) 2023-${year} Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>\n// SPDX-License-Identifier: MPL-2.0`;
const options = [{ licenseType: "MPL-2.0" }];

ruleTester.run("license-header", plugin.rules["license-header"], {
  valid: [
    { code: `${header}\n\nexport {};\n`, options },
    { code: `/** @vitest-environment jsdom */\n${header}\n\nexport {};\n`, options },
  ],
  invalid: [
    {
      code: "/** @vitest-environment jsdom */\n",
      options,
      errors: [{ messageId: "wrongHeaderError" }],
      output: `/** @vitest-environment jsdom */\n${header}`,
    },
    {
      code: `${header.replace(`2023-${year}`, "2023-2000")}\n\nexport {};\n`,
      options,
      errors: [{ messageId: "wrongHeaderError" }],
      output: `${header}\n\nexport {};\n`,
    },
    {
      code: `export {};\n`,
      options,
      errors: [{ messageId: "prefixLinesError" }],
      output: `${header}\n\nexport {};\n`,
    },
  ],
});
