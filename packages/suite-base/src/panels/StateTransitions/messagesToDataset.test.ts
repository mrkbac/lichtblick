// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { darken } from "@mui/material";

import { MessageEvent } from "@lichtblick/suite";
import {
  PathSample,
  PathSampleColumns,
  toPathSample,
} from "@lichtblick/suite-base/components/MessagePathSyntax/PathSampleColumns";
import { MessagePathDataItem } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";
import RosTimeBuilder from "@lichtblick/suite-base/testing/builders/RosTimeBuilder";
import { TimestampMethod } from "@lichtblick/suite-base/util/time";
import { BasicBuilder } from "@lichtblick/test-builders";

import {
  isValidValue,
  getColor,
  createLabel,
  baseColors,
  LiveDatasetCache,
  messagesToDataset,
} from "./messagesToDataset";
import { MessageDatasetArgs, StateTransitionPath } from "./types";

const sample = ({
  messageEvent,
  queriedData,
}: {
  messageEvent: MessageEvent;
  queriedData: MessagePathDataItem[];
}): PathSample => toPathSample(messageEvent, queriedData);

const messageEvent = MessageEventBuilder.messageEvent({
  topic: "/test/message_topic_test",
  schemaName: "Unit.test.SchemaName",
  message: {
    test_property1: false,
    test_property2: undefined,
    test_property3: false,
    test_property4: undefined,
    test_property5: false,
    test_property6: undefined,
    test_property7: false,
    test_property8: undefined,
    test_property9: false,
    test_property0: 0,
    test_property11: false,
  },
});

const path: StateTransitionPath = {
  label: "Test Label",
  value: "/test/debug/unitTest.",
  timestampMethod: BasicBuilder.sample(["receiveTime", "headerStamp"] as TimestampMethod[]),
};

function MessageAndDataBuilder(
  messageEventInput: MessageEvent,
  value: number,
  pathInput: string,
  constantName: string,
): PathSample {
  return sample({
    messageEvent: messageEventInput,
    queriedData: [{ value, path: pathInput, constantName }],
  });
}

let queriedDataValue: number;
let queriedDataName: string;
let queriedDataPath: string;
let constName: string | undefined;

describe("incremental live datasets", () => {
  it.each([false, true])("matches a full rebuild with showPoints=%s", (showPoints) => {
    const active = new PathSampleColumns(16);
    active.trackChanges();
    const drawnCache: LiveDatasetCache = {};
    const exactCache: LiveDatasetCache = {};
    const args = {
      startTime: { sec: 100, nsec: 0 },
      pathIndex: 0,
      path: { value: "/topic.state", condition: "== 1", timestampMethod: "headerStamp" as const },
      y: -9,
      showPoints,
    };

    for (let next = 0; next < 380; next += 3) {
      for (let i = next; i < next + 3; i++) {
        active.push({
          receiveTime: { sec: 100 + i, nsec: 0 },
          headerStamp: i % 5 === 0 ? undefined : { sec: 100 + i, nsec: 0 },
          count: i % 11 === 0 ? 2 : 1,
          value: i % 7 < 2 ? null : i % 3,
          constantName: undefined,
        });
      }
      for (const [block, cache] of [
        [active, drawnCache],
        [active.changes(), exactCache],
      ] as const) {
        const input = { ...args, blocks: [block] };
        expect(messagesToDataset(input, cache)).toEqual(messagesToDataset(input));
      }
    }
    expect(active.hasAllChanges()).toBe(false);
  });

  it("converts only new samples and the mutable tail on a dense live redraw", () => {
    const active = new PathSampleColumns(100_000);
    const append = (i: number) => {
      active.push({
        receiveTime: { sec: i, nsec: 0 },
        headerStamp: undefined,
        count: 1,
        value: i % 2,
        constantName: undefined,
      });
    };
    for (let i = 0; i < 99_990; i++) {
      append(i);
    }
    const args = {
      startTime: { sec: 0, nsec: 0 },
      pathIndex: 0,
      path: { value: "/topic.state", timestampMethod: "receiveTime" as const },
      y: -9,
      blocks: [active],
      showPoints: false,
    };
    const cache: LiveDatasetCache = {};
    const first = messagesToDataset(args, cache);

    const sampleValue = vi.spyOn(active, "sampleValue");
    for (let i = 99_990; i < 99_995; i++) {
      append(i);
    }

    const second = messagesToDataset(args, cache);
    expect(sampleValue).toHaveBeenCalledTimes(7);
    expect(first.data).toHaveLength(99_990);
    expect(second.data).toHaveLength(99_995);
  });
});

describe("messagesToDataset helper functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constName = BasicBuilder.string();
  });

  // unit tests for isValidValue
  it("should return false for object, not a valid value", () => {
    const value = {};
    expect(isValidValue(value)).toBe(false);
  });

  it("should return true for number", () => {
    const value = BasicBuilder.number();
    expect(isValidValue(value)).toBe(true);
  });

  it("should return true for string", () => {
    const value = BasicBuilder.string();
    expect(isValidValue(value)).toBe(true);
  });

  it("should return true for bigInt", () => {
    const value = BasicBuilder.bigInt();
    expect(isValidValue(value)).toBe(true);
  });

  it("should return true for boolean", () => {
    const value = BasicBuilder.boolean();
    expect(isValidValue(value)).toBe(true);
  });

  it("should return false for undefined, not a valid value", () => {
    const value = undefined;
    expect(isValidValue(value)).toBe(false);
  });

  it("should return false for NaN, not a valid value", () => {
    const value = NaN;
    expect(isValidValue(value)).toBe(false);
  });

  it("should return false for an object, not a valid value", () => {
    const value = {};
    expect(isValidValue(value)).toBe(false);
  });

  // unit tests for getColorForValue

  it("should return a color for a string input", () => {
    const value = BasicBuilder.string();
    const result = getColor(value);

    expect(baseColors).toContain(result);
  });

  it("should return a color for a number input", () => {
    const value = BasicBuilder.number();
    const result = getColor(value);

    expect(baseColors).toContain(result);
  });

  it("should return a color for a boolean input", () => {
    const value = BasicBuilder.boolean();
    const result = getColor(value);

    expect(baseColors).toContain(result);
  });

  it("should return a color for a bigInt input", () => {
    const value = BasicBuilder.bigInt();
    const result = getColor(value);

    expect(baseColors).toContain(result);
  });

  // unit tests for createLabel

  it("should return the label with constant name and value when constantName is string type", () => {
    const value = BasicBuilder.number();
    const result = createLabel(constName, value);

    expect(result).toBe(`${constName} (${String(value)})`);
  });

  it("should return the label only with value when constantName is undefined", () => {
    constName = undefined;
    const value = BasicBuilder.number();
    const result = createLabel(constName, value);

    expect(result).toBe(String(value));
  });

  it("should return the label with constant name and value when constantName is boolean type", () => {
    const value = BasicBuilder.boolean();
    const result = createLabel(constName, value);

    expect(result).toBe(`${constName} (${String(value)})`);
  });

  it("should return the label with constant name and value when constantName is number type", () => {
    const value = BasicBuilder.number();
    const result = createLabel(constName, value);

    expect(result).toBe(`${constName} (${String(value)})`);
  });

  it("should return the label with constant name and value when constantName is bigInt type", () => {
    const value = BasicBuilder.bigInt();
    const result = createLabel(constName, value);

    expect(result).toBe(`${constName} (${String(value)})`);
  });
});

describe("messagesToDataset", () => {
  const args = {
    path,
    startTime: RosTimeBuilder.time(),
    y: BasicBuilder.number(),
    pathIndex: BasicBuilder.number(),
    blocks: [],
    showPoints: false,
    timestampMethod: path,
  };

  beforeEach(() => {
    queriedDataValue = BasicBuilder.number();
    queriedDataName = BasicBuilder.string();
    queriedDataPath = BasicBuilder.string();
  });

  it("should initialize dataset with default properties", () => {
    const result = messagesToDataset(args);

    expect(result).toEqual(
      expect.objectContaining({
        borderWidth: 10,
        data: [],
        label: args.path.label,
        pointBackgroundColor: "rgba(0, 0, 0, 0.4)",
        pointBorderColor: "transparent",
        pointHoverRadius: 3,
        pointRadius: 0,
        pointStyle: "circle",
        showLine: true,
      }),
    );
  });

  it("should return an empty data array if blocks are empty", () => {
    const result = messagesToDataset({ ...args, blocks: [] });
    expect(result.data).toEqual([]);
  });

  it("should add data points when blocks contain valid messages", () => {
    //forcing path.timestampMethod to be receiveTime for this specific unit test, headerStamp wont work here
    const blocks: PathSample[][] = [
      [MessageAndDataBuilder(messageEvent, queriedDataValue, queriedDataPath, queriedDataName)],
    ];
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "receiveTime" },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
    };

    const result = messagesToDataset(argsDataset);

    expect(result.data[0]).toStrictEqual({
      x: expect.any(Number),
      y: args.y,
      label: `${queriedDataName} (${queriedDataValue})`,
      labelColor: expect.any(String),
      value: queriedDataValue,
      constantName: queriedDataName,
    });
  });

  it("darkens label text, not the line, when asked to", () => {
    const blocks: PathSample[][] = [
      [MessageAndDataBuilder(messageEvent, queriedDataValue, queriedDataPath, queriedDataName)],
    ];

    const [datum] = messagesToDataset({
      ...args,
      path: { ...args.path, timestampMethod: "receiveTime" },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
      darkenLabels: true,
    }).data;

    expect(datum?.labelTextColor).toBe(darken(datum!.labelColor!, 0.45));
    expect(datum?.labelTextColor).not.toBe(datum?.labelColor);
  });

  it("should return undefined because getTimestampForMessageEvent will return undefined", () => {
    //forcing path.timestampMethod to be headerStamp without headers in the message
    //so getTimestampForMessageEvent returns undefined
    const blocks: PathSample[][] = [
      [
        MessageAndDataBuilder(
          { ...messageEvent, message: { header: undefined } },
          queriedDataValue,
          queriedDataPath,
          queriedDataName,
        ),
      ],
    ];
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "headerStamp" },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
    };

    const result = messagesToDataset(argsDataset);

    expect(result.data.length).toBe(0);
  });

  it("should return dataset with 1 item on data[] because getTimestampForMessageEvent is called with headerStamp with header", () => {
    //forcing path.timestampMethod to be headerStamp with header in the message
    //so getTimestampForMessageEvent returns a stamp and therefore a item is added to data[] inisde the ChartDataset object returned
    const blocks: PathSample[][] = [
      [
        MessageAndDataBuilder(
          { ...messageEvent, message: { header: { stamp: RosTimeBuilder.time() } } },
          queriedDataValue,
          queriedDataPath,
          queriedDataName,
        ),
      ],
    ];
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "headerStamp", label: undefined },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
    };

    const result = messagesToDataset(argsDataset);

    expect(result.data.length).toBe(1);
    expect(result.label).toBe(args.path.value);
  });

  it("should return dataset with no data since blocks doesn't have any message", () => {
    //forcing path.timestampMethod to be receiveTime for this specific unit test, headerStamp wont work here
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "receiveTime" },
      blocks: [],
    };

    const result = messagesToDataset(argsDataset);
    expect(result.data.length).toBe(0);
  });

  it("should return dataset with no data since queriedData is empty and therefore the sample has no single value", () => {
    const blocks: PathSample[][] = [
      [
        sample({
          messageEvent,
          queriedData: [],
        }),
      ],
    ];
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "receiveTime" },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
    };

    const result = messagesToDataset(argsDataset);

    expect(result.data.length).toBe(0);
  });

  it("should return dataset with no data since queriedData has more than one item and therefore the sample has no single value", () => {
    const blocks: PathSample[][] = [
      [
        sample({
          messageEvent,
          queriedData: [
            { value: queriedDataValue, path: queriedDataPath },
            { value: queriedDataValue, path: queriedDataPath },
          ],
        }),
      ],
    ];
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "receiveTime" },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
    };

    const result = messagesToDataset(argsDataset);

    expect(result.data.length).toBe(0);
  });

  it("should return dataset with no data since queriedData.value is typeof NaN", () => {
    const blocks: PathSample[][] = [
      [
        sample({
          messageEvent,
          queriedData: [{ value: NaN, path: queriedDataPath }],
        }),
      ],
    ];
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "receiveTime" },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
    };

    const result = messagesToDataset(argsDataset);

    expect(result.data.length).toBe(0);
  });

  it("should treat a null value as a gap and emit a NaN datum", () => {
    const blocks: PathSample[][] = [
      [
        sample({
          messageEvent,
          queriedData: [{ value: null, path: queriedDataPath }],
        }),
      ],
    ];
    const argsDataset: MessageDatasetArgs = {
      ...args,
      path: { ...args.path, timestampMethod: "receiveTime" },
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
    };

    const result = messagesToDataset(argsDataset);

    expect(result.data).toEqual([{ x: expect.any(Number), y: NaN }]);
  });

  it("should not assign a label to repeated consecutive data points", () => {
    const messageAndData = sample({
      messageEvent,
      queriedData: [{ value: queriedDataValue, path: queriedDataPath }],
    });

    const blocks: PathSample[][] = [[messageAndData, messageAndData]];

    const result = messagesToDataset({
      ...args,
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
      path: { ...args.path, timestampMethod: "receiveTime" },
    });

    expect(result.data[1]?.label).toBeUndefined();
  });

  it("should push lastDatum to dataset.data if isNewSegment is true but showPoints false and result.pointRadius to be 0", () => {
    const blocks = [
      undefined,
      [
        sample({
          messageEvent,
          queriedData: [{ value: queriedDataValue, path: queriedDataPath }],
        }),
      ],
    ];

    const result = messagesToDataset({
      ...args,
      blocks: blocks.map((block) => block && PathSampleColumns.from(block)),
      path: { ...args.path, timestampMethod: "receiveTime" },
    });

    expect(result.data.length).toBe(1);
    expect(result.data[0]).toEqual(expect.objectContaining({ value: queriedDataValue }));
    expect(result.pointRadius).toBe(0);
  });

  it("should push lastDatum to dataset.data if isNewSegment is false but showPoints true meaning the label on the second object on result.data is undefined", () => {
    const blocks = [
      [
        sample({
          messageEvent,
          queriedData: [{ value: queriedDataValue, path: queriedDataPath }],
        }),
      ],
    ];

    const result = messagesToDataset({
      ...args,
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
      path: { ...args.path, timestampMethod: "receiveTime" },
      showPoints: true,
    });

    expect(result.data[1]?.label).toBe(undefined);
  });

  it("should keep lastDatum undefined", () => {
    const blocks = [
      [
        sample({
          messageEvent,
          queriedData: [{ value: undefined, path: queriedDataPath }],
        }),
      ],
    ];

    const result = messagesToDataset({
      ...args,
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
      path: { ...args.path, timestampMethod: "receiveTime" },
    });

    expect(result.data.length).toBe(0);
  });

  it("should only add the first and last messages to result.data with showPoints is false", () => {
    const messageAndData = sample({
      messageEvent,
      queriedData: [{ value: queriedDataValue, path: queriedDataPath }],
    });

    const blocks = [[messageAndData, messageAndData, messageAndData, messageAndData]];

    const result = messagesToDataset({
      ...args,
      blocks: blocks.map((block) => PathSampleColumns.from(block)),
      path: { ...args.path, timestampMethod: "receiveTime" },
      showPoints: false,
    });

    expect(result.data.length).toBe(2);
  });

  it("should preserve the pending state before a gap", () => {
    const repeatedValue = BasicBuilder.number();
    const messageAndData = sample({
      messageEvent,
      queriedData: [{ value: repeatedValue, path: queriedDataPath }],
    });
    const gap = sample({
      messageEvent,
      queriedData: [{ value: null, path: queriedDataPath }],
    });

    const result = messagesToDataset({
      ...args,
      blocks: [PathSampleColumns.from([messageAndData, messageAndData, gap])],
      path: { ...args.path, timestampMethod: "receiveTime" },
      showPoints: false,
    });

    expect(result.data).toEqual([
      expect.objectContaining({ value: repeatedValue }),
      expect.objectContaining({ value: repeatedValue }),
      { x: expect.any(Number), y: NaN },
    ]);
  });

  it("draws the end of a repeated state and doesn't mix up values across blocks", () => {
    const at = (sec: number, value: unknown): PathSample => ({
      receiveTime: { sec, nsec: 0 },
      headerStamp: undefined,
      count: 1,
      value,
      constantName: undefined,
    });
    const result = messagesToDataset({
      ...args,
      startTime: { sec: 0, nsec: 0 },
      path: { ...args.path, timestampMethod: "receiveTime", condition: undefined },
      showPoints: false,
      // Both blocks start with their own first value, so ids alone would say "repeat".
      blocks: [
        PathSampleColumns.from([at(0, 3), at(1, 3), at(2, 3)]),
        PathSampleColumns.from([at(3, "x"), at(4, "x")]),
      ],
    });
    expect(result.data.map((datum) => [datum?.x, datum?.value, datum?.label])).toEqual([
      [0, 3, "3"],
      [3, "x", "x"],
      [4, "x", undefined],
    ]);
  });
});

describe("messagesToDataset of thinned samples", () => {
  it("draws a fast signal merged by thinning as a dense stretch, not a steady state", () => {
    const columns = new PathSampleColumns(100);
    for (let i = 0; i < 10_000; i++) {
      columns.push({
        receiveTime: { sec: i, nsec: 0 },
        headerStamp: undefined,
        count: 1,
        value: i % 2,
        constantName: undefined,
      });
    }
    const dataset = messagesToDataset({
      path: { value: "/a.b", timestampMethod: "receiveTime" },
      startTime: { sec: 0, nsec: 0 },
      y: 0,
      pathIndex: 0,
      blocks: [columns],
      showPoints: false,
    });
    const labels = dataset.data.map((datum) => datum?.label).filter((label) => label != undefined);
    // One dense band (merged stretches in a row continue it); at most the newest, unmerged
    // samples show a plain state.
    expect(labels[0]).toBe("[...]");
    expect(labels.filter((label) => label !== "[...]").length).toBeLessThanOrEqual(2);
    expect(dataset.data.at(-1)?.x).toBe(9_999);
  });
});
