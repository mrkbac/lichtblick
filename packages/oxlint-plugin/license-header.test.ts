// SPDX-License-Identifier: MPL-2.0

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "./index";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

const header = "// SPDX-License-Identifier: MPL-2.0";
// Upstream notice that existing files keep (MPL-2.0 §3.4); the rule must accept it unchanged.
const upstreamHeader = `// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>\n${header}`;

ruleTester.run("license-header", plugin.rules["license-header"], {
  valid: [
    { code: `${header}\n\nexport {};\n` },
    { code: `${upstreamHeader}\n\nexport {};\n` },
    { code: `/** @vitest-environment jsdom */\n${header}\n\nexport {};\n` },
    { code: `/** @vitest-environment jsdom */\n${upstreamHeader}\n\nexport {};\n` },
  ],
  invalid: [
    {
      code: "/** @vitest-environment jsdom */\n",
      errors: [{ messageId: "wrongHeaderError" }],
      output: `/** @vitest-environment jsdom */\n${header}`,
    },
    {
      code: `${upstreamHeader.replace("MPL-2.0", "MIT")}\n\nexport {};\n`,
      errors: [{ messageId: "wrongHeaderError" }],
      output: `${upstreamHeader}\n\nexport {};\n`,
    },
    {
      code: `// SPDX-License-Identifier: MIT\n\nexport {};\n`,
      errors: [{ messageId: "wrongHeaderError" }],
      output: `${header}\n\nexport {};\n`,
    },
    {
      code: `export {};\n`,
      errors: [{ messageId: "prefixLinesError" }],
      output: `${header}\n\nexport {};\n`,
    },
    {
      code: `export {};\n${upstreamHeader}\n`,
      errors: [{ messageId: "prefixLinesError" }],
      output: `${upstreamHeader}\n\nexport {};\n\n`,
    },
  ],
});
