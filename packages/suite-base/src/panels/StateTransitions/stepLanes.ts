// SPDX-License-Identifier: MPL-2.0

import { ChartDataset } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { grey } from "@lichtblick/suite-base/util/toolsColorScheme";

import { createLabel } from "./messagesToDataset";
import { ValidQueriedDataValue } from "./types";

/** Y units between two lanes of a step series (a row of 9 units is 64 px). */
export const LANE_SPACING = 2;
/** Past this many states, lanes are squeezed into this many lanes' height, still in order. */
export const MAX_LANES = 12;
/** Line width of a step series, in px (a bar is 10). */
export const STEP_LINE_WIDTH = 2;

export type StepLane = { y: number; label: string; color: string };

type State = { label: string; color: string };

/** Distinct states in `datasets`: ordered by value unless any is a string, then first-seen. */
function distinctStates(datasets: readonly ChartDataset[]): Map<ValidQueriedDataValue, State> {
  const states = new Map<ValidQueriedDataValue, State>();
  for (const dataset of datasets) {
    for (const datum of dataset.data) {
      const value = datum?.value;
      if (value != undefined && !states.has(value)) {
        states.set(value, {
          label: createLabel(datum!.constantName, value),
          color: datum!.labelColor ?? grey,
        });
      }
    }
  }
  if ([...states.keys()].some((value) => typeof value === "string")) {
    return states;
  }
  // Numbers, bigints and booleans compare with each other directly (false < true).
  return new Map([...states].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Height a step series with `laneCount` states spans above its lowest lane, in y units. */
export function stepLanesHeight(laneCount: number): number {
  return Math.max(0, Math.min(laneCount, MAX_LANES) - 1) * LANE_SPACING;
}

/**
 * Moves every point of a step series onto its state's lane, the highest lane at `topY`. Points
 * are updated in place (live datasets share them with their cache); each call sets every point,
 * so lanes stay right when a new state shows up. A thinned `[...]` point stays on the lane before
 * it; gaps keep their NaN y.
 */
export function applyStepLanes(datasets: readonly ChartDataset[], topY: number): StepLane[] {
  const states = distinctStates(datasets);
  // ponytail: past MAX_LANES, states share a fixed height by rank; their labels then overlap.
  const spacing =
    states.size > MAX_LANES ? (LANE_SPACING * (MAX_LANES - 1)) / (states.size - 1) : LANE_SPACING;
  const bottomY = topY - (states.size - 1) * spacing;
  const laneY = new Map<ValidQueriedDataValue, number>();
  const lanes: StepLane[] = [];
  for (const [value, state] of states) {
    const y = bottomY + lanes.length * spacing;
    laneY.set(value, y);
    lanes.push({ y, ...state });
  }
  for (const dataset of datasets) {
    let lastY = topY;
    for (const datum of dataset.data) {
      if (datum == undefined || Number.isNaN(datum.y)) {
        continue;
      }
      datum.y = datum.value != undefined ? (laneY.get(datum.value) ?? lastY) : lastY;
      lastY = datum.y;
    }
  }
  return lanes;
}
