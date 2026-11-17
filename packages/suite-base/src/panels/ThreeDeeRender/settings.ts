// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { DocumentedField } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import type { ColorRGBA } from "./ros";

export type SelectEntry = { label: string; value: string };

export type TwoColors = [string, string];
export type Vec3 = [number, number, number];

/**
 * Common settings for all persisted SceneExtension settings.
 */
export type BaseSettings = {
  /** Visibility for any associated scene renderables and settings tree nodes. */
  visible: boolean;
  /** If true, always use `currentTime` for pose updates. This means objects in a coordinate frame
   * will move as the coordinate frame moves. */
  frameLocked?: boolean;
  /** Held back until all topics marked "Sync" have a message with the same timestamp. */
  sync?: boolean;
};

export type LayerSettingsEntity = BaseSettings & {
  showOutlines: boolean | undefined;
  showLabels?: boolean;
  color: string | undefined;
  selectedIdVariable: string | undefined;
};

/**
 * Settings for a "Custom Layer", a user-added collection of one or more renderables such as a Grid.
 */
export type CustomLayerSettings = BaseSettings & {
  /** An identifier for a unique instance of a layer. */
  instanceId: string;
  /** An identifier for a type of layer, such as `"foxglove.Grid"`. */
  layerId: string;
  /** The label to use for this layer in the settings tree, under "Custom Layers". */
  label: string;
  /** Optional value specifying order in the custom layer list */
  order?: number;
};

export const PRECISION_DISTANCE = 3; // [1mm]
export const PRECISION_DEGREES = 1;

/** Global variable set to the selected marker or entity id unless a topic overrides it. */
export const SELECTED_ID_VARIABLE = "selected_id";

/** Length of a drawn coordinate axis (shaft plus head) in meters. */
export const AXIS_LENGTH = 0.2;

export function fieldSize(
  label: string,
  help: string,
  value: number | undefined,
  placeholder?: string | number,
): DocumentedField {
  return {
    label,
    help,
    input: "number",
    min: 0,
    step: 0.5,
    precision: PRECISION_DISTANCE,
    value,
    placeholder: String(placeholder),
  };
}

export function fieldScaleVec3(label: string, help: string, value: Vec3): DocumentedField {
  return {
    label,
    help,
    input: "vec3",
    labels: ["X", "Y", "Z"],
    step: 0.5,
    precision: PRECISION_DISTANCE,
    value,
  };
}

export function fieldLineWidth(
  label: string,
  help: string,
  value: number | undefined,
  placeholder?: string | number,
): DocumentedField {
  return {
    label,
    help,
    input: "number",
    min: 0,
    step: 0.005,
    precision: 4,
    value,
    placeholder: String(placeholder),
  };
}

export function fieldGradient(label: string, help: string, value: TwoColors): DocumentedField {
  return { label, help, input: "gradient", value };
}

/** Lives here rather than in color.ts so light settings modules can use it without three.js. */
export function rgbaToCssString(color: ColorRGBA): string {
  const r = Math.trunc(color.r * 255);
  const g = Math.trunc(color.g * 255);
  const b = Math.trunc(color.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${color.a})`;
}
