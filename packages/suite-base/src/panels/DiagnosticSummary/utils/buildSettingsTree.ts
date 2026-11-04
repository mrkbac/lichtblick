// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TFunction } from "i18next";

import { SettingsTreeFields, SettingsTreeNodes } from "@lichtblick/suite";
import { DEFAULT_SECONDS_UNTIL_STALE } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import {
  buildTopicsSettingsNode,
  DiagnosticTopics,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticTopics";
import { DiagnosticSummaryConfig } from "@lichtblick/suite-base/panels/DiagnosticSummary/types";

export function staleTimeoutField(
  value: number | undefined,
  t: TFunction<"diagnostics">,
): SettingsTreeFields[string] {
  return {
    label: t("staleTimeout"),
    help: t("staleTimeoutHelp"),
    input: "number",
    placeholder: t("staleTimeoutPlaceholder", { seconds: DEFAULT_SECONDS_UNTIL_STALE }),
    min: 0,
    step: 1,
    precision: 0,
    value,
  };
}

export function buildSettingsTree(
  config: DiagnosticSummaryConfig,
  topics: DiagnosticTopics,
  t: TFunction<"diagnostics">,
): SettingsTreeNodes {
  return {
    general: {
      label: t("general"),
      fields: {
        sortByLevel: { label: t("sortByLevel"), input: "boolean", value: config.sortByLevel },
        showHistory: {
          label: t("showHistory"),
          help: t("showHistoryHelp"),
          input: "boolean",
          value: config.showHistory ?? true,
        },
        secondsUntilStale: staleTimeoutField(config.secondsUntilStale, t),
      },
    },
    topics: buildTopicsSettingsNode(topics, t),
  };
}
