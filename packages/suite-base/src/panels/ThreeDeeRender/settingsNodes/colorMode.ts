// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Settings fields for color modes. Kept free of three.js so the panel guide can build them.

import { t } from "i18next";

import type { DocumentedFields } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import type { BaseSettings } from "../settings";

export const NEEDS_MIN_MAX = ["gradient", "colormap"];

export const colorFieldComputedPrefix = "_auto_";

export interface ColorModeSettings {
  colorMode: "flat" | "gradient" | "colormap" | "rgb" | "rgba" | "rgba-fields";
  flatColor: string;
  colorField?: string;
  gradient: [string, string];
  colorMap: "turbo" | "rainbow";
  explicitAlpha: number;
  minValue?: number;
  maxValue?: number;
}

export const RGBA_PACKED_FIELDS = new Set<string>(["rgb", "rgba"]);
export const INTENSITY_FIELDS = new Set<string>(["intensity", "i"]);

export function bestColorByField(
  fields: string[],
  { supportsPackedRgbModes }: { supportsPackedRgbModes: boolean },
): string | undefined {
  if (supportsPackedRgbModes) {
    // first priority is color fields
    for (const field of fields) {
      if (RGBA_PACKED_FIELDS.has(field.toLowerCase())) {
        return field;
      }
    }
  }
  // second priority is intensity fields
  for (const field of fields) {
    if (INTENSITY_FIELDS.has(field.toLowerCase())) {
      return field;
    }
  }
  // third is 'z', then the first field
  return fields.find((field) => field === "z") ?? fields[0];
}

export function hasSeparateRgbaFields(fields: string[]): boolean {
  let r = false;
  let g = false;
  let b = false;
  let a = false;
  for (const field of fields) {
    switch (field) {
      case "red":
        r = true;
        break;
      case "green":
        g = true;
        break;
      case "blue":
        b = true;
        break;
      case "alpha":
        a = true;
        break;
    }
  }
  return r && g && b && a;
}

export function colorModeSettingsFields<Settings extends ColorModeSettings & BaseSettings>({
  msgFields,
  config,
  defaults,
  modifiers: { supportsPackedRgbModes, supportsRgbaFieldsMode, hideFlatColor, hideExplicitAlpha },
}: {
  msgFields?: string[];
  config: Partial<Settings>;
  defaults: Pick<Settings, "gradient">;
  modifiers: {
    supportsPackedRgbModes: boolean;
    supportsRgbaFieldsMode: boolean;
    hideFlatColor?: boolean;
    hideExplicitAlpha?: boolean;
  };
}): DocumentedFields {
  const colorMode = config.colorMode ?? (hideFlatColor === true ? "gradient" : "flat");
  const flatColor = config.flatColor ?? "#ffffff";
  const gradient = config.gradient;
  const colorMap = config.colorMap ?? "turbo";
  const explicitAlpha = config.explicitAlpha ?? 1;
  const minValue = config.minValue;
  const maxValue = config.maxValue;

  const fields: DocumentedFields = {};

  const colorModeOptions = [
    { label: t("threeDee:colorModeColorMap"), value: "colormap" },
    { label: t("threeDee:gradient"), value: "gradient" },
  ];

  if (hideFlatColor !== true) {
    colorModeOptions.push({ label: t("threeDee:colorModeFlat"), value: "flat" });
  }
  if (msgFields && msgFields.length > 0) {
    if (supportsPackedRgbModes) {
      colorModeOptions.push(
        { label: t("threeDee:colorModeBgrPacked"), value: "rgb" },
        { label: t("threeDee:colorModeBgraPacked"), value: "rgba" },
      );
    }
    if (supportsRgbaFieldsMode && hasSeparateRgbaFields(msgFields)) {
      colorModeOptions.push({
        label: t("threeDee:colorModeRgbaSeparateFields"),
        value: "rgba-fields",
      });
    }
  }

  fields.colorMode = {
    label: t("threeDee:colorMode"),
    help: t("threeDee:colorModeHelp"),
    input: "select",
    value: colorMode,
    options: colorModeOptions,
  };

  if (colorMode === "flat") {
    fields.flatColor = {
      label: t("threeDee:flatColor"),
      help: t("threeDee:flatColorHelp"),
      input: "rgba",
      value: flatColor,
    };
  } else if (colorMode !== "rgba-fields") {
    if (msgFields) {
      const colorFieldOptions = msgFields.map((field) => ({ label: field, value: field }));

      colorFieldOptions.push({
        label: t("threeDee:ColorFieldComputedDistance"),
        value: colorFieldComputedPrefix + "distance",
      });

      const colorField =
        config.colorField ?? bestColorByField(msgFields, { supportsPackedRgbModes });
      fields.colorField = {
        label: t("threeDee:colorBy"),
        help: t("threeDee:colorByHelp"),
        input: "select",
        options: colorFieldOptions,
        value: colorField,
      };
    }

    switch (colorMode) {
      case "gradient":
        fields.gradient = {
          label: t("threeDee:gradient"),
          help: t("threeDee:gradientHelp"),
          input: "gradient",
          value: gradient ?? defaults.gradient,
        };
        break;
      case "colormap":
        fields.colorMap = {
          label: t("threeDee:colorModeColorMap"),
          help: t("threeDee:colorMapHelp"),
          input: "select",
          options: [
            { label: "Turbo", value: "turbo" },
            { label: "Rainbow", value: "rainbow" },
          ],
          value: colorMap,
        };
        break;
      default:
        break;
    }

    if (hideExplicitAlpha !== true && (colorMode === "colormap" || colorMode === "rgb")) {
      fields.explicitAlpha = {
        label: t("threeDee:opacity"),
        help: t("threeDee:opacityHelp"),
        input: "number",
        step: 0.1,
        placeholder: "1",
        precision: 3,
        min: 0,
        max: 1,
        value: explicitAlpha,
      };
    }

    if (NEEDS_MIN_MAX.includes(colorMode)) {
      fields.minValue = {
        label: t("threeDee:valueMin"),
        help: t("threeDee:valueMinHelp"),
        input: "number",
        placeholder: "auto",
        precision: 4,
        value: minValue,
      };
      fields.maxValue = {
        label: t("threeDee:valueMax"),
        help: t("threeDee:valueMaxHelp"),
        input: "number",
        placeholder: "auto",
        precision: 4,
        value: maxValue,
      };
    }
  }

  return fields;
}
