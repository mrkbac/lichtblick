// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { VariableSliderConfig } from "./types";

export const defaultConfig: VariableSliderConfig = {
  sliderProps: {
    min: 0,
    max: 10,
    step: 1,
  },
  globalVariableName: "globalVariable",
};

export function buildSettingsTree(config: VariableSliderConfig): DocumentedNodes {
  return {
    general: {
      label: "General",
      fields: {
        min: {
          label: "Min",
          help: "Lowest value the slider can set.",
          input: "number",
          placeholder: "min",
          value: config.sliderProps.min,
        },
        max: {
          label: "Max",
          help: "Highest value the slider can set.",
          input: "number",
          placeholder: "max",
          value: config.sliderProps.max,
        },
        step: {
          label: "Step",
          help: "Increment between slider positions.",
          input: "number",
          placeholder: "step",
          value: config.sliderProps.step,
        },
        globalVariableName: {
          label: "Variable name",
          help: "Layout variable the slider sets; reference it in message paths as $name.",
          input: "string",
          value: config.globalVariableName,
        },
      },
    },
  };
}
