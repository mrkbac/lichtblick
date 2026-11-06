// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Colord, colord, extend } from "colord";
import namesPlugin from "colord/plugins/names";

extend([namesPlugin]);

const BARE_HEX = /^[0-9a-f]{3}$|^[0-9a-f]{4}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i;
const HEX_WITH_ALPHA = /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i;

/**
 * Parse a CSS color string. Accepts what users could enter before (CSS names, hex with or
 * without `#`) and keeps the exact alpha of 4/8-digit hex, which colord rounds to 2 decimals.
 */
export function parseColor(input: string | undefined): Colord {
  const trimmed = (input ?? "").trim();
  const str = BARE_HEX.test(trimmed) ? `#${trimmed}` : trimmed;
  const color = colord(str);
  if (!color.isValid() || !HEX_WITH_ALPHA.test(str)) {
    return color;
  }
  const alphaHex = str.length === 5 ? str[4]!.repeat(2) : str.slice(7);
  return colord({ ...color.rgba, a: parseInt(alphaHex, 16) / 255 });
}

const hexByte = (value: number) =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");

/** `#rrggbbaa`, always with the alpha byte (colord's toHex() drops it when opaque). */
export function toHex8(color: Colord): string {
  const { r, g, b, a } = color.rgba;
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${hexByte(a * 255)}`;
}

/** `#rrggbb`, ignoring alpha (colord's toHex() adds it when translucent). */
export function toHex6(color: Colord): string {
  return toHex8(color).slice(0, 7);
}

/** Perceived brightness >= 128 of 255 (colord's isLight() uses 127.5). */
export function isLight(color: Colord): boolean {
  const { r, g, b } = color.toRgb();
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128;
}
