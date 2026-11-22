// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";
import { useMemo } from "react";

import { PathSampleColumns } from "@lichtblick/suite-base/components/MessagePathSyntax/PathSampleColumns";
import {
  ChartDataset,
  ChartDatasets,
} from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { parseCondition } from "@lichtblick/suite-base/panels/StateTransitions/condition";
import {
  ROW_MARGIN,
  ROW_SPACING,
} from "@lichtblick/suite-base/panels/StateTransitions/hooks/constants";
import { UseStateTransitionsData } from "@lichtblick/suite-base/panels/StateTransitions/hooks/types";
import { messagesToDataset } from "@lichtblick/suite-base/panels/StateTransitions/messagesToDataset";
import { datasetContainsArray } from "@lichtblick/suite-base/panels/StateTransitions/shared";
import {
  MessageDatasetArgs,
  PathState,
  SamplesByPath,
  StateTransitionPath,
} from "@lichtblick/suite-base/panels/StateTransitions/types";

/** Collects the x of every segment where a condition series turns true (within `keep`). */
export function addMatchStarts(
  dataset: ChartDataset,
  out: Set<number>,
  keep: (x: number) => boolean = () => true,
): void {
  for (const datum of dataset.data) {
    if (datum?.value === true && datum.label != undefined && keep(datum.x)) {
      out.add(datum.x);
    }
  }
}

/**
 * Adds the matches in `blocks`, whose chart is `drawn`. Thinned samples can merge matches, so
 * they come from the exact record of changes; where that record forgot its oldest changes, the
 * drawn samples fill in before it.
 */
function addMatches(
  blocks: readonly (PathSampleColumns | undefined)[],
  drawn: ChartDataset,
  args: Omit<MessageDatasetArgs, "blocks">,
  out: Set<number>,
): void {
  const changeBlocks = blocks.map((samples) => samples?.changes());
  if (changeBlocks.every((changes, i) => changes === blocks[i])) {
    addMatchStarts(drawn, out);
    return;
  }
  const exact = messagesToDataset({ ...args, blocks: changeBlocks, showPoints: false });
  if (blocks.every((samples) => samples?.hasAllChanges() !== false)) {
    addMatchStarts(exact, out);
    return;
  }
  // The record's first sample only carries the state from before its oldest kept change, so
  // a match there would be made up by the cut: take matches up to it from the drawn samples.
  const cutX = exact.data.find((datum) => datum != undefined)?.x ?? Infinity;
  addMatchStarts(exact, out, (x) => x > cutX);
  addMatchStarts(drawn, out, (x) => x <= cutX);
}

function useStateTransitionsData(
  paths: StateTransitionPath[],
  startTime: Readonly<Time> | undefined,
  itemsByPath: SamplesByPath,
  decodedBlocks: readonly SamplesByPath[],
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  showPoints: boolean,
  colorScheme: "light" | "dark" = "dark",
): UseStateTransitionsData {
  // Light segment colors need darker label text on a light background.
  const darkenLabels = colorScheme === "light";
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

      const hasCondition = parseCondition(path.condition) != undefined;
      const blocksForPath = decodedBlocks.map((decodedBlock) => decodedBlock[path.value]);

      const datasetArgs = { path, pathIndex, startTime, y, showPoints, darkenLabels };
      const newBlockDataSet = messagesToDataset({ ...datasetArgs, blocks: blocksForPath });

      const items = itemsByPath[path.value];
      const isArray = datasetContainsArray([...blocksForPath, items]);

      outPathState.push({
        path,
        isArray,
      });
      outDatasets.push(newBlockDataSet);
      if (hasCondition) {
        addMatches(blocksForPath, newBlockDataSet, datasetArgs, matchStarts);
      }

      if (items == undefined) {
        return;
      }

      const newPathDataSet = messagesToDataset({ ...datasetArgs, blocks: [items] });
      outDatasets.push(newPathDataSet);
      if (hasCondition) {
        addMatches([items], newPathDataSet, datasetArgs, matchStarts);
      }
    });

    return {
      data: { datasets: outDatasets },
      minY: outMinY,
      pathState: outPathState,
      matchStarts: [...matchStarts].sort((a, b) => a - b),
    };
  }, [decodedBlocks, itemsByPath, paths, startTime, showPoints, darkenLabels]);
}

export default useStateTransitionsData;
