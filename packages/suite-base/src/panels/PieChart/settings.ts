// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SUPPORTED_DATA_TYPES } from "./constants";
import type { PieChartConfig } from "./types";
import type { DocumentedFields, DocumentedNodes } from "../shared/documentedSettings";

export function buildSettingsTree(
  config: PieChartConfig,
  legendCount: number,
  pathParseError?: string,
  error?: string,
): DocumentedNodes {
  const fields: DocumentedFields = {
    legendControls: {
      label: "Legend controls",
      input: "legendcontrols",
      help: "Adds or removes legend name fields.",
    },
    path: {
      label: "Message path",
      input: "messagepath",
      supportsMathModifiers: true,
      value: config.path,
      error: pathParseError,
      validTypes: SUPPORTED_DATA_TYPES,
      help: "The numeric array field to chart; each element becomes one slice.",
    },
    title: {
      label: "Title",
      input: "string",
      value: config.title,
      help: "Shown above the chart.",
    },
  };

  for (let i = 1; i <= legendCount; i++) {
    const key = `legend${i}` as const;
    fields[key] = {
      label: `Legend ${i}`,
      input: "string",
      value: config[key] ?? "",
      help: `Name of slice ${i}; empty shows "Data ${i}".`,
    };
  }

  return { general: { error, fields } };
}
