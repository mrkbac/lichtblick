// SPDX-License-Identifier: MPL-2.0

import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

type RuleName =
  | "heavy-imports"
  | "license-header"
  | "link-target"
  | "lodash-imports"
  | "no-boolean-parameters"
  | "no-getters-setters"
  | "no-object-url"
  | "no-push-spread"
  | "no-return-promise-resolve"
  | "strict-equality";

declare const plugin: { meta: { name: string }; rules: Record<RuleName, Rule> };
export = plugin;
