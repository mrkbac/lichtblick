// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Settings nodes for voxel grid topics. Kept free of three.js so the panel guide can use them.

import { t } from "i18next";

import type { Topic } from "@lichtblick/suite";
import type {
  DocumentedFields,
  DocumentedNode,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { colorModeSettingsFields, type ColorModeSettings } from "./colorMode";
import { type BaseSettings, rgbaToCssString } from "../settings";

/** How bit-packed (ROS) voxel grids are colored. */
export type BitVoxelColorMode = "type" | "gradient" | "rainbow";

export type LayerSettingsVoxelGrid = BaseSettings &
  // Packed-field grids: the shared color mode settings, without the point-cloud-only packed modes
  ColorModeSettings & {
    colorMode: Exclude<ColorModeSettings["colorMode"], "rgb" | "rgba">;
    frameLocked: boolean;
    useLighting: boolean;
    drawBehind: boolean;
    // Bit-packed grids
    bitColorMode: BitVoxelColorMode;
    markedPresentColor: string;
    presentColor: string;
    markedColor: string;
  };

export const VOXEL_GRID_DEFAULTS: LayerSettingsVoxelGrid = {
  visible: false,
  frameLocked: false,
  useLighting: true,
  drawBehind: false,
  colorMode: "colormap",
  flatColor: rgbaToCssString({ r: 1, g: 1, b: 1, a: 1 }),
  colorField: undefined,
  gradient: [
    rgbaToCssString({ r: 100 / 255, g: 47 / 255, b: 105 / 255, a: 1 }),
    rgbaToCssString({ r: 227 / 255, g: 177 / 255, b: 135 / 255, a: 1 }),
  ],
  colorMap: "turbo",
  explicitAlpha: 1,
  minValue: undefined,
  maxValue: undefined,
  bitColorMode: "type",
  markedPresentColor: rgbaToCssString({ r: 1, g: 0.25, b: 0.25, a: 1 }),
  // One-bit voxels are often whole unobserved columns, so they start hidden
  presentColor: rgbaToCssString({ r: 0.6, g: 0.6, b: 0.6, a: 0 }),
  markedColor: rgbaToCssString({ r: 1, g: 0.75, b: 0.25, a: 0 }),
};

function sharedFields(settings: LayerSettingsVoxelGrid): DocumentedFields {
  return {
    useLighting: {
      label: t("threeDee:voxelUseLighting"),
      help: t("threeDee:voxelUseLightingHelp"),
      input: "boolean",
      value: settings.useLighting,
    },
    frameLocked: {
      label: t("threeDee:frameLock"),
      help: t("threeDee:frameLockHelp"),
      input: "boolean",
      value: settings.frameLocked,
    },
    drawBehind: {
      label: t("threeDee:voxelDrawBehind"),
      help: t("threeDee:voxelDrawBehindHelp"),
      input: "boolean",
      value: settings.drawBehind,
    },
  };
}

/** Settings for bit-packed (ROS costmap) voxel grids. */
export function bitVoxelGridSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsVoxelGrid>,
): DocumentedNode {
  const settings = { ...VOXEL_GRID_DEFAULTS, ...config };
  const fields: DocumentedFields = {
    bitColorMode: {
      label: t("threeDee:colorMode"),
      help: t("threeDee:voxelBitColorModeHelp"),
      input: "select",
      value: settings.bitColorMode,
      options: [
        { label: t("threeDee:voxelByType"), value: "type" },
        { label: t("threeDee:gradient"), value: "gradient" },
        { label: "Rainbow", value: "rainbow" },
      ],
    },
  };
  if (settings.bitColorMode === "type") {
    fields.markedPresentColor = {
      label: t("threeDee:voxelMarkedPresent"),
      help: t("threeDee:voxelMarkedPresentHelp"),
      input: "rgba",
      value: settings.markedPresentColor,
    };
    fields.presentColor = {
      label: t("threeDee:voxelPresent"),
      help: t("threeDee:voxelPresentHelp"),
      input: "rgba",
      value: settings.presentColor,
    };
    fields.markedColor = {
      label: t("threeDee:voxelMarked"),
      help: t("threeDee:voxelMarkedHelp"),
      input: "rgba",
      value: settings.markedColor,
    };
  } else if (settings.bitColorMode === "gradient") {
    fields.gradient = {
      label: t("threeDee:gradient"),
      help: t("threeDee:voxelHeightGradientHelp"),
      input: "gradient",
      value: settings.gradient,
    };
  }
  return {
    label: topic.name,
    icon: "Cells",
    order: topic.name.toLocaleLowerCase(),
    visible: settings.visible,
    fields: { ...fields, ...sharedFields(settings) },
  };
}

/** Settings for voxel grids with packed per-cell fields. `msgFields`: the cell fields, once known. */
export function packedVoxelGridSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsVoxelGrid>,
  msgFields: string[] | undefined,
): DocumentedNode {
  const settings = { ...VOXEL_GRID_DEFAULTS, ...config };
  const colorFields = colorModeSettingsFields({
    msgFields,
    config: { ...config, colorMode: settings.colorMode },
    defaults: VOXEL_GRID_DEFAULTS,
    modifiers: { supportsPackedRgbModes: false, supportsRgbaFieldsMode: true },
  });
  // Computed colors (e.g. distance) are point cloud only; voxels color by message fields
  if (colorFields.colorField?.input === "select" && msgFields) {
    colorFields.colorField.options = msgFields.map((field) => ({ label: field, value: field }));
  }
  return {
    label: topic.name,
    icon: "Cells",
    order: topic.name.toLocaleLowerCase(),
    visible: settings.visible,
    fields: { ...colorFields, ...sharedFields(settings) },
  };
}
