// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChartDatum } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { ValueAtTime } from "@lichtblick/suite-base/panels/StateTransitions/types";

/**
 * Finds the state active at `time`: the point with the largest x at or before it (the later row on
 * ties). Rows needn't be sorted by x, e.g. with header stamps; runs on click, so a scan is fine.
 */
export function getValueAtTime(
  data: readonly (ChartDatum | undefined)[],
  time: number,
): ValueAtTime | undefined {
  let latest: ChartDatum | undefined;
  for (const datum of data) {
    if (datum && datum.x <= time && (latest == undefined || datum.x >= latest.x)) {
      latest = datum;
    }
  }
  return latest?.value != undefined
    ? { value: latest.value, constantName: latest.constantName }
    : undefined;
}
