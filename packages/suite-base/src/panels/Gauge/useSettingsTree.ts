// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useShallowMemo } from "@lichtblick/hooks";
import { SettingsTreeNode } from "@lichtblick/suite";
import { DATA_TYPES } from "@lichtblick/suite-base/panels/Gauge/constants";

import { ColorMapConfig, ColorModeConfig, SettingsTreeNodesProps } from "./types";

export function useSettingsTree({
  config,
  pathParseError,
  error,
}: SettingsTreeNodesProps): Record<"general", SettingsTreeNode> {
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
  const { t } = useTranslation("gauge");

  const generalSettings = useMemo(
    (): SettingsTreeNode => ({
      error,
      fields: {
        displayMode: {
          label: t("displayMode"),
          input: "select",
          value: displayMode,
          options: ["arc", "roll", "pitch"].map((mode) => ({
            label: t(mode as "arc" | "roll" | "pitch"),
            value: mode,
          })),
        },
        path: {
          label: t("messagePath.label"),
          input: "messagepath",
          supportsMathModifiers: true,
          value: path,
          error: pathParseError,
          validTypes: DATA_TYPES,
        },
        ...(displayMode !== "arc" && {
          angleUnit: {
            label: t("angleUnit"),
            input: "select",
            value: angleUnit,
            options: [
              { label: t("degrees"), value: "degrees" },
              { label: t("radians"), value: "radians" },
            ],
          },
          angleRange: {
            label: t("angleRange"),
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
          warningAngle: { label: t("warningAngle"), input: "number", value: warningAngle },
          criticalAngle: { label: t("criticalAngle"), input: "number", value: criticalAngle },
        }),
        ...(displayMode === "arc" && {
          minValue: {
            label: t("minValue.label"),
            input: "number",
            value: minValue,
          },
          maxValue: {
            label: t("maxValue.label"),
            input: "number",
            value: maxValue,
          },
          colorMode: {
            label: t("colorMode.label"),
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
              input: ColorModeConfig.GRADIENT,
              value: gradient,
            },
          }),
          reverse: {
            label: t("reverse.label"),
            input: "boolean",
            value: reverse,
          },
        }),
      },
    }),
    [
      error,
      t,
      path,
      minValue,
      maxValue,
      colorMode,
      colorMap,
      gradient,
      reverse,
      pathParseError,
      displayMode,
      angleUnit,
      angleRange,
      warningAngle,
      criticalAngle,
    ],
  );

  return useShallowMemo({
    general: generalSettings,
  });
}
