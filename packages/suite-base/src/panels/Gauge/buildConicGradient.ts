// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { COLOR_MAPS } from "@lichtblick/suite-base/panels/Gauge/constants";
import {
  ColorStops,
  ColorModeConfig,
  BuildConicGradientProps,
} from "@lichtblick/suite-base/panels/Gauge/types";

/** Color stops from min (0) to max (1), shared by the arc and slider displays. */
export function getColorStops(config: BuildConicGradientProps["config"]): ColorStops[] {
  const { colorMap, colorMode, gradient, reverse } = config;
  let colorStops: ColorStops[] = [];

  switch (colorMode) {
    case ColorModeConfig.COLORMAP:
      colorStops = COLOR_MAPS[colorMap] ?? [];
      break;
    case ColorModeConfig.GRADIENT:
      colorStops = [
        { color: gradient[0], location: 0 },
        { color: gradient[1], location: 1 },
      ];
      break;
  }

  if (reverse) {
    colorStops = colorStops
      .map((stop) => ({ color: stop.color, location: 1 - stop.location }))
      .reverse();
  }
  return colorStops;
}

export const buildConicGradient = ({
  config,
  gaugeAngle,
  height,
  width,
}: BuildConicGradientProps): string => {
  const colorStops = getColorStops(config);
  const angleAndPosition = `from ${-Math.PI / 2 + gaugeAngle}rad at 50% ${
    100 * (width / 2 / height)
  }%`;
  const angularColorStop: string =
    colorStops.length > 0
      ? colorStops
          .map((stop) => `${stop.color} ${stop.location * 2 * (Math.PI / 2 - gaugeAngle)}rad`)
          .join(",")
      : "transparent 0%";
  const color = colorStops.length > 0 ? colorStops[0]!.color : "transparent";

  return `conic-gradient(${angleAndPosition}, ${angularColorStop}, ${color})`;
};
