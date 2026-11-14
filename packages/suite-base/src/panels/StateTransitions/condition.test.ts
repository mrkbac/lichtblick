// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec } from "@foxglove/rostime";

import { MessagePathDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import {
  PathSample,
  toPathSample,
} from "@lichtblick/suite-base/components/MessagePathSyntax/usePathSampleHistory";
import { addMatchStarts } from "@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsData";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";

import { conditionMatches, parseCondition } from "./condition";
import { messagesToDataset } from "./messagesToDataset";

const sample = ({
  messageEvent,
  queriedData,
}: {
  messageEvent: MessageEvent;
  queriedData: MessagePathDataItem[];
}): PathSample => toPathSample(messageEvent, queriedData);

describe("parseCondition", () => {
  it.each([
    ["> 2", ">", 2],
    ["<=-1.5", "<=", -1.5],
    ['== "ERROR"', "==", "ERROR"],
    ["!= 'a b'", "!=", "a b"],
    ["== ERROR", "==", "ERROR"],
    ["== true", "==", 1],
    ["!= false", "!=", 0],
  ])("parses %s", (input, operator, value) => {
    expect(parseCondition(input)).toMatchObject({
      type: "filter",
      path: [],
      operator,
      value,
    });
  });

  it.each([undefined, "", "2", "=> 2", "== ", "~ 1", '== "ERROR', "> 1 2", "== a > b", "== 'x\""])(
    "rejects %s",
    (input) => {
      expect(parseCondition(input)).toBeUndefined();
    },
  );
});

describe("conditionMatches", () => {
  const matches = (condition: string, value: number | string | boolean | bigint, name?: string) =>
    conditionMatches(parseCondition(condition)!, value, name);

  it("compares numbers, strings, bools and bigints", () => {
    expect(matches("> 2", 2.5)).toBe(true);
    expect(matches("> 2", 2)).toBe(false);
    expect(matches(">= 2", 2n)).toBe(true);
    expect(matches("== 9007199254740993", 9007199254740993n)).toBe(true);
    expect(matches("== 9007199254740993", 9007199254740992n)).toBe(false);
    expect(matches('== "ERROR"', "ERROR")).toBe(true);
    expect(matches("!= ERROR", "OK")).toBe(true);
    expect(matches("== true", true)).toBe(true);
    expect(matches("== false", true)).toBe(false);
  });

  it("matches string literals against the enum constant name", () => {
    expect(matches("== ERROR", 3, "ERROR")).toBe(true);
    expect(matches("!= ERROR", 3, "ERROR")).toBe(false);
    expect(matches("== 3", 3, "ERROR")).toBe(true);
    expect(matches('== "3"', 3, "ERROR")).toBe(true);
    expect(matches('!= "3"', 3, "ERROR")).toBe(false);
    expect(matches("!= OK", 3, "ERROR")).toBe(true);
  });
});

describe("condition bands", () => {
  const startTime = { sec: 0, nsec: 0 };
  const blocks: PathSample[] = [1, 3, 4, 1, 5, 0].map((value, i) =>
    sample({
      messageEvent: MessageEventBuilder.messageEvent({ receiveTime: fromSec(i) }),
      queriedData: [{ value, path: "/a.b" }],
    }),
  );

  it("turns values into true/false segments and collects where they turn true", () => {
    const dataset = messagesToDataset({
      path: { value: "/a.b", condition: "> 2", timestampMethod: "receiveTime" },
      startTime,
      y: 0,
      pathIndex: 0,
      blocks: [blocks],
      showPoints: false,
    });

    expect(dataset.data.map((datum) => [datum?.x, datum?.value, datum?.label])).toEqual([
      [0, false, "false"],
      [1, true, "true"],
      [3, false, "false"],
      [4, true, "true"],
      [5, false, "false"],
    ]);

    const starts = new Set<number>();
    addMatchStarts(dataset, starts);
    expect([...starts]).toEqual([1, 4]);
  });
});
