// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { DiagnosticStatusConfig } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import type { DiagnosticTopics } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticTopics";
import {
  buildTopicsSettingsNode,
  staleTimeoutField,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/buildSettingsTree";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

export function buildStatusPanelSettingsTree(
  config: DiagnosticStatusConfig,
  topics: DiagnosticTopics,
  t: TFunction<"diagnostics">,
): DocumentedNodes {
  return {
    general: {
      label: t("general"),
      fields: {
        numericPrecision: {
          label: t("numericPrecision"),
          help: t("numericPrecisionHelp"),
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
