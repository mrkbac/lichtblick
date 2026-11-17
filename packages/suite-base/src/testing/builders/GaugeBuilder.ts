// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ColorMapConfig,
  ColorModeConfig,
  GaugeConfig,
} from "@lichtblick/suite-base/panels/Gauge/types";
import { BasicBuilder, defaults } from "@lichtblick/test-builders";

export default class GaugeBuilder {
  public static config(props: Partial<GaugeConfig> = {}): GaugeConfig {
    // Valid limits by default (max above min); tests of invalid limits set them explicitly.
    const minValue = BasicBuilder.number();
    return defaults<GaugeConfig>(props, {
      displayMode: "arc",
      angleUnit: "degrees",
      angleRange: 40,
      warningAngle: 20,
      criticalAngle: 30,
      colorMap: BasicBuilder.sample(ColorMapConfig),
      colorMode: BasicBuilder.sample(ColorModeConfig),
      gradient: ["#000", "#fff"],
      maxValue: minValue + 1 + BasicBuilder.number({ min: 0, max: 100 }),
      minValue,
      path: BasicBuilder.string(),
      reverse: BasicBuilder.boolean(),
    });
  }
}
