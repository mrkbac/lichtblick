// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const PANEL_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  position: "relative",
};

// Limit the amount of transform messages stored to avoid excessive memory usage
export const MAX_TRANSFORM_MESSAGES = 10_000;

/** Transform preloading is on unless the layout turned it off explicitly. */
export function isTransformPreloadEnabled(config: {
  scene: { transforms?: { enablePreloading?: boolean } };
}): boolean {
  return config.scene.transforms?.enablePreloading ?? true;
}

export const DEFAULT_FOLLOW_MODE = "follow-pose";

// Throttle hover GPU picking to reduce load (10 Hz)
export const HOVER_PICK_THROTTLE_MS = 100;
