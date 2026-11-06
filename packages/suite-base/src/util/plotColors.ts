// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { colord } from "colord";
import * as _ from "lodash-es";

import { parseColor, toHex6 } from "@lichtblick/suite-base/util/parseColor";
import { toolsColorScheme } from "@lichtblick/suite-base/util/toolsColorScheme";

// Inspired by the "light" scheme from https://personal.sron.nl/~pault/#sec:qualitative
// but using our standard tools colors.
export const lineColors = [
  toolsColorScheme.blue.medium,
  toolsColorScheme.orange.medium,
  toolsColorScheme.yellow.medium,
  toolsColorScheme.green.medium,
  toolsColorScheme.cyan.medium,
  toolsColorScheme.purple.medium,
  toolsColorScheme.paleGreen.medium,
];

const colorExpansion = lineColors.map((color) => [
  color,
  ...[0, 90, 180, 270].map((deg) => toHex6(parseColor(color).rotate(deg))),
]);

export const expandedLineColors = _.uniq(
  _.range(0, colorExpansion[0]!.length)
    .map((i) => colorExpansion.map((colors) => colors[i]!))
    .flat(),
);

// RGB brightening by a percent of 255; colord only has HSL lighten.
function brighten(color: string, percent: number): string {
  const { r, g, b, a } = parseColor(color).toRgb();
  const step = Math.round((255 * percent) / 100);
  return colord({ r: r + step, g: g + step, b: b + step, a }).toHex();
}

export const lightColor: (_: string) => string = _.memoize((color: string): string =>
  brighten(color, 15),
);

export const darkColor: (_: string) => string = _.memoize((color: string): string =>
  parseColor(color).darken(0.3).toHex(),
);

export function getLineColor(color: string | undefined, index: number): string {
  return color ?? lineColors[index % lineColors.length]!;
}

export function getContrastColor(colorScheme: "light" | "dark", color: string): string {
  return colorScheme === "light" ? darkColor(color) : lightColor(color);
}
