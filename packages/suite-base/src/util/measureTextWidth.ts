// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

let context: OffscreenCanvasRenderingContext2D | undefined;

/** Width in pixels of `text` rendered with the CSS `font` shorthand, e.g. "12px sans-serif". */
export function measureTextWidth(text: string, font: string): number {
  context ??= new OffscreenCanvas(1, 1).getContext("2d") ?? undefined;
  if (!context) {
    return 0;
  }
  context.font = font;
  return context.measureText(text).width;
}
