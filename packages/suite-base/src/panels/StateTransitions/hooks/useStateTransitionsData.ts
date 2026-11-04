// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useMemo } from "react";

import { Time } from "@lichtblick/rostime";
import { MessageDataItemsByPath } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  ChartDataset,
  ChartDatasets,
} from "@lichtblick/suite-base/components/TimeBasedChart/types";
import {
  ROW_MARGIN,
  ROW_SPACING,
} from "@lichtblick/suite-base/panels/StateTransitions/hooks/constants";
import { UseStateTransitionsData } from "@lichtblick/suite-base/panels/StateTransitions/hooks/types";
import { messagesToDataset } from "@lichtblick/suite-base/panels/StateTransitions/messagesToDataset";
import { datasetContainsArray } from "@lichtblick/suite-base/panels/StateTransitions/shared";
import {
  PathState,
  StateTransitionPath,
} from "@lichtblick/suite-base/panels/StateTransitions/types";

/** Collects the x of every segment where a condition series turns true. */
export function addMatchStarts(dataset: ChartDataset, out: Set<number>): void {
  for (const datum of dataset.data) {
    if (datum?.value === true && datum.label != undefined) {
      out.add(datum.x);
    }
  }
}

function useStateTransitionsData(
  paths: StateTransitionPath[],
  startTime: Readonly<Time> | undefined,
  itemsByPath: MessageDataItemsByPath,
  decodedBlocks: MessageDataItemsByPath[],
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  showPoints: boolean,
): UseStateTransitionsData {
  return useMemo(() => {
    // ignore all data when we don't have a start time
    if (!startTime) {
      return {
        data: { datasets: [] },
        minY: undefined,
        pathState: [],
        matchStarts: [],
      };
    }

    let outMinY: number | undefined;
    const outDatasets: ChartDatasets = [];
    const outPathState: PathState[] = [];
    const matchStarts = new Set<number>();

    paths.forEach((path, pathIndex) => {
      const y = -(pathIndex + 1) * ROW_SPACING;
      outMinY = Math.min(outMinY ?? y, y - ROW_MARGIN);

      const blocksForPath = decodedBlocks.map((decodedBlock) => decodedBlock[path.value]);

      const newBlockDataSet = messagesToDataset({
        blocks: blocksForPath,
        path,
        pathIndex,
        startTime,
        y,
        showPoints,
      });

      const items = itemsByPath[path.value];
      const isArray = datasetContainsArray([...blocksForPath, items]);

      outPathState.push({
        path,
        isArray,
      });
      outDatasets.push(newBlockDataSet);
      if (path.condition) {
        addMatchStarts(newBlockDataSet, matchStarts);
      }

      if (items == undefined) {
        return;
      }

      const newPathDataSet = messagesToDataset({
        blocks: [items],
        path,
        pathIndex,
        startTime,
        y,
        showPoints,
      });
      outDatasets.push(newPathDataSet);
      if (path.condition) {
        addMatchStarts(newPathDataSet, matchStarts);
      }
    });

    return {
      data: { datasets: outDatasets },
      minY: outMinY,
      pathState: outPathState,
      matchStarts: [...matchStarts].sort((a, b) => a - b),
    };
  }, [decodedBlocks, itemsByPath, paths, startTime, showPoints]);
}

export default useStateTransitionsData;
