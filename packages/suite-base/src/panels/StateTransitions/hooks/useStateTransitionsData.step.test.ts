/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import { PathSampleColumns } from "@lichtblick/suite-base/components/MessagePathSyntax/PathSampleColumns";
import { StateTransitionPath } from "@lichtblick/suite-base/panels/StateTransitions/types";

import useStateTransitionsData from "./useStateTransitionsData";

function columnsOf(values: (number | string | null)[]): PathSampleColumns {
  const columns = new PathSampleColumns(100);
  values.forEach((value, i) => {
    columns.push({
      receiveTime: { sec: i, nsec: 0 },
      headerStamp: undefined,
      count: 1,
      value,
      constantName: undefined,
    });
  });
  return columns;
}

function render(paths: StateTransitionPath[], samples: Record<string, PathSampleColumns>) {
  return renderHook(() => useStateTransitionsData(paths, { sec: 0, nsec: 0 }, {}, [samples], false))
    .result.current;
}

describe("useStateTransitionsData step display", () => {
  it("puts numeric states on lanes ordered by value and draws a stepped line", () => {
    const path: StateTransitionPath = {
      value: "/a.b",
      timestampMethod: "receiveTime",
      display: "step",
    };
    const result = render([path], { "/a.b": columnsOf([2, 0, 1, 2, null, 0]) });
    const lanes = result.rows[0]!.lanes!;
    expect(lanes.map((lane) => lane.label)).toEqual(["0", "1", "2"]);
    // The highest state sits where a bar would; lower ones step down.
    expect(lanes.map((lane) => lane.y)).toEqual([-13, -11, -9]);
    const dataset = result.data.datasets[0]!;
    expect(dataset.stepped).toBe(true);
    const laneOf = new Map(lanes.map((lane) => [lane.label, lane.y]));
    const states = dataset.data.filter((datum) => datum?.value != undefined);
    expect(states.length).toBeGreaterThan(0);
    expect(states.map((datum) => datum!.y)).toEqual(
      states.map((datum) => laneOf.get(String(datum!.value))),
    );
    // The gap stays a gap.
    expect(dataset.data.some((datum) => datum != undefined && Number.isNaN(datum.y))).toBe(true);
    expect(result.rows[0]).toMatchObject({ top: 0, span: 13 });
  });

  it("keeps string states in first-seen order and stacks rows below a step row", () => {
    const paths: StateTransitionPath[] = [
      { value: "/a.s", timestampMethod: "receiveTime", display: "step" },
      { value: "/a.b", timestampMethod: "receiveTime" },
    ];
    const result = render(paths, {
      "/a.s": columnsOf(["IDLE", "RUN", "ERROR", "IDLE"]),
      "/a.b": columnsOf([1, 2]),
    });
    expect(result.rows[0]!.lanes!.map((lane) => lane.label)).toEqual(["IDLE", "RUN", "ERROR"]);
    // The bar row starts where the step row ends.
    expect(result.rows[1]).toEqual({ top: -13, span: 9, lanes: undefined });
    expect(result.data.datasets[1]!.data[0]!.y).toBe(-22);
    expect(result.minY).toBe(-24.25);
  });

  it("leaves bar series as they were", () => {
    const path: StateTransitionPath = { value: "/a.b", timestampMethod: "receiveTime" };
    const result = render([path], { "/a.b": columnsOf([2, 0, 1]) });
    expect(result.rows).toEqual([{ top: 0, span: 9, lanes: undefined }]);
    expect(result.data.datasets[0]!.stepped).toBeUndefined();
    expect(result.data.datasets[0]!.data.every((datum) => datum?.y === -9)).toBe(true);
  });
});
