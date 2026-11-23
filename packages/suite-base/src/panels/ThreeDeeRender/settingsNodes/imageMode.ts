// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Settings nodes for the Image panel (the 3D renderer's image mode), shared by ImageMode and the
// panel guide. Kept free of three.js.

import { t } from "i18next";

import type {
  DocumentedFields,
  DocumentedNode,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { colorModeSettingsFields, type ColorModeSettings } from "./colorMode";
import type { ImageModeConfig } from "../IRenderer";

export const MIN_BRIGHTNESS = 0;
export const MAX_BRIGHTNESS = 100;
export const INITIAL_BRIGHTNESS = (MAX_BRIGHTNESS + MIN_BRIGHTNESS) / 2;

export const MIN_CONTRAST = 0;
export const MAX_CONTRAST = 100;
export const INITIAL_CONTRAST = (MAX_CONTRAST + MIN_CONTRAST) / 2;

export const IMAGE_DEFAULT_COLOR_MODE_SETTINGS: Required<
  Omit<ColorModeSettings, "colorField" | "minValue" | "maxValue">
> = {
  colorMode: "gradient",
  flatColor: "#ffffff",
  gradient: ["#000000", "#ffffff"],
  colorMap: "turbo",
  explicitAlpha: 0,
};

export const DEFAULT_IMAGE_CONFIG = {
  synchronize: false,
  flipHorizontal: false,
  flipVertical: false,
  rotation: 0 as 0 | 90 | 180 | 270,
  brightness: INITIAL_BRIGHTNESS,
  contrast: INITIAL_CONTRAST,
  ...IMAGE_DEFAULT_COLOR_MODE_SETTINGS,
};

type TopicOption = { label: string; value: string | undefined };

/**
 * The image panel's "General" node. `calibrationTopics` includes the "None" option;
 * `showColorMode`: the image is raw or depth, so color mode settings apply.
 */
export function imageModeSettingsNode(
  settings: ImageModeConfig & typeof DEFAULT_IMAGE_CONFIG,
  {
    imageTopics,
    calibrationTopics,
    errors,
    showColorMode,
  }: {
    imageTopics: TopicOption[];
    calibrationTopics: TopicOption[];
    errors: { imageTopic?: string; calibrationTopic?: string };
    showColorMode: boolean;
  },
): DocumentedNode {
  const fields: DocumentedFields = {
    imageTopic: {
      label: t("threeDee:topic"),
      help: "Image topic to show. A calibration topic with a matching name is picked automatically.",
      input: "select",
      value: settings.imageTopic,
      options: imageTopics,
      error: errors.imageTopic,
    },
    calibrationTopic: {
      label: "Calibration",
      help: "Camera calibration used to project 3D topics onto the image. None shows the image only.",
      input: "select",
      value: settings.calibrationTopic,
      options: calibrationTopics,
      error: errors.calibrationTopic,
    },
    synchronize: {
      input: "boolean",
      label: "Sync annotations",
      help: "Only draw annotations whose timestamp matches the image.",
      value: settings.synchronize,
    },
    flipHorizontal: {
      input: "boolean",
      label: "Flip horizontal",
      help: "Mirrors the image left to right.",
      value: settings.flipHorizontal,
    },
    flipVertical: {
      input: "boolean",
      label: "Flip vertical",
      help: "Mirrors the image top to bottom.",
      value: settings.flipVertical,
    },
    rotation: {
      input: "toggle",
      label: "Rotation",
      help: "Rotates the image in 90° steps.",
      value: settings.rotation,
      options: [
        { label: "0°", value: 0 },
        { label: "90°", value: 90 },
        { label: "180°", value: 180 },
        { label: "270°", value: 270 },
      ],
    },
    brightness: {
      input: "slider",
      label: "Brightness",
      help: "Makes the image darker or brighter; the middle leaves it unchanged.",
      min: MIN_BRIGHTNESS,
      max: MAX_BRIGHTNESS,
      value: settings.brightness,
      step: 5,
    },
    contrast: {
      input: "slider",
      label: "Contrast",
      help: "Lowers or raises the image contrast; the middle leaves it unchanged.",
      min: MIN_CONTRAST,
      max: MAX_CONTRAST,
      value: settings.contrast,
      step: 5,
    },
  };

  // color settings only apply to raw images (compressedDepth images decode to raw depth)
  if (showColorMode) {
    Object.assign(
      fields,
      colorModeSettingsFields({
        config: settings,
        defaults: { gradient: DEFAULT_IMAGE_CONFIG.gradient },
        modifiers: {
          supportsPackedRgbModes: false,
          supportsRgbaFieldsMode: false,
          hideFlatColor: true,
          hideExplicitAlpha: true,
        },
      }),
    );
  }

  return { label: "General", defaultExpansionState: "expanded", fields };
}

export function imageAnnotationsRootNode(): DocumentedNode {
  return {
    label: t("threeDee:imageAnnotations"),
    help: t("threeDee:imageAnnotationsHelp"),
    enableVisibilityFilter: true,
    enableTopicNameTree: true,
    defaultExpansionState: "expanded",
  };
}
