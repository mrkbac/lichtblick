// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LEFT_SIDEBAR_MIN_WIDTH_PX } from "@lichtblick/suite-base/components/Sidebars/constants";

/**
 * Clamp a given percentage to the minimum width of the left sidebar.
 */
export function clampLeftSidebarPercentage(percentage: number): number {
  const minPercentage = (LEFT_SIDEBAR_MIN_WIDTH_PX / window.innerWidth) * 100;
  return Math.max(percentage, minPercentage);
}
