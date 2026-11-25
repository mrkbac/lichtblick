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
import {
  StateTransitionRow,
  UseStateTransitionsData,
} from "@lichtblick/suite-base/panels/StateTransitions/hooks/types";
import {
  LiveDatasetCache,
  messagesToDataset,
} from "@lichtblick/suite-base/panels/StateTransitions/messagesToDataset";
import { datasetContainsArray } from "@lichtblick/suite-base/panels/StateTransitions/shared";
import {
  STEP_LINE_WIDTH,
  StepLane,
  applyStepLanes,
  stepLanesHeight,
} from "@lichtblick/suite-base/panels/StateTransitions/stepLanes";
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
  liveCache?: LiveDatasetCache,
): boolean {
  const approximate = blocks.some((samples) => samples?.hasAllChanges() === false);
  const changeBlocks = blocks.map((samples) => samples?.changes());
  if (changeBlocks.every((changes, i) => changes === blocks[i])) {
    addMatchStarts(drawn, out);
    return approximate;
  }
  const exact = messagesToDataset({ ...args, blocks: changeBlocks, showPoints: false }, liveCache);
  if (!approximate) {
    addMatchStarts(exact, out);
    return false;
  }
  // The record only starts at its oldest kept change: matches before it come from the drawn
  // samples. (Its first sample carries the state from before the cut and is never a match.)
  const firstChangeX = exact.data.find((datum) => datum != undefined)?.x ?? Infinity;
  addMatchStarts(exact, out);
  addMatchStarts(drawn, out, (x) => x < firstChangeX);
  return true;
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
  const liveCaches = useMemo<{ drawn: LiveDatasetCache; exact: LiveDatasetCache }[]>(
    () => paths.map(() => ({ drawn: {}, exact: {} })),
    [paths],
  );
  return useMemo(() => {
    // ignore all data when we don't have a start time
    if (!startTime) {
      return {
        data: { datasets: [] },
        datasetPathIndexes: [],
        minY: undefined,
        // Keep the legend's rows apart until data arrives.
        rows: paths.map((_, index) => ({ top: -index * ROW_SPACING, span: ROW_SPACING })),
        pathState: [],
        matchStarts: [],
        matchesApproximate: false,
      };
    }

    let outMinY: number | undefined;
    const outDatasets: ChartDatasets = [];
    const datasetPathIndexes: number[] = [];
    const outPathState: PathState[] = [];
    const rows: StateTransitionRow[] = [];
    let rowTop = 0;
    const matchStarts = new Set<number>();
    let matchesApproximate = false;

    paths.forEach((path, pathIndex) => {
      // A bar sits here; a step series puts its highest state here and adds lanes below.
      const y = rowTop - ROW_SPACING;
      const pathDatasets: ChartDataset[] = [];

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
      pathDatasets.push(newBlockDataSet);
      if (hasCondition) {
        matchesApproximate =
          addMatches(blocksForPath, newBlockDataSet, datasetArgs, matchStarts) ||
          matchesApproximate;
      }

      const cache = liveCaches[pathIndex]!;
      if (items == undefined) {
        cache.drawn.checkpoint = undefined;
        cache.exact.checkpoint = undefined;
      } else {
        const newPathDataSet = messagesToDataset({ ...datasetArgs, blocks: [items] }, cache.drawn);
        pathDatasets.push(newPathDataSet);
        if (hasCondition) {
          matchesApproximate =
            addMatches([items], newPathDataSet, datasetArgs, matchStarts, cache.exact) ||
            matchesApproximate;
        }
      }

      let lanes: StepLane[] | undefined;
      if (path.display === "step") {
        lanes = applyStepLanes(pathDatasets, y);
        for (const dataset of pathDatasets) {
          dataset.stepped = true;
          dataset.borderWidth = STEP_LINE_WIDTH;
        }
      }
      const span = ROW_SPACING + stepLanesHeight(lanes?.length ?? 0);
      rows.push({ top: rowTop, span, lanes });
      rowTop -= span;
      outMinY = rowTop - ROW_MARGIN;
      for (const dataset of pathDatasets) {
        outDatasets.push(dataset);
        datasetPathIndexes.push(pathIndex);
      }
    });

    return {
      data: { datasets: outDatasets },
      datasetPathIndexes,
      minY: outMinY,
      rows,
      pathState: outPathState,
      matchStarts: [...matchStarts].sort((a, b) => a - b),
      matchesApproximate,
    };
  }, [decodedBlocks, itemsByPath, paths, startTime, showPoints, darkenLabels, liveCaches]);
}

export default useStateTransitionsData;
