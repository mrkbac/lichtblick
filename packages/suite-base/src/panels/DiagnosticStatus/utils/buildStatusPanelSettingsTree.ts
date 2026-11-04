// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { SettingsTreeNodes } from "@lichtblick/suite";
import { DiagnosticStatusConfig } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import {
  buildTopicsSettingsNode,
  DiagnosticTopics,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticTopics";
import { staleTimeoutField } from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/buildSettingsTree";

export function buildStatusPanelSettingsTree(
  config: DiagnosticStatusConfig,
  topics: DiagnosticTopics,
  t: TFunction<"diagnostics">,
): SettingsTreeNodes {
  return {
    general: {
      label: t("general"),
      fields: {
        numericPrecision: {
          label: t("numericPrecision"),
          input: "number",
          min: 0,
          max: 17,
          precision: 0,
          step: 1,
          placeholder: t("numericPrecisionPlaceholder"),
          value: config.numericPrecision,
        },
        secondsUntilStale: staleTimeoutField(config.secondsUntilStale, t),
      },
    },
    topics: buildTopicsSettingsNode(topics, t),
  };
}
