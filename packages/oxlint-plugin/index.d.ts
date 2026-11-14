// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

type RuleName =
  | "license-header"
  | "link-target"
  | "lodash-ramda-imports"
  | "no-boolean-parameters"
  | "no-getters-setters"
  | "no-object-url"
  | "no-push-spread"
  | "no-return-promise-resolve"
  | "ramda-usage"
  | "strict-equality";

declare const plugin: { meta: { name: string }; rules: Record<RuleName, Rule> };
export = plugin;
