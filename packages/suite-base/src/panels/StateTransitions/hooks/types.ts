// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChartDatasets } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { StepLane } from "@lichtblick/suite-base/panels/StateTransitions/stepLanes";
import { PathState } from "@lichtblick/suite-base/panels/StateTransitions/types";

/** Where a series sits on the y axis: rows stack down from 0, in y units. */
export type StateTransitionRow = {
  top: number;
  span: number;
  /** The states of a step series, one lane each. */
  lanes?: StepLane[];
};

export type UseStateTransitionsData = {
  pathState: PathState[];
  data: {
    datasets: ChartDatasets;
  };
  /** Index into `paths` for each entry of `data.datasets` (a path can have two datasets). */
  datasetPathIndexes: number[];
  minY: number | undefined;
  /** One per path. */
  rows: StateTransitionRow[];
  /** Sorted seconds-since-start where any condition series becomes true. */
  matchStarts: number[];
  /** Older history has been thinned past the budget for exact matches. */
  matchesApproximate: boolean;
};
