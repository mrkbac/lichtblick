// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DATA_TYPES } from "@lichtblick/suite-base/panels/Gauge/constants";
import type { DocumentedNode } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { ColorMapConfig, ColorModeConfig, SettingsTreeNodesProps } from "./types";

/** Shows the controls for the selected display and reports invalid inclinometer thresholds. */
export function buildSettingsTree(
  { config, pathParseError, error }: SettingsTreeNodesProps,
  t: TFunction<"gauge">,
): Record<"general", DocumentedNode> {
  const {
    colorMap,
    colorMode,
    gradient,
    maxValue,
    minValue,
    path,
    reverse,
    displayMode,
    angleUnit,
    angleRange,
    warningAngle,
    criticalAngle,
  } = config;
  return {
    general: {
      error,
      fields: {
        displayMode: {
          label: t("displayMode"),
          help: t("displayModeHelp"),
          input: "select",
          value: displayMode,
          options: (["arc", "roll", "pitch"] as const).map((mode) => ({
            label: t(mode),
            value: mode,
          })),
        },
        path: {
          label: t("messagePath.label"),
          help: t("messagePath.help"),
          input: "messagepath",
          supportsMathModifiers: true,
          value: path,
          error: pathParseError,
          validTypes: DATA_TYPES,
        },
        ...(displayMode !== "arc" && {
          angleUnit: {
            label: t("angleUnit"),
            help: t("angleUnitHelp"),
            input: "select",
            value: angleUnit,
            options: [
              { label: t("degrees"), value: "degrees" },
              { label: t("radians"), value: "radians" },
            ],
          },
          angleRange: {
            label: t("angleRange"),
            help: t("angleRangeHelp"),
            input: "number",
            value: angleRange,
            error: !(
              warningAngle > 0 &&
              criticalAngle > warningAngle &&
              angleRange > criticalAngle &&
              angleRange <= 90
            )
              ? t("invalidAngles")
              : undefined,
          },
          warningAngle: {
            label: t("warningAngle"),
            help: t("warningAngleHelp"),
            input: "number",
            value: warningAngle,
          },
          criticalAngle: {
            label: t("criticalAngle"),
            help: t("criticalAngleHelp"),
            input: "number",
            value: criticalAngle,
          },
        }),
        ...(displayMode === "arc" && {
          minValue: {
            label: t("minValue.label"),
            help: t("minValue.help"),
            input: "number",
            value: minValue,
          },
          maxValue: {
            label: t("maxValue.label"),
            help: t("maxValue.help"),
            input: "number",
            value: maxValue,
          },
          colorMode: {
            label: t("colorMode.label"),
            help: t("colorMode.help"),
            input: "select",
            value: colorMode,
            options: [
              { label: t("colorMode.options.colorMap"), value: ColorModeConfig.COLORMAP },
              { label: "Gradient", value: ColorModeConfig.GRADIENT },
            ],
          },
          ...(colorMode === ColorModeConfig.COLORMAP && {
            colorMap: {
              label: t("colorMode.options.colorMap"),
              help: t("colorMap.help"),
              input: "select",
              value: colorMap,
              options: [
                {
                  label: t("colorMap.options.redYellowGreen"),
                  value: ColorMapConfig.RED_YELLOW_GREEN,
                },
                { label: t("colorMap.options.rainbow"), value: ColorMapConfig.RAINBOW },
                { label: t("colorMap.options.turbo"), value: ColorMapConfig.TURBO },
              ],
            },
          }),
          ...(colorMode === ColorModeConfig.GRADIENT && {
            gradient: {
              label: t("colorMode.options.gradient"),
              help: t("gradientHelp"),
              input: ColorModeConfig.GRADIENT,
              value: gradient,
            },
          }),
          reverse: {
            label: t("reverse.label"),
            help: t("reverse.help"),
            input: "boolean",
            value: reverse,
          },
        }),
      },
    },
  };
}

export function useSettingsTree({
  config,
  pathParseError,
  error,
}: SettingsTreeNodesProps): Record<"general", DocumentedNode> {
  const { t } = useTranslation("gauge");
  return useMemo(
    () => buildSettingsTree({ config, pathParseError, error }, t),
    [config, pathParseError, error, t],
  );
}
