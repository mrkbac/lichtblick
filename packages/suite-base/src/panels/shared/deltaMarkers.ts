// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DeltaDisplay, DeltaMarker, DeltaResult } from "@lichtblick/suite-base/panels/shared/types";

export function computeDelta(markerA: DeltaMarker, markerB: DeltaMarker): DeltaResult {
  const primaryA = markerA.seriesValues[0]?.value;
  const primaryB = markerB.seriesValues[0]?.value;
  const deltaY =
    typeof primaryA === "number" && typeof primaryB === "number"
      ? Math.abs(primaryB - primaryA)
      : undefined;

  return {
    deltaX: Math.abs(markerB.xValue - markerA.xValue),
    deltaY,
  };
}

export function computeDeltaDisplay(
  markerA: DeltaMarker | undefined,
  markerB: DeltaMarker | undefined,
): DeltaDisplay {
  return markerA && markerB
    ? computeDelta(markerA, markerB)
    : { deltaX: undefined, deltaY: undefined };
}
