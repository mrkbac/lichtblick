// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SvgIcon, SvgIconProps } from "@mui/material";

const dot = (cx: number, cy: number, r = 1.6) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

// Staggered rows of dimples, punched out of the dome with evenodd.
const DIMPLES: [number, number[]][] = [
  [15, [32]],
  [21, [28.5, 35.5]],
  [27, [25, 32, 39]],
  [33, [21.5, 28.5, 35.5, 42.5]],
  [39, [25, 32, 39]],
  [44, [21.5, 28.5, 35.5, 42.5]],
];

/** Thimble dome with dimples, plus its rim. Shared with ThimbleLogoText. */
export const THIMBLE_DOME =
  "M17 48V29C17 15 23.5 7 32 7s15 8 15 22v19Z" +
  DIMPLES.flatMap(([y, xs]) => xs.map((x) => dot(x, y))).join("");
export const THIMBLE_RIM = "M17.5 47h29a4.5 4.5 0 0 1 0 9h-29a4.5 4.5 0 0 1 0-9Z";

export function ThimbleLogo(props: SvgIconProps): React.JSX.Element {
  return (
    <SvgIcon viewBox="0 0 64 64" {...props}>
      <title>Thimble</title>
      <path fillRule="evenodd" d={THIMBLE_DOME} />
      <path d={THIMBLE_RIM} />
    </SvgIcon>
  );
}
