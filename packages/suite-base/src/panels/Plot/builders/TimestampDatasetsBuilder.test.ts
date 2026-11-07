// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { unwrap } from "@lichtblick/den/monads";
import { makeComlinkWorkerMock } from "@lichtblick/den/testing";
import { parseMessagePath } from "@lichtblick/message-path";
import {
  MessageBlock,
  PlayerPresence,
  PlayerState,
  PlayerStateActiveData,
} from "@lichtblick/suite-base/players/types";

import { SeriesConfigKey, SeriesItem } from "./IDatasetsBuilder";
import { readMessagePathItems, TimestampDatasetsBuilder } from "./TimestampDatasetsBuilder";
import { TimestampDatasetsBuilderImpl } from "./TimestampDatasetsBuilderImpl";
import { PlotPath } from "../utils/config";

Object.defineProperty(global, "Worker", {
  writable: true,
  value: makeComlinkWorkerMock(() => new TimestampDatasetsBuilderImpl()),
});

function buildSeriesItems(
  paths: (Partial<PlotPath> & { key?: string; value: string })[],
): SeriesItem[] {
  return paths.map((item, idx) => {
    const parsed = unwrap(parseMessagePath(item.value));
    const key = (item.key ?? String(idx)) as SeriesConfigKey;

    return {
      configIndex: idx,
      parsed,
      color: "red",
      contrastColor: "blue",
      enabled: item.enabled ?? true,
      timestampMethod: item.timestampMethod ?? "receiveTime",
      key,
      lineSize: 1,
      messagePath: item.value,
      showLine: item.showLine ?? true,
    } satisfies SeriesItem;
  });
}

function buildPlayerState(
  activeDataOverride?: Partial<PlayerStateActiveData>,
  blocks?: readonly (MessageBlock | undefined)[],
): PlayerState {
  return {
    activeData: {
      messages: [],
      currentTime: { sec: 0, nsec: 0 },
      endTime: { sec: 0, nsec: 0 },
      lastSeekTime: 1,
      topics: [],
      speed: 1,
      isPlaying: false,
      topicStats: new Map(),
      startTime: { sec: 0, nsec: 0 },
      datatypes: new Map(),
      totalBytesReceived: 0,
      ...activeDataOverride,
    },
    capabilities: [],
    presence: PlayerPresence.PRESENT,
    profile: undefined,
    playerId: "1",
    progress: {
      fullyLoadedFractionRanges: [],
      messageCache: {
        blocks: blocks ?? [],
        startTime: { sec: 0, nsec: 0 },
      },
    },
  };
}

/** A /foo message received at `sec` whose value is `sec` */
function buildFooMessage(sec: number) {
  return {
    topic: "/foo",
    schemaName: "foo",
    receiveTime: { sec, nsec: 0 },
    sizeInBytes: 0,
    message: { val: sec },
  };
}

async function storedXs(builder: TimestampDatasetsBuilder): Promise<number[] | undefined> {
  return (await builder.getCsvData())[0]?.data.map(({ x }) => x);
}

describe("TimestampDatasetsBuilder", () => {
  describe("live sources", () => {
    it("keeps stored x consistent when the start time slides", async () => {
      // Given a live point stored relative to a start time of 10 s
      const builder = new TimestampDatasetsBuilder();
      builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
      builder.handlePlayerState(
        buildPlayerState({ startTime: { sec: 10, nsec: 0 }, messages: [buildFooMessage(12)] }),
      );

      // When the history window drops its oldest second
      builder.handlePlayerState(
        buildPlayerState({ startTime: { sec: 11, nsec: 0 }, messages: [buildFooMessage(13)] }),
      );

      // Then the stored point moves with the start time
      expect(await storedXs(builder)).toEqual([1, 2]);
    });

    it("skips messages replayed after seeking back in the history", async () => {
      // Given points up to 3 s
      const builder = new TimestampDatasetsBuilder();
      builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
      const endTime = { sec: 3, nsec: 0 };
      builder.handlePlayerState(
        buildPlayerState({ endTime, messages: [1, 2, 3].map(buildFooMessage) }),
      );

      // When clicking at 1 s: the source backfills and replays from there, then goes live again
      builder.handlePlayerState(
        buildPlayerState({ lastSeekTime: 2, endTime, messages: [buildFooMessage(1)] }),
      );
      builder.handlePlayerState(
        buildPlayerState({ lastSeekTime: 2, endTime, messages: [2, 3, 4].map(buildFooMessage) }),
      );

      // Then each point is stored once, in order
      expect(await storedXs(builder)).toEqual([1, 2, 3, 4]);
    });

    it("keeps new messages that arrive in the seek frame with replayed ones", async () => {
      // Given points up to 3 s
      const builder = new TimestampDatasetsBuilder();
      builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
      const endTime = { sec: 4, nsec: 0 };
      builder.handlePlayerState(
        buildPlayerState({ endTime, messages: [1, 2, 3].map(buildFooMessage) }),
      );

      // When the seek frame holds a replayed message and a new one
      builder.handlePlayerState(
        buildPlayerState({ lastSeekTime: 2, endTime, messages: [2, 4].map(buildFooMessage) }),
      );

      // Then the stored points stay and only the new one is added
      expect(await storedXs(builder)).toEqual([1, 2, 3, 4]);
    });

    it("keeps unplotted messages that share the replay boundary time", async () => {
      // Given two points received at the same coarse clock time
      const builder = new TimestampDatasetsBuilder();
      builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
      const endTime = { sec: 3, nsec: 0 };
      const atThree = (val: number) => ({ ...buildFooMessage(3), message: { val } });
      builder.handlePlayerState(buildPlayerState({ endTime, messages: [atThree(1), atThree(2)] }));

      // When a seek replays them along with one that arrived at that time while paused
      builder.handlePlayerState(
        buildPlayerState({
          lastSeekTime: 2,
          endTime,
          messages: [atThree(1), atThree(2), atThree(3)],
        }),
      );

      // Then the paused arrival is added once
      const csv = await builder.getCsvData();
      expect(csv[0]?.data.map(({ y }) => y)).toEqual([1, 2, 3]);
    });

    it("keeps cached derivatives right after the start time slides", async () => {
      // Given derivatives computed and cached for preloaded rows
      const builder = new TimestampDatasetsBuilder();
      builder.setSeries(buildSeriesItems([{ value: "/foo.val.@derivative" }]));
      builder.handlePlayerState(buildPlayerState());
      builder.handleMessageRange(
        [1, 2].map(buildFooMessage),
        { isReset: true },
        {
          sec: 0,
          nsec: 0,
        },
      );
      await builder.getCsvData();

      // When the start time moves and a later batch extends the rows
      builder.handlePlayerState(buildPlayerState({ startTime: { sec: 1, nsec: 0 } }));
      builder.handleMessageRange([buildFooMessage(3)], { isReset: false }, { sec: 1, nsec: 0 });

      // Then the new row's derivative uses the shifted previous x
      const csv = await builder.getCsvData();
      expect(csv[0]?.data.map(({ y }) => y)).toEqual([NaN, 1, 1]);
    });

    it("starts over when the source clock goes back", async () => {
      // Given points at 4 s and 5 s
      const builder = new TimestampDatasetsBuilder();
      builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
      builder.handlePlayerState(
        buildPlayerState({ endTime: { sec: 5, nsec: 0 }, messages: [4, 5].map(buildFooMessage) }),
      );

      // When the source clock restarts at 1 s
      builder.handlePlayerState(
        buildPlayerState({
          lastSeekTime: 2,
          endTime: { sec: 2, nsec: 0 },
          messages: [1, 2].map(buildFooMessage),
        }),
      );

      // Then only the new timeline is kept
      expect(await storedXs(builder)).toEqual([1, 2]);
    });
  });

  it("exports data that has not been drawn yet", async () => {
    const builder = new TimestampDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ value: "/foo.val" }]));
    builder.handleMessageRange(
      [1, 2].map((sec) => ({
        topic: "/foo",
        schemaName: "foo",
        receiveTime: { sec, nsec: 0 },
        sizeInBytes: 0,
        message: { val: sec * 10 },
      })),
      { isReset: true },
      { sec: 0, nsec: 0 },
    );

    const csv = await builder.getCsvData();

    expect(csv[0]?.data.map((datum) => datum.y)).toEqual([10, 20]);
  });

  it("should process current messages into a dataset", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 0,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0.5, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1.5,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2.5,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
      ],
    });
  });

  it("should render a gap by mapping a null value to NaN", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 0,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: null,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 1, y: NaN, value: null },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });
  });

  it.each([
    [
      "/foo.val.@mul(2).@delta",
      [
        { x: 1, y: 2, value: 2 },
        { x: 2, y: 4, value: 4 },
      ],
    ],
    [
      "/foo.val.@timedelta",
      [
        { x: 1, y: 1, value: 1 },
        { x: 2, y: 1, value: 1 },
      ],
    ],
    [
      "/foo.val.@mul(2).@integral",
      [
        { x: 0, y: 0, value: 0 },
        { x: 1, y: 1, value: 1 },
        { x: 2, y: 5, value: 5 },
      ],
    ],
    [
      "/foo.val.@delta.@negative.@mul(10)",
      [
        { x: 1, y: -10, value: -10 },
        { x: 2, y: -20, value: -20 },
      ],
    ],
  ])("applies the cross-message modifier in %s", async (value, data) => {
    const builder = new TimestampDatasetsBuilder();
    builder.setSeries(buildSeriesItems([{ enabled: true, timestampMethod: "receiveTime", value }]));
    builder.handlePlayerState(
      buildPlayerState({
        messages: [0, 1, 3].map((val, sec) => ({
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec, nsec: 0 },
          sizeInBytes: 0,
          message: { val },
        })),
      }),
    );

    await expect(
      builder.getViewportDatasets({ size: { width: 1_000, height: 1_000 }, bounds: {} }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [expect.objectContaining({ data })],
    });
  });

  it("resets the derivative segment after a gap instead of computing across it", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val.@derivative",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 0 },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 1 },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: { val: null },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 3, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 5 },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 4, nsec: 0 },
            sizeInBytes: 0,
            message: { val: 7 },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          // t=0 is dropped (no previous datum to diff against). t=1 is a normal derivative.
          // t=2 is the gap itself, and t=3 is the first datum after it: both have nothing
          // valid to diff against, so both come out as NaN/null. t=4 resumes normally.
          data: [
            { x: 1, y: 1, value: 1 },
            { x: 2, y: NaN, value: null },
            { x: 3, y: NaN, value: null },
            { x: 4, y: 2, value: 2 },
          ],
        }),
      ],
    });
  });

  it("should create a discontinuity between current and full", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
      ]),
    );

    const playerState = buildPlayerState({
      messages: [
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 1, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 1.5,
          },
        },
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 2, nsec: 0 },
          sizeInBytes: 0,
          message: {
            val: 2.5,
          },
        },
      ],
    });

    builder.handlePlayerState(playerState);
    builder.handleMessageRange(
      [
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: { val: 0 },
        },
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0.5, nsec: 0 },
          sizeInBytes: 0,
          message: { val: 1 },
        },
      ],
      { isReset: false },
      { sec: 0, nsec: 0 },
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: NaN, y: NaN, value: NaN },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
      ],
    });
  });

  it("should reset full data when isReset is true", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([{ enabled: true, timestampMethod: "receiveTime", value: "/foo.val" }]),
    );

    // Initial full data
    builder.handleMessageRange(
      [
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 0, nsec: 0 },
          sizeInBytes: 0,
          message: { val: 0 },
        },
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 1, nsec: 0 },
          sizeInBytes: 0,
          message: { val: 1 },
        },
      ],
      { isReset: false },
      { sec: 0, nsec: 0 },
    );

    // Reset replaces all previous full data
    builder.handleMessageRange(
      [
        {
          topic: "/foo",
          schemaName: "foo",
          receiveTime: { sec: 2, nsec: 0 },
          sizeInBytes: 0,
          message: { val: 99 },
        },
      ],
      { isReset: true },
      { sec: 0, nsec: 0 },
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 2, y: 99, value: 99 }],
        }),
      ],
    });
  });

  it("computes derivative inside and outside of viewport", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val.@derivative",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 0,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0.5, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 1, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1.5,
            },
          },
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 2, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2.5,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0.5, y: 2, value: 2 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {
          x: { min: 0.2 },
        },
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0, y: 0, value: 0 },
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0.5, y: 2, value: 2 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {
          x: { min: 0.75 },
        },
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 0.5, y: 1, value: 1 },
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 0.5, y: 2, value: 2 },
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {
          x: { min: 1.2 },
        },
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [
            { x: 1, y: 1.5, value: 1.5 },
            { x: 2, y: 2.5, value: 2.5 },
          ],
        }),
        expect.objectContaining({
          data: [
            { x: 1, y: 1, value: 1 },
            { x: 2, y: 1, value: 1 },
          ],
        }),
      ],
    });
  });

  it("should cull current messages after threshold is reached", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
          showLine: false,
        },
      ]),
    );

    const messages = new Array(60_000).fill(1).map((_val, idx) => {
      return {
        topic: "/foo",
        schemaName: "foo",
        receiveTime: { sec: idx, nsec: 0 },
        sizeInBytes: 0,
        message: {
          val: idx,
        },
      };
    });

    // first batch of messages is under the limit
    {
      builder.handlePlayerState(
        buildPlayerState({
          messages: messages.slice(0, 40_000),
        }),
      );

      const result = await builder.getViewportDatasets({
        size: { width: 100_000, height: 100_000 },
        bounds: {},
      });

      expect(result.datasetsByConfigIndex[0]!.data.length).toEqual(40_000);
      expect(result.datasetsByConfigIndex[0]!.data[0]).toEqual({ x: 0, y: 0, value: 0 });
      expect(result.datasetsByConfigIndex[0]!.data[39_999]).toEqual({
        x: 39_999,
        y: 39_999,
        value: 39_999,
      });
    }

    // Next batch goes over the limit so some of the previous will be culled
    {
      builder.handlePlayerState(
        buildPlayerState({
          messages: messages.slice(40_000, 60_000),
        }),
      );

      const result = await builder.getViewportDatasets({
        size: { width: 100_000, height: 100_000 },
        bounds: {},
      });

      expect(result.datasetsByConfigIndex[0]!.data.length).toEqual(37500);
      expect(result.datasetsByConfigIndex[0]!.data[0]).toEqual({
        x: 22_500,
        y: 22_500,
        value: 22_500,
      });
      expect(result.datasetsByConfigIndex[0]!.data[37_499]).toEqual({
        x: 59_999,
        y: 59_999,
        value: 59_999,
      });
    }
  });

  it("supports toggling series enabled state", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
      ]),
    );

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
          {
            topic: "/bar",
            schemaName: "bar",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 2,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        expect.objectContaining({
          data: [{ x: 0, y: 1, value: 1 }],
        }),
        expect.objectContaining({
          data: [{ x: 0, y: 2, value: 2 }],
        }),
      ],
    });

    builder.setSeries(
      buildSeriesItems([
        {
          enabled: false,
          timestampMethod: "receiveTime",
          value: "/foo.val",
        },
        {
          enabled: true,
          timestampMethod: "receiveTime",
          value: "/bar.val",
        },
      ]),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        expect.objectContaining({
          data: [{ x: 0, y: 2, value: 2 }],
        }),
      ],
    });
  });

  it("leaves gaps in datasetsByConfigIndex for missing series", async () => {
    const builder = new TimestampDatasetsBuilder();

    builder.setSeries([
      {
        configIndex: 3,
        parsed: parseMessagePath("/foo.val")!,
        color: "red",
        contrastColor: "blue",
        enabled: true,
        timestampMethod: "receiveTime",
        key: "x" as SeriesConfigKey,
        lineSize: 1,
        messagePath: "/foo.val",
        showLine: true,
      },
    ]);

    builder.handlePlayerState(
      buildPlayerState({
        messages: [
          {
            topic: "/foo",
            schemaName: "foo",
            receiveTime: { sec: 0, nsec: 0 },
            sizeInBytes: 0,
            message: {
              val: 1,
            },
          },
        ],
      }),
    );

    await expect(
      builder.getViewportDatasets({
        size: { width: 1_000, height: 1_000 },
        bounds: {},
      }),
    ).resolves.toEqual({
      pathsWithMismatchedDataLengths: new Set(),
      datasetsByConfigIndex: [
        undefined,
        undefined,
        undefined,
        expect.objectContaining({
          data: [{ x: 0, y: 1, value: 1 }],
        }),
      ],
    });
  });
});

describe("readMessagePathItems", () => {
  it("places samples at a custom time field and skips messages without it", () => {
    const parsed = parseMessagePath("/odom.v")!;
    const timestampParsed = parseMessagePath("/odom.t")!;
    const msg = (v: number, t: number | undefined) => ({
      topic: "/odom",
      schemaName: "Odom",
      receiveTime: { sec: 50, nsec: 0 },
      sizeInBytes: 0,
      message: { v, t },
    });

    const items = readMessagePathItems(
      [msg(1, 12), msg(2, undefined), msg(3, 11)],
      { parsed, timestampMethod: "customField", timestampParsed },
      { sec: 10, nsec: 0 },
    );

    expect(items.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 2, y: 1 },
      { x: 1, y: 3 },
    ]);
  });
});
