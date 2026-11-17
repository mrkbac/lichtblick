// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";
import type { TabConfig } from "@lichtblick/suite-base/util/tabLayout";

export const ARRANGEMENTS = ["vertical", "horizontal", "grid"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

/** `tabs` are the items, each a layout; the name is shared with the Tab panel's plumbing. */
export type StackPanelConfig = {
  arrangement: Arrangement;
  size: number;
  columns: number;
  tabs: TabConfig[];
};

export const MIN_ITEM_SIZE = 80;

export const DEFAULT_STACK_CONFIG: StackPanelConfig = {
  arrangement: "vertical",
  size: 300,
  columns: 2,
  tabs: [],
};

/** Config values within range (configs come from saved files). */
export function normalizeStackConfig(
  config: Partial<StackPanelConfig>,
): Omit<StackPanelConfig, "tabs"> {
  const arrangement = ARRANGEMENTS.includes(config.arrangement!)
    ? config.arrangement!
    : DEFAULT_STACK_CONFIG.arrangement;
  const size =
    typeof config.size === "number" && config.size >= MIN_ITEM_SIZE
      ? config.size
      : DEFAULT_STACK_CONFIG.size;
  const columns =
    typeof config.columns === "number" && config.columns >= 1
      ? Math.floor(config.columns)
      : DEFAULT_STACK_CONFIG.columns;
  return { arrangement, size, columns };
}

export function buildSettingsTree(
  config: Omit<StackPanelConfig, "tabs">,
  t: TFunction<"stack">,
): DocumentedNodes {
  return {
    general: {
      label: t("general"),
      fields: {
        arrangement: {
          label: t("arrangement"),
          help: t("arrangementHelp"),
          input: "toggle",
          value: config.arrangement,
          options: ARRANGEMENTS.map((value) => ({ label: t(value), value })),
        },
        size: {
          label: t("size"),
          help: t("sizeHelp"),
          input: "number",
          min: MIN_ITEM_SIZE,
          step: 10,
          value: config.size,
        },
        columns:
          config.arrangement === "grid"
            ? {
                label: t("columns"),
                help: t("columnsHelp"),
                input: "number",
                min: 1,
                max: 12,
                step: 1,
                value: config.columns,
              }
            : undefined,
      },
    },
  };
}
