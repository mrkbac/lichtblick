// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0
import { useMemo } from "react";

import { expandedLineColors } from "@lichtblick/suite-base/util/plotColors";

import type { PieChartConfig, PieChartDatum } from "./types";

export function useChartData(rawValue: Float32Array, config: PieChartConfig): PieChartDatum[] {
  return useMemo(() => {
    // A slice can't be negative; without a positive total there is nothing to divide up
    const rawArray = Array.from(rawValue, (value) => Math.max(value, 0));
    const total = rawArray.reduce((sum, val) => sum + val, 0);
    if (total <= 0) {
      return [];
    }

    return rawArray.map((value, index) => {
      const percentage = (value / total) * 100;
      const legendKey = `legend${index + 1}` as keyof PieChartConfig;
      const rawName = config[legendKey];
      const name = rawName && rawName.trim() !== "" ? rawName : `Data ${index + 1}`;

      return {
        name,
        value: percentage,
        color: expandedLineColors[index % expandedLineColors.length]!,
      };
    });
  }, [rawValue, config]);
}
