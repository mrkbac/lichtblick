// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import { ChartDatasets } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { createLabel } from "@lichtblick/suite-base/panels/StateTransitions/messagesToDataset";
import { getValueAtTime } from "@lichtblick/suite-base/panels/shared/getValueAtTime";
import { DeltaMarkerSeriesValue } from "@lichtblick/suite-base/panels/shared/types";
import useDeltaMarkerState, {
  UseDeltaMarkerStateResult,
} from "@lichtblick/suite-base/panels/shared/useDeltaMarkerState";

export type UseStateTransitionsDeltaModeProps = {
  datasets: ChartDatasets;
  /** The path each dataset belongs to; live mode adds a second dataset per path. */
  datasetPathIndexes: readonly number[];
  /** Markers are cleared (but the mode stays active) whenever this value changes. */
  resetKey?: string;
};

function useStateTransitionsDeltaMode({
  datasets,
  datasetPathIndexes,
  resetKey,
}: UseStateTransitionsDeltaModeProps): UseDeltaMarkerStateResult & {
  handleChartClick: (xValue: number) => void;
} {
  const state = useDeltaMarkerState({ resetKey });
  const { active, nextMarkerSlot, setMarker } = state;

  const handleChartClick = useCallback(
    (xValue: number) => {
      if (!active) {
        return;
      }

      const seriesValues: DeltaMarkerSeriesValue[] = [];
      datasets.forEach((dataset, datasetIndex) => {
        const configIndex = datasetPathIndexes[datasetIndex];
        if (configIndex == undefined || seriesValues.some((v) => v.configIndex === configIndex)) {
          return;
        }
        const valueAtTime = getValueAtTime(dataset.data, xValue);
        if (valueAtTime) {
          seriesValues.push({
            configIndex,
            value: createLabel(valueAtTime.constantName, valueAtTime.value),
          });
        }
      });

      if (seriesValues.length === 0) {
        return;
      }

      setMarker(nextMarkerSlot(), { xValue, seriesValues });
    },
    [active, datasets, datasetPathIndexes, nextMarkerSlot, setMarker],
  );

  return { ...state, handleChartClick };
}

export default useStateTransitionsDeltaMode;
