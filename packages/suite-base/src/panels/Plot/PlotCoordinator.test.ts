// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import type { Theme } from "@mui/material";
import { EventEmitter } from "eventemitter3";
import * as _ from "lodash-es";
import type { Mock, Mocked } from "vitest";

import { parseMessagePath } from "@lichtblick/message-path";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { stringifyMessagePath } from "@lichtblick/suite-base/components/MessagePathSyntax/stringifyRosPath";
import { fillInGlobalVariablesInPath } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { UseSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter/useSubscribeMessageRange";
import { InteractionEvent, Scale } from "@lichtblick/suite-base/panels/Plot/types";
import { PlotXAxisVal } from "@lichtblick/suite-base/panels/Plot/utils/config";
import { Topic } from "@lichtblick/suite-base/players/types";
import PlayerBuilder from "@lichtblick/suite-base/testing/builders/PlayerBuilder";
import PlotBuilder from "@lichtblick/suite-base/testing/builders/PlotBuilder";
import { PlotCoordinatorBuilder } from "@lichtblick/suite-base/testing/builders/PlotCoordinatorBuilder";
import RosTimeBuilder from "@lichtblick/suite-base/testing/builders/RosTimeBuilder";
import { Bounds } from "@lichtblick/suite-base/types/Bounds";
import { BasicBuilder } from "@lichtblick/test-builders";

import { OffscreenCanvasRenderer } from "./OffscreenCanvasRenderer";
import { PlotCoordinator } from "./PlotCoordinator";
import { IDatasetsBuilder, SeriesConfigKey, SeriesItem } from "./builders/IDatasetsBuilder";
import { pathToSubscribePayload } from "./utils/subscription";

vi.mock("./OffscreenCanvasRenderer");
vi.mock("./builders/IDatasetsBuilder");

global.OffscreenCanvas = class {
  public width: number;
  public height: number;

  public constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public getContext() {
    return {};
  }
} as unknown as typeof OffscreenCanvas;

vi.mock(
  "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems",
  () => ({
    simpleGetMessagePathDataItems: vi.fn(),
  }),
);

vi.mock("@lichtblick/message-path", () => ({
  parseMessagePath: vi.fn(),
}));

vi.mock(
  "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems",
  () => ({
    fillInGlobalVariablesInPath: vi.fn(),
  }),
);

vi.mock("@lichtblick/suite-base/components/MessagePathSyntax/stringifyRosPath", () => ({
  stringifyMessagePath: vi.fn(),
}));

vi.mock("./utils/subscription", () => ({
  pathToSubscribePayload: vi.fn().mockReturnValue(undefined),
}));

const mockSubscribeMessageRange = vi.fn();
vi.mock("@lichtblick/suite-base/components/PanelExtensionAdapter", () => ({
  useSubscribeMessageRange: () => mockSubscribeMessageRange,
}));

describe("PlotCoordinator", () => {
  let renderer: Mocked<OffscreenCanvasRenderer>;
  let datasetsBuilder: Mocked<IDatasetsBuilder>;
  let plotCoordinator: PlotCoordinator;
  let subscribeMessageRange: UseSubscribeMessageRange;

  beforeEach(() => {
    const canvas = new OffscreenCanvas(500, 500);
    const theme: Theme = { name: "dark" } as Theme;
    renderer = new OffscreenCanvasRenderer(canvas, theme) as Mocked<OffscreenCanvasRenderer>;
    datasetsBuilder = new (EventEmitter as any)() as Mocked<IDatasetsBuilder>;

    // updateDatasets always resolves to an object in production; match that contract here so
    // tests that don't care about the resulting scales don't have to mock it individually.
    (renderer.updateDatasets as Mock).mockResolvedValue({});

    datasetsBuilder.handlePlayerState = vi.fn().mockReturnValue(undefined);
    datasetsBuilder.getViewportDatasets = vi.fn().mockResolvedValue({
      datasetsByConfigIndex: [],
      pathsWithMismatchedDataLengths: [],
    });
    datasetsBuilder.setSeries = vi.fn();
    datasetsBuilder.getCsvData = vi.fn().mockResolvedValue([]);

    subscribeMessageRange = mockSubscribeMessageRange;
    plotCoordinator = new PlotCoordinator(renderer, datasetsBuilder, subscribeMessageRange);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize plotCoordinator", () => {
    expect(plotCoordinator).toBeDefined();
  });

  describe("handlePlayerState", () => {
    it("should emit 'currentValuesChanged' when processing player state", () => {
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData(),
      });

      const listener = vi.fn();
      plotCoordinator.on("currentValuesChanged", listener);

      plotCoordinator.handlePlayerState(state);

      expect(listener).toHaveBeenCalledWith([]);
    });

    it("should not emit when no activeData", () => {
      const state = PlayerBuilder.playerState({ activeData: undefined });

      const listener = vi.fn();
      plotCoordinator.on("currentValuesChanged", listener);

      plotCoordinator.handlePlayerState(state);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should return immediately if plotCoordinator is destroyed", () => {
      const state = PlayerBuilder.playerState();
      plotCoordinator.destroy();
      const handlePlayerStateSpy = vi.spyOn(datasetsBuilder, "handlePlayerState");
      const updateSpy = vi.spyOn(renderer, "update");

      plotCoordinator.handlePlayerState(state);

      expect(handlePlayerStateSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("should update currentSeconds if isTimeseriesPlot is true", () => {
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData({
          currentTime: RosTimeBuilder.time({ sec: 100, nsec: 0 }),
          startTime: RosTimeBuilder.time({ sec: 50, nsec: 0 }),
        }),
      });
      (plotCoordinator as any).isTimeseriesPlot = true;

      plotCoordinator.handlePlayerState(state);

      expect(plotCoordinator["currentSeconds"]).toBe(
        state.activeData!.currentTime.sec - state.activeData!.startTime.sec,
      );
    });

    describe("follow mode during playback (fixed dataset range)", () => {
      const at = (seconds: number) =>
        PlayerBuilder.playerState({
          activeData: PlayerBuilder.activeData({
            startTime: RosTimeBuilder.time({ sec: 100, nsec: 0 }),
            currentTime: RosTimeBuilder.time({ sec: 100 + seconds, nsec: 0 }),
            // Playback, not a seek
            lastSeekTime: 1,
          }),
        });

      beforeEach(() => {
        // A file source reports the whole file as the dataset range, so it never changes while playing.
        datasetsBuilder.handlePlayerState = vi
          .fn()
          .mockReturnValue({ range: { min: 0, max: 15 }, datasetsChanged: false });
      });

      // Let queued renders finish so the next assertion only sees the work it triggers.
      const settle = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      };

      const wheel: InteractionEvent = {
        type: "wheel",
        cancelable: false,
        deltaX: 0,
        deltaY: -100,
        clientX: 250,
        clientY: 250,
        boundingClientRect: {
          x: 0,
          y: 0,
          width: 500,
          height: 500,
          top: 0,
          left: 0,
          right: 500,
          bottom: 500,
          toJSON: () => ({}),
        },
      };

      it("should render the x-axis window ending at the new time when playback advances in follow mode", async () => {
        // GIVEN a timestamp plot following the last 4 s, rendered at the start of the file
        plotCoordinator.handleConfig(
          PlotBuilder.config({ xAxisVal: "timestamp", followingViewWidth: 4, paths: [] }),
          "light",
          {},
        );
        plotCoordinator.handlePlayerState(at(0));
        await settle();
        const update = vi.spyOn(renderer, "update");
        update.mockClear();

        // WHEN playback reaches 5 s
        plotCoordinator.handlePlayerState(at(5));
        await settle();

        // THEN the renderer receives the window from 1 s to 5 s
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({ xBounds: { min: 1, max: 5 } }),
        );
      });

      it("should keep the playhead in the middle of the window when centered", async () => {
        // GIVEN a timestamp plot with a centered 4 s window
        plotCoordinator.handleConfig(
          PlotBuilder.config({
            xAxisVal: "timestamp",
            timeWindow: "sliding",
            followingViewWidth: 4,
            playheadPosition: "center",
            paths: [],
          }),
          "light",
          {},
        );
        const update = vi.spyOn(renderer, "update");

        // WHEN playback reaches 5 s
        plotCoordinator.handlePlayerState(at(5));
        await settle();

        // THEN the window runs from 3 s to 7 s
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({ xBounds: { min: 3, max: 7 } }),
        );
      });

      it("should use a 10 s window for a sliding time window without a size", async () => {
        // GIVEN a sliding time window without a size
        plotCoordinator.handleConfig(
          {
            ...PlotBuilder.config({ xAxisVal: "timestamp", timeWindow: "sliding", paths: [] }),
            followingViewWidth: undefined,
          },
          "light",
          {},
        );
        const update = vi.spyOn(renderer, "update");

        // WHEN playback reaches 12 s
        plotCoordinator.handlePlayerState(at(12));
        await settle();

        // THEN the window shows the last 10 s
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({ xBounds: { min: 2, max: 12 } }),
        );
      });

      it("should ignore x min/max outside of a fixed time window", async () => {
        // GIVEN an automatic time window on a layout that still has x bounds
        plotCoordinator.handleConfig(
          PlotBuilder.config({
            xAxisVal: "timestamp",
            timeWindow: "automatic",
            minXValue: 100,
            maxXValue: 200,
            paths: [],
          }),
          "light",
          {},
        );
        const update = vi.spyOn(renderer, "update");

        // WHEN the plot renders
        plotCoordinator.handlePlayerState(at(5));
        await settle();

        // THEN the x-axis spans the dataset range (0 s to 15 s), not the stored bounds
        expect(update).toHaveBeenLastCalledWith(
          expect.objectContaining({ xBounds: { min: 0, max: 15 } }),
        );
      });

      it("should not render again when the playback time has not changed", async () => {
        // GIVEN a timestamp plot following the last 4 s, rendered at 5 s
        plotCoordinator.handleConfig(
          PlotBuilder.config({ xAxisVal: "timestamp", followingViewWidth: 4, paths: [] }),
          "light",
          {},
        );
        plotCoordinator.handlePlayerState(at(5));
        await settle();
        const update = vi.spyOn(renderer, "update");
        update.mockClear();

        // WHEN the same time arrives again (playback is paused)
        plotCoordinator.handlePlayerState(at(5));
        await settle();

        // THEN nothing is rendered
        expect(update).not.toHaveBeenCalled();
      });

      it("should not render on time changes when the plot is not in follow mode", async () => {
        // GIVEN a timestamp plot without a fixed x-axis range, rendered at 5 s
        // (PlotBuilder fills an undefined followingViewWidth with a random number, so clear it after)
        plotCoordinator.handleConfig(
          {
            ...PlotBuilder.config({ xAxisVal: "timestamp", paths: [] }),
            followingViewWidth: undefined,
          },
          "light",
          {},
        );
        plotCoordinator.handlePlayerState(at(5));
        await settle();
        const update = vi.spyOn(renderer, "update");
        update.mockClear();

        // WHEN playback reaches 6 s
        plotCoordinator.handlePlayerState(at(6));
        await settle();

        // THEN nothing is rendered
        expect(update).not.toHaveBeenCalled();
      });

      it("should not render on time changes when the user has zoomed or panned the plot", async () => {
        // GIVEN a timestamp plot following the last 4 s that the user zoomed to 1 s - 3 s at 5 s
        plotCoordinator.handleConfig(
          PlotBuilder.config({ xAxisVal: "timestamp", followingViewWidth: 4, paths: [] }),
          "light",
          {},
        );
        plotCoordinator.handlePlayerState(at(5));
        const update = vi.spyOn(renderer, "update");
        update.mockResolvedValue({ x: { min: 1, max: 3 }, y: { min: 0, max: 1 } });
        plotCoordinator.addInteractionEvent(wheel);
        await settle();
        update.mockClear();

        // WHEN playback reaches 6 s
        plotCoordinator.handlePlayerState(at(6));
        await settle();

        // THEN nothing is rendered: the zoomed x-axis does not follow the time
        expect(update).not.toHaveBeenCalled();
      });

      it("should not render on time changes when the plot is synced to another plot's x-axis", async () => {
        // GIVEN a timestamp plot following the last 4 s that another plot synced to 2 s - 6 s
        plotCoordinator.handleConfig(
          PlotBuilder.config({ xAxisVal: "timestamp", followingViewWidth: 4, paths: [] }),
          "light",
          {},
        );
        plotCoordinator.handlePlayerState(at(5));
        plotCoordinator.setGlobalBounds({ min: 2, max: 6 });
        await settle();
        const update = vi.spyOn(renderer, "update");
        update.mockClear();

        // WHEN playback reaches 6 s
        plotCoordinator.handlePlayerState(at(6));
        await settle();

        // THEN nothing is rendered: the synced x-axis does not follow the time
        expect(update).not.toHaveBeenCalled();
      });
    });

    it("should update currentValuesByConfigIndex with the latest message item", () => {
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData(),
      });
      plotCoordinator["series"] = [
        {
          parsed: { topicName: state.activeData?.messages[0]?.topic },
          configIndex: 0,
          timestampMethod: "receiveTime",
        },
        {
          parsed: { topicName: state.activeData?.messages[1]?.topic },
          configIndex: 1,
          timestampMethod: "receiveTime",
        },
      ] as SeriesItem[];
      const itemsResponse = [BasicBuilder.numbers(), [BasicBuilder.number()]];
      (simpleGetMessagePathDataItems as Mock)
        .mockReturnValueOnce(itemsResponse[0])
        .mockReturnValueOnce(itemsResponse[1]);

      plotCoordinator.handlePlayerState(state);

      expect(simpleGetMessagePathDataItems).toHaveBeenCalledTimes(2);
      expect(plotCoordinator["currentValuesByConfigIndex"]).toEqual([
        _.last(itemsResponse[0]),
        _.last(itemsResponse[1]),
      ]);
    });

    it("keeps the latest-stamped value for header stamp series, even when messages arrive out of order", () => {
      const topic = "/odom";
      const message = (stamp: number) => ({
        topic,
        schemaName: "Odom",
        receiveTime: { sec: 100, nsec: 0 },
        sizeInBytes: 0,
        message: { header: { stamp: { sec: stamp, nsec: 0 } } },
      });
      const base = PlayerBuilder.activeData();
      const stateWith = (stamps: number[]) =>
        PlayerBuilder.playerState({
          activeData: { ...base, messages: stamps.map(message) },
        });
      plotCoordinator["series"] = [
        { parsed: { topicName: topic }, configIndex: 0, timestampMethod: "headerStamp" },
      ] as unknown as SeriesItem[];
      (simpleGetMessagePathDataItems as Mock).mockImplementation(
        (event: { message: { header: { stamp: { sec: number } } } }) => [
          event.message.header.stamp.sec,
        ],
      );

      plotCoordinator.handlePlayerState(stateWith([5, 7, 6]));
      expect(plotCoordinator["currentValuesByConfigIndex"]).toEqual([7]);

      // An older stamp in a later frame does not replace the newer value
      plotCoordinator.handlePlayerState(stateWith([4]));
      expect(plotCoordinator["currentValuesByConfigIndex"]).toEqual([7]);

      plotCoordinator.handlePlayerState(stateWith([8]));
      expect(plotCoordinator["currentValuesByConfigIndex"]).toEqual([8]);
    });

    it("shows the plotted value of a moving-average series in the legend, not the raw one", async () => {
      // Given a raw series and a moving-average series on a timestamp plot
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData({
          startTime: RosTimeBuilder.time({ sec: 100, nsec: 0 }),
          currentTime: RosTimeBuilder.time({ sec: 104, nsec: 0 }),
        }),
      });
      const topic = state.activeData!.messages[0]!.topic;
      plotCoordinator["isTimeseriesPlot"] = true;
      plotCoordinator["series"] = [
        { parsed: { topicName: topic }, configIndex: 0, timestampMethod: "receiveTime" },
        {
          parsed: { topicName: topic },
          configIndex: 1,
          timestampMethod: "receiveTime",
          smoothing: 4,
        },
      ] as SeriesItem[];
      (simpleGetMessagePathDataItems as Mock).mockReturnValue([10]);
      const getDerivedValuesAt = vi.fn().mockResolvedValue([undefined, 7.5]);
      datasetsBuilder.getDerivedValuesAt = getDerivedValuesAt;
      const emitted: unknown[][] = [];
      plotCoordinator.on("currentValuesChanged", (values) => emitted.push(values.slice()));

      // When a frame arrives
      plotCoordinator.handlePlayerState(state);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Then the raw series shows the message value and the averaged one its plotted value
      expect(getDerivedValuesAt).toHaveBeenCalledWith(4);
      expect(plotCoordinator["currentValuesByConfigIndex"]).toEqual([10, 7.5]);
      // and the legend got the averaged value, never the raw one for that series
      expect(emitted.at(-1)).toEqual([10, 7.5]);
      expect(emitted.every((values) => values[1] !== 10)).toBe(true);
    });

    it("drops a legend lookup that finishes after a seek, and survives a failed one", async () => {
      // Given a moving-average series whose lookup is still running
      const activeData = PlayerBuilder.activeData({
        startTime: RosTimeBuilder.time({ sec: 100, nsec: 0 }),
        currentTime: RosTimeBuilder.time({ sec: 104, nsec: 0 }),
        lastSeekTime: 1,
      });
      plotCoordinator["isTimeseriesPlot"] = true;
      plotCoordinator["series"] = [
        {
          parsed: { topicName: "/a" },
          configIndex: 0,
          timestampMethod: "receiveTime",
          smoothing: 4,
        },
      ] as SeriesItem[];
      let finish: (values: unknown[]) => void = () => {};
      const getDerivedValuesAt = vi
        .fn()
        .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
        .mockRejectedValueOnce(new Error("lookup failed"));
      datasetsBuilder.getDerivedValuesAt = getDerivedValuesAt;
      plotCoordinator.handlePlayerState(PlayerBuilder.playerState({ activeData }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getDerivedValuesAt).toHaveBeenCalledTimes(1);

      // When the user seeks before it finishes
      plotCoordinator.handlePlayerState(
        PlayerBuilder.playerState({ activeData: { ...activeData, lastSeekTime: 2 } }),
      );
      finish([7.5]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Then the old value is not shown, and the failing follow-up lookup does not throw
      expect(getDerivedValuesAt).toHaveBeenCalledTimes(2);
      expect(plotCoordinator["currentValuesByConfigIndex"]).toEqual([]);
    });

    it("should not update currentValuesByConfigIndex", () => {
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData(),
      });
      plotCoordinator["series"] = [
        {
          parsed: { topicName: state.activeData?.messages[0]?.topic },
          configIndex: 0,
          timestampMethod: "headerStamp",
        },
        {
          parsed: { topicName: state.activeData?.messages[1]?.topic },
          configIndex: 1,
          timestampMethod: "headerStamp",
        },
      ] as SeriesItem[];

      plotCoordinator.handlePlayerState(state);

      expect(simpleGetMessagePathDataItems).not.toHaveBeenCalled();
      expect(plotCoordinator["currentValuesByConfigIndex"]).toEqual([]);
    });
  });

  describe("topic range subscriptions", () => {
    beforeEach(() => {
      (pathToSubscribePayload as Mock).mockReturnValue({
        topic: "/foo",
        preloadType: "full",
      });
      datasetsBuilder.handleMessageRange = vi.fn();
      mockSubscribeMessageRange.mockReturnValue(vi.fn());
    });

    it("groups multiple series with the same topic into a single subscription", () => {
      // Given
      const topic = "/foo";
      plotCoordinator["seriesKeysByTopic"] = PlotCoordinatorBuilder.seriesKeysByTopic([
        [topic, ["/foo.x", "/foo.y"]],
      ]);
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData(),
      });

      // When
      plotCoordinator.handlePlayerState(state);

      // Then
      expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(1);
      expect(mockSubscribeMessageRange).toHaveBeenCalledWith(expect.objectContaining({ topic }));
    });

    it("cancels subscription for a topic removed from series", () => {
      // Given — first call subscribes /foo
      const cancelFoo = vi.fn();
      mockSubscribeMessageRange.mockReturnValue(cancelFoo);
      plotCoordinator["seriesKeysByTopic"] = new Map([
        ["/foo", new Set(["0:receiveTime:/foo.val"] as SeriesConfigKey[])],
      ]);
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData(),
      });
      plotCoordinator.handlePlayerState(state);

      // When — second call with /bar only
      mockSubscribeMessageRange.mockClear();
      plotCoordinator["seriesKeysByTopic"] = PlotCoordinatorBuilder.seriesKeysByTopic([
        ["/bar", ["/bar.val"]],
      ]);
      plotCoordinator.handlePlayerState(state);

      // Then
      expect(cancelFoo).toHaveBeenCalled();
      expect(mockSubscribeMessageRange).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "/bar" }),
      );
    });

    it("does not re-subscribe when the same topic and keys are unchanged", () => {
      // Given — simulate an active subscription (onNewRangeIterator is called)
      mockSubscribeMessageRange.mockImplementation(
        ({
          onNewRangeIterator,
        }: {
          onNewRangeIterator: (iter: AsyncIterable<unknown>) => Promise<void>;
        }) => {
          // Simulate a real subscription that calls onNewRangeIterator
          void onNewRangeIterator((async function* () {})());
          return vi.fn();
        },
      );
      plotCoordinator["seriesKeysByTopic"] = PlotCoordinatorBuilder.seriesKeysByTopic([
        ["/foo", ["/foo.val"]],
      ]);
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData(),
      });
      plotCoordinator.handlePlayerState(state);
      mockSubscribeMessageRange.mockClear();

      // When — same series, same state
      plotCoordinator.handlePlayerState(state);

      // Then — no new subscription opened
      expect(mockSubscribeMessageRange).not.toHaveBeenCalled();
    });

    it("retries subscription when previous was inactive (no-op cancel)", () => {
      // Given — first subscription returns no-op (onNewRangeIterator never called)
      mockSubscribeMessageRange.mockReturnValue(vi.fn());
      plotCoordinator["seriesKeysByTopic"] = PlotCoordinatorBuilder.seriesKeysByTopic([
        ["/foo", ["/foo.val"]],
      ]);
      const state = PlayerBuilder.playerState({
        activeData: PlayerBuilder.activeData(),
      });
      plotCoordinator.handlePlayerState(state);
      mockSubscribeMessageRange.mockClear();

      // When — same series, same state, but previous was inactive
      plotCoordinator.handlePlayerState(state);

      // Then — retries the subscription
      expect(mockSubscribeMessageRange).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "/foo" }),
      );
    });

    describe("handling topic object reference changes", () => {
      beforeEach(() => {
        mockSubscribeMessageRange.mockImplementation(
          ({
            onNewRangeIterator,
          }: {
            onNewRangeIterator: (iter: AsyncIterable<unknown>) => Promise<void>;
          }) => {
            void onNewRangeIterator((async function* () {})());
            return vi.fn();
          },
        );
      });

      afterEach(() => {
        mockSubscribeMessageRange.mockClear();
      });

      function subscribeToTopics(topics: Array<Topic>) {
        plotCoordinator["seriesKeysByTopic"] = PlotCoordinatorBuilder.seriesKeysByTopic(
          topics.map((t) => [t.name, [`${t.name}.${BasicBuilder.string()}`]]),
        );
        const state = PlayerBuilder.playerState({
          activeData: PlayerBuilder.activeData({ topics }),
        });
        plotCoordinator.handlePlayerState(state);
      }

      function emitTopics(topics: Array<Topic>) {
        const state = PlayerBuilder.playerState({
          activeData: PlayerBuilder.activeData({ topics }),
        });
        plotCoordinator.handlePlayerState(state);
      }

      it("does not re-subscribe when topics array reference is unchanged", () => {
        const topic = PlayerBuilder.topic();
        const topics = [topic];
        subscribeToTopics(topics);

        // When — same topics array reference (no change detected)
        emitTopics(topics);

        // Then — only the initial subscription, no additional calls
        expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(1);
      });

      it("re-subscribes when topic object reference changes", () => {
        const topic = PlayerBuilder.topic();
        subscribeToTopics([topic]);

        // When — new topic object (different reference)
        emitTopics([{ ...topic }]);

        // Then
        expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(2);
      });

      it("only invalidates subscriptions for topics whose object reference changed", () => {
        const topic1 = PlayerBuilder.topic();
        const topic2 = PlayerBuilder.topic();
        subscribeToTopics([topic1, topic2]);

        // When
        emitTopics([{ ...topic1 }, topic2]);

        // Then — only topic1 is re-subscribed
        expect(mockSubscribeMessageRange).toHaveBeenCalledWith(
          expect.objectContaining({ topic: topic1.name }),
        );
      });

      it("marks subscription inactive when topic is newly added to topics list", () => {
        const topic1 = PlayerBuilder.topic();
        const topic2 = PlayerBuilder.topic();

        plotCoordinator["seriesKeysByTopic"] = PlotCoordinatorBuilder.seriesKeysByTopic([
          [topic1.name, [`${topic1.name}.${BasicBuilder.string()}`]],
        ]);
        emitTopics([topic2]);

        // When — topics array changes and now includes topic1
        emitTopics([topic2, topic1]);

        // Then — topic1 subscription is retried because oldTopic was undefined
        expect(mockSubscribeMessageRange).toHaveBeenCalledTimes(2);
        expect(mockSubscribeMessageRange).toHaveBeenCalledWith(
          expect.objectContaining({ topic: topic1.name }),
        );
      });
    });
  });

  describe("destroy", () => {
    it("should set 'destroyed' to true when calling destroy", () => {
      plotCoordinator.destroy();

      expect(plotCoordinator["destroyed"]).toBe(true);
    });
  });

  describe("dispatchRender", () => {
    it("should return immediately if plotCoordinator is destroyed", async () => {
      plotCoordinator.destroy();

      await plotCoordinator["dispatchRender"]();

      const updateSpy = vi.spyOn(renderer, "update");
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("should call 'update' on the renderer when dispatching render", async () => {
      renderer.update.mockResolvedValue({
        x: { min: 0, max: 10 },
        y: { min: 0, max: 10 },
      });

      await plotCoordinator["dispatchRender"]();

      const updateSpyOn = vi.spyOn(renderer, "update");
      expect(updateSpyOn).toHaveBeenCalled();
    });

    it("should emit 'timeseriesBounds' when updating limits", async () => {
      const listener = vi.fn();
      plotCoordinator.setShouldSync({ shouldSync: true });
      plotCoordinator.on("timeseriesBounds", listener);
      const bounds: Bounds = {
        x: { min: BasicBuilder.number(), max: BasicBuilder.number() },
        y: { min: BasicBuilder.number(), max: BasicBuilder.number() },
      };
      (renderer.update as Mock).mockResolvedValue(bounds);
      plotCoordinator.addInteractionEvent({
        type: "zoom",
        scaleX: BasicBuilder.number(),
        scaleY: BasicBuilder.number(),
      } as unknown as InteractionEvent);

      await plotCoordinator["dispatchRender"]();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(bounds.x);
    });

    it("should not emit 'timeseriesBounds' if shouldSync is false", async () => {
      const listener = vi.fn();

      plotCoordinator.setShouldSync({ shouldSync: false });
      plotCoordinator.on("timeseriesBounds", listener);
      const bounds: Bounds = {
        x: { min: BasicBuilder.number(), max: BasicBuilder.number() },
        y: { min: BasicBuilder.number(), max: BasicBuilder.number() },
      };
      (renderer.update as Mock).mockResolvedValue(bounds);
      plotCoordinator.addInteractionEvent({
        type: "zoom",
        scaleX: BasicBuilder.number(),
        scaleY: BasicBuilder.number(),
      } as unknown as InteractionEvent);

      await plotCoordinator["dispatchRender"]();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dispatchDownsample", () => {
    it("should call 'getViewportDatasets' when dispatching downsample", async () => {
      datasetsBuilder.getViewportDatasets = vi.fn().mockResolvedValue({
        datasetsByConfigIndex: [],
        pathsWithMismatchedDataLengths: [],
      });

      await plotCoordinator["dispatchDownsample"]();

      const getViewportDatasetsSpyOn = vi.spyOn(datasetsBuilder, "getViewportDatasets");
      expect(getViewportDatasetsSpyOn).toHaveBeenCalled();
    });
  });

  describe("resetBounds", () => {
    it("should reset limits correctly", () => {
      plotCoordinator.resetBounds();

      expect(plotCoordinator["interactionBounds"]).toBeUndefined();
      expect(plotCoordinator["globalBounds"]).toBeUndefined();
    });

    it("forgets the held y range on reset view", async () => {
      const update = vi.spyOn(renderer, "update");
      plotCoordinator.resetBounds();
      await plotCoordinator["dispatchRender"]();

      expect(update).toHaveBeenCalledWith(expect.objectContaining({ resetHeldYRange: true }));
    });

    it("offers reset view while holding the y range", async () => {
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});
      plotCoordinator.handleConfig(
        PlotBuilder.config({ paths: [], yRangeMode: "hold" }),
        "light",
        {},
      );
      const viewportChange = vi.fn();
      plotCoordinator.on("viewportChange", viewportChange);

      await plotCoordinator["dispatchRender"]();

      expect(viewportChange).toHaveBeenCalledWith(true);
    });

    it("forgets the held y range on seek", () => {
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});
      const seekTo = (lastSeekTime: number) => {
        plotCoordinator.handlePlayerState(
          PlayerBuilder.playerState({ activeData: PlayerBuilder.activeData({ lastSeekTime }) }),
        );
      };
      seekTo(1);
      expect(plotCoordinator["updateAction"].resetHeldYRange).toBeUndefined();

      seekTo(2);

      expect(plotCoordinator["updateAction"].resetHeldYRange).toBe(true);
    });
  });

  describe("handleConfig", () => {
    afterEach(() => {
      vi.resetAllMocks();
    });
    it("should return immediately if plotCoordinator is destroyed", () => {
      const config = PlotBuilder.config({
        xAxisVal: "timestamp",
        followingViewWidth: 10,
        paths: [],
      });

      plotCoordinator.destroy();

      plotCoordinator.handleConfig(config, "light", {});
      expect(plotCoordinator["isTimeseriesPlot"]).toBe(false);
    });
    it("should set isTimeseriesPlot to true when xAxisVal is 'timestamp'", () => {
      const config = PlotBuilder.config({
        xAxisVal: "timestamp",
        followingViewWidth: 10,
        paths: [],
      });

      plotCoordinator.handleConfig(config, "light", {});

      expect(plotCoordinator["isTimeseriesPlot"]).toBe(true);
      expect(plotCoordinator["followRange"]).toBe(config.followingViewWidth);
    });

    it("should set isTimeseriesPlot to false when xAxisVal is not 'timestamp'", () => {
      const config = PlotBuilder.config({
        xAxisVal: BasicBuilder.sample(["index", "custom", "currentCustom"] as PlotXAxisVal[]),
        paths: [],
      });

      plotCoordinator.handleConfig(config, "dark", {});

      expect(plotCoordinator["isTimeseriesPlot"]).toBe(false);
      expect(plotCoordinator["currentSeconds"]).toBeUndefined();
    });

    it("should update configBounds correctly", () => {
      // x min/max apply to every non-time x-axis (time plots only use them in a fixed time window)
      const config = PlotBuilder.config({ xAxisVal: "index" });

      plotCoordinator.handleConfig(config, "light", {});

      expect(plotCoordinator["configBounds"]).toEqual({
        x: { min: config.minXValue, max: config.maxXValue },
        y: { min: config.minYValue, max: config.maxYValue },
      });
    });

    it("should set updateAction.yBounds if configYBoundsChanged", () => {
      const config = PlotBuilder.config({
        minYValue: 1,
        maxYValue: 5,
      });
      // avoid queueDispatchRender() overwrite updateAction
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});

      plotCoordinator.handleConfig(config, "light", {});

      expect(plotCoordinator["updateAction"].yBounds).toEqual({
        min: config.minYValue,
        max: config.maxYValue,
      });
    });

    it("sends the hold y range mode only when it changes", () => {
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});
      const config = PlotBuilder.config({ paths: [], yRangeMode: "hold" });

      plotCoordinator.handleConfig(config, "light", {});
      expect(plotCoordinator["updateAction"].holdYRange).toBe(true);

      plotCoordinator["updateAction"] = { type: "update" };
      plotCoordinator.handleConfig(config, "light", {});
      expect(plotCoordinator["updateAction"].holdYRange).toBeUndefined();

      plotCoordinator.handleConfig({ ...config, yRangeMode: undefined }, "light", {});
      expect(plotCoordinator["updateAction"].holdYRange).toBe(false);
    });

    it("forgets the held y range when the series change", () => {
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});
      (parseMessagePath as Mock).mockReturnValue({ topicName: "/topic", messagePath: [] });
      (fillInGlobalVariablesInPath as Mock).mockImplementation((parsed) => parsed);
      (stringifyMessagePath as Mock).mockReturnValue("");
      const config = PlotBuilder.config({ yRangeMode: "hold" });

      plotCoordinator.handleConfig(config, "light", {});
      plotCoordinator["updateAction"] = { type: "update" };
      plotCoordinator.handleConfig(config, "light", {});
      expect(plotCoordinator["updateAction"].resetHeldYRange).toBeUndefined();

      plotCoordinator.handleConfig({ ...config, paths: config.paths.slice(1) }, "light", {});
      expect(plotCoordinator["updateAction"].resetHeldYRange).toBe(true);
    });

    it("sends log scales and reference line orientation and labels", () => {
      const config = PlotBuilder.config({
        yAxisLogScale: true,
        paths: [
          PlotBuilder.path({ value: "2", enabled: true, referenceLineAxis: "x", label: " go " }),
          PlotBuilder.path({ value: "4", enabled: true, axis: "secondary", label: "" }),
        ],
      });
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});

      plotCoordinator.handleConfig(config, "light", {});

      const action = plotCoordinator["updateAction"];
      expect(action.yLogScale).toBe(true);
      expect(action.y2LogScale).toBe(false);
      expect(action.referenceLines).toMatchObject([
        { value: 2, scaleID: "x", label: "go" },
        { value: 4, scaleID: "y2", label: undefined },
      ]);
    });

    it("sends threshold shading for time plots only, resolving the shaded series by path", () => {
      const line = PlotBuilder.path({
        value: "3",
        enabled: true,
        referenceLineDashed: false,
        lineSize: 2,
        referenceLineShade: "above",
        referenceLineShadeSeries: "/a.b",
      });
      const paths = [
        PlotBuilder.path({ value: "/a.b", enabled: true }),
        line,
        PlotBuilder.path({ value: "/c.d", enabled: true }),
        PlotBuilder.path({ value: "/a.b", enabled: true }),
        // Older layouts have no shade setting
        PlotBuilder.path({ value: "1", enabled: true }),
      ];
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});

      plotCoordinator.handleConfig(
        PlotBuilder.config({ xAxisVal: "timestamp", plotMode: "time", paths }),
        "light",
        {},
      );
      const lines = plotCoordinator["updateAction"].referenceLines;
      expect(lines?.[0]).toMatchObject({
        dashed: false,
        width: 2,
        shade: "above",
        shadeSeries: [0, 3],
      });
      expect(lines?.[1]).toMatchObject({ shade: undefined, shadeSeries: undefined });

      plotCoordinator.handleConfig(
        PlotBuilder.config({ xAxisVal: "timestamp", plotMode: "histogram", paths }),
        "light",
        {},
      );
      expect(plotCoordinator["updateAction"].referenceLines?.[0]?.shade).toBeUndefined();
    });

    it("should pass xAxisLabel through to updateAction", () => {
      const config = PlotBuilder.config({ xAxisLabel: "Time (s)", paths: [] });
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});

      plotCoordinator.handleConfig(config, "light", {});

      expect(plotCoordinator["updateAction"].xAxisLabel).toBe("Time (s)");
    });

    it("should pass yAxisLabel through to updateAction", () => {
      const config = PlotBuilder.config({ yAxisLabel: "Velocity", paths: [] });
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});

      plotCoordinator.handleConfig(config, "light", {});

      expect(plotCoordinator["updateAction"].yAxisLabel).toBe("Velocity");
    });

    it("should clear the axis labels when not configured", () => {
      const config = PlotBuilder.config({
        xAxisLabel: undefined,
        yAxisLabel: undefined,
        paths: [],
      });
      vi.spyOn(plotCoordinator as any, "queueDispatchRender").mockImplementation(() => {});

      plotCoordinator.handleConfig(config, "light", {});

      // An empty label hides one shown before (e.g. a spectrum's default label)
      expect(plotCoordinator["updateAction"].xAxisLabel).toBe("");
      expect(plotCoordinator["updateAction"].yAxisLabel).toBe("");
    });

    it("analyzes the time window a time plot would show on a spectrum", () => {
      const config = PlotBuilder.config({
        xAxisVal: "timestamp",
        plotMode: "fft",
        timeWindow: "fixed",
        minXValue: 1,
        maxXValue: 3,
        minYValue: -1,
        paths: [],
      });

      plotCoordinator.handleConfig(config, "light", {});

      // x is frequency, scaled to the data; the time window picks the samples
      expect(plotCoordinator["getXBounds"]()).toEqual({ min: undefined, max: undefined });
      expect(plotCoordinator["configBounds"].y).toEqual({});
      expect(plotCoordinator["getAnalysis"]()).toEqual({
        mode: "fft",
        bins: undefined,
        timeRange: { min: 1, max: 3 },
      });

      plotCoordinator.handleConfig({ ...config, analysisRange: "all" }, "light", {});
      expect(plotCoordinator["getAnalysis"]()).toEqual({ mode: "fft", bins: undefined });
    });

    it("should correctly process paths and generate series", () => {
      const config = PlotBuilder.config();
      (parseMessagePath as Mock).mockReturnValue(BasicBuilder.string());
      (fillInGlobalVariablesInPath as Mock).mockReturnValue(undefined);
      (stringifyMessagePath as Mock).mockReturnValue("");

      plotCoordinator.handleConfig(config, "light", {});

      expect(plotCoordinator["series"].length).toBe(config.paths.length);
      expect(plotCoordinator["series"][0]?.messagePath).toBe(config.paths[0]?.value);
      expect(plotCoordinator["series"][1]?.messagePath).toBe(config.paths[1]?.value);
      expect(plotCoordinator["series"][2]?.messagePath).toBe(config.paths[2]?.value);
      const setSeriesSpy = vi.spyOn(datasetsBuilder, "setSeries");
      expect(setSeriesSpy).toHaveBeenCalledWith(plotCoordinator["series"]);
    });

    it("should correctly create 2 series even if both have the same message path", () => {
      const messagePath = PlotBuilder.path({
        value: BasicBuilder.string(),
        timestampMethod: "receiveTime",
      });
      const plotConfig = PlotBuilder.config({
        paths: [messagePath, messagePath],
      });

      (parseMessagePath as Mock).mockReturnValue({
        topicName: messagePath.value,
      });
      (fillInGlobalVariablesInPath as Mock).mockImplementation((parsed) => parsed);
      (stringifyMessagePath as Mock).mockImplementation((parsed) => parsed.topicName ?? "");

      plotCoordinator.handleConfig(plotConfig, "light", {});

      const setSeriesSpy = vi.spyOn(datasetsBuilder, "setSeries");
      expect(setSeriesSpy).toHaveBeenCalled();
      const series = (datasetsBuilder.setSeries as Mock).mock.calls[0]?.[0];

      expect(series).toHaveLength(2);
      expect(series[0].configIndex).toBe(0);
      expect(series[1].configIndex).toBe(1);
      expect(series[0].key).toBe(`0:receiveTime:${messagePath.value}`);
      expect(series[1].key).toBe(`1:receiveTime:${messagePath.value}`);
      expect(series[0].key).not.toEqual(series[1].key);
    });

    it("should dispatch render and queue downsample", async () => {
      const queueDispatchRender = vi.spyOn(plotCoordinator as any, "queueDispatchRender");
      const queueDispatchDownsample = vi.spyOn(plotCoordinator as any, "queueDispatchDownsample");
      const config = PlotBuilder.config();

      plotCoordinator.handleConfig(config, "light", {});

      expect(queueDispatchRender).toHaveBeenCalled();
      expect(queueDispatchDownsample).toHaveBeenCalled();
    });

    describe("seriesKeysByTopic", () => {
      beforeEach(() => {
        (pathToSubscribePayload as Mock).mockReturnValue({
          topic: "/foo",
          preloadType: "full",
        });
        (parseMessagePath as Mock).mockImplementation((value) => ({
          topicName: value,
        }));
        (fillInGlobalVariablesInPath as Mock).mockImplementation((parsed) => parsed);
        (stringifyMessagePath as Mock).mockImplementation((parsed) => parsed.topicName ?? "");
      });

      it("populates seriesKeysByTopic from paths with a valid subscribe payload", () => {
        // Given
        const path = PlotBuilder.path({
          value: "/foo",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        const config = PlotBuilder.config({ paths: [path] });

        // When
        plotCoordinator.handleConfig(config, "light", {});

        // Then
        const map = plotCoordinator["seriesKeysByTopic"];
        expect(map.has("/foo")).toBe(true);
        expect(map.get("/foo")!.size).toBe(1);
      });

      it("excludes series whose pathToSubscribePayload returns undefined", () => {
        // Given
        (pathToSubscribePayload as Mock).mockReturnValue(undefined);
        const path = PlotBuilder.path({
          value: "/foo",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        const config = PlotBuilder.config({ paths: [path] });

        // When
        plotCoordinator.handleConfig(config, "light", {});

        // Then
        expect(plotCoordinator["seriesKeysByTopic"].size).toBe(0);
      });

      it("groups multiple series with the same topic into one entry", () => {
        // Given
        const pathA = PlotBuilder.path({
          value: "/foo",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        const pathB = PlotBuilder.path({
          value: "/foo",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        const config = PlotBuilder.config({ paths: [pathA, pathB] });

        // When
        plotCoordinator.handleConfig(config, "light", {});

        // Then
        const map = plotCoordinator["seriesKeysByTopic"];
        expect(map.size).toBe(1);
        expect(map.get("/foo")!.size).toBe(2);
      });

      it("replaces the map on each call, removing topics no longer in config", () => {
        // Given
        const fooPath = PlotBuilder.path({
          value: "/foo",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        const barPath = PlotBuilder.path({
          value: "/bar",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        (parseMessagePath as Mock).mockImplementation((value) => ({
          topicName: value,
        }));

        // When
        plotCoordinator.handleConfig(PlotBuilder.config({ paths: [fooPath] }), "light", {});

        // Then
        expect(plotCoordinator["seriesKeysByTopic"].has("/foo")).toBe(true);

        // When
        plotCoordinator.handleConfig(PlotBuilder.config({ paths: [barPath] }), "light", {});

        // Then
        const map = plotCoordinator["seriesKeysByTopic"];
        expect(map.has("/foo")).toBe(false);
        expect(map.has("/bar")).toBe(true);
      });

      it("includes the xTopic from getXTopic when not already present", () => {
        // Given
        datasetsBuilder.getXTopic = vi.fn().mockReturnValue("/xtopic");
        const path = PlotBuilder.path({
          value: "/foo",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        const config = PlotBuilder.config({ paths: [path] });

        // When
        plotCoordinator.handleConfig(config, "light", {});

        // Then
        expect(plotCoordinator["seriesKeysByTopic"].has("/xtopic")).toBe(true);
        // X-topic is added with an empty set of keys since it is not directly associated with any series
        expect(plotCoordinator["seriesKeysByTopic"].get("/xtopic")!.size).toBe(0);
      });

      it("does not add xTopic if it is already covered by a series", () => {
        // Given
        datasetsBuilder.getXTopic = vi.fn().mockReturnValue("/foo");
        const path = PlotBuilder.path({
          value: "/foo",
          timestampMethod: "receiveTime",
          enabled: true,
        });
        const config = PlotBuilder.config({ paths: [path] });

        // When
        plotCoordinator.handleConfig(config, "light", {});

        // Then
        const keys = plotCoordinator["seriesKeysByTopic"].get("/foo")!;
        // If this key was not skipped, its size would be 0
        expect(keys.size).toBe(1);
      });
    });
  });

  describe("setGlobalBounds", () => {
    it("should set globalBounds and reset interactionBounds", () => {
      const queueDispatchRender = vi.spyOn(plotCoordinator as any, "queueDispatchRender");
      const bounds = { min: 0, max: 10 };

      plotCoordinator.setGlobalBounds(bounds);

      expect(plotCoordinator["globalBounds"]).toEqual(bounds);
      expect(plotCoordinator["interactionBounds"]).toBeUndefined();
      expect(queueDispatchRender).toHaveBeenCalled();
    });

    it("should reset Y bounds when globalBounds is undefined", () => {
      const queueDispatchRenderSpy = vi
        .spyOn(plotCoordinator as any, "queueDispatchRender")
        .mockImplementation(() => {});
      plotCoordinator["shouldResetY"] = false;

      plotCoordinator.setGlobalBounds(undefined);

      expect(plotCoordinator["globalBounds"]).toBeUndefined();
      expect(plotCoordinator["shouldResetY"]).toBe(true);
      queueDispatchRenderSpy.mockRestore();
    });
  });

  describe("setShouldSync", () => {
    // eslint-disable-next-line @lichtblick/no-boolean-parameters
    it.each([true, false])("should update shouldSync property", (shouldSync: boolean) => {
      plotCoordinator.setShouldSync({ shouldSync });

      expect(plotCoordinator["shouldSync"]).toBe(shouldSync);
    });
  });

  describe("setZoomMode", () => {
    it.each(["x", "xy", "y"])("should update zoomMode in updateAction", (mode: string) => {
      const queueDispatchRenderSpy = vi
        .spyOn(plotCoordinator as any, "queueDispatchRender")
        .mockImplementation(() => {});

      plotCoordinator.setZoomMode(mode as "x" | "xy" | "y");

      expect(plotCoordinator["updateAction"].zoomMode).toBe(mode);
      expect(queueDispatchRenderSpy).toHaveBeenCalled();
    });
  });

  describe("setSize", () => {
    it("should update viewport size", () => {
      const queueDispatchRenderSpy = vi
        .spyOn(plotCoordinator as any, "queueDispatchRender")
        .mockImplementation(() => {});
      const queueDispatchDownsampleSpy = vi
        .spyOn(plotCoordinator as any, "queueDispatchDownsample")
        .mockImplementation(() => {});
      const newSize = { width: 800, height: 600 };

      plotCoordinator.setSize(newSize);

      expect(plotCoordinator["viewport"].size).toEqual(newSize);
      expect(plotCoordinator["updateAction"].size).toEqual(newSize);
      expect(queueDispatchRenderSpy).toHaveBeenCalled();
      expect(queueDispatchDownsampleSpy).toHaveBeenCalled();
    });
  });

  describe("getXValueAtPixel", () => {
    function buildXScale(scale: Partial<Scale> = {}): Scale {
      return {
        left: BasicBuilder.number(),
        right: BasicBuilder.number(),
        min: BasicBuilder.number(),
        max: BasicBuilder.number(),
        ...scale,
      };
    }

    it("should return -1 when latestXScale is undefined", () => {
      const result = plotCoordinator.getXValueAtPixel(100);

      expect(result).toBe(-1);
    });

    it("should return -1 when pixelRange is zero or negative", () => {
      plotCoordinator["latestXScale"] = buildXScale({
        left: 50,
        right: 50,
        min: 0,
        max: 10,
      });

      const result = plotCoordinator.getXValueAtPixel(100);

      expect(result).toBe(-1);
    });

    it("should correctly map pixelX to x value", () => {
      plotCoordinator["latestXScale"] = buildXScale({
        left: 0,
        right: 200,
        min: 10,
        max: 50,
      });

      const result = plotCoordinator.getXValueAtPixel(100);

      expect(result).toBe(30);
    });

    it("should return min value when pixelX is at left boundary", () => {
      plotCoordinator["latestXScale"] = buildXScale({
        left: 0,
        right: 200,
        min: 10,
        max: 50,
      });

      const result = plotCoordinator.getXValueAtPixel(0);

      expect(result).toBe(10);
    });

    it("should return max value when pixelX is at right boundary", () => {
      plotCoordinator["latestXScale"] = buildXScale({
        left: 0,
        right: 200,
        min: 10,
        max: 50,
      });

      const result = plotCoordinator.getXValueAtPixel(200);

      expect(result).toBe(50);
    });
  });

  describe("getCsvData", () => {
    it("should return an empty array when destroyed", async () => {
      plotCoordinator["destroyed"] = true;

      const result = await plotCoordinator.getCsvData();
      expect(result).toEqual([]);
    });

    it("should return datasets from datasetsBuilder.getCsvData", async () => {
      const mockData = [
        { name: "dataset1", data: [1, 2, 3] },
        { name: "dataset2", data: [4, 5, 6] },
      ];
      datasetsBuilder.getCsvData = vi.fn().mockResolvedValue(mockData);

      const result = await plotCoordinator.getCsvData();

      const getCsvDataSpy = vi.spyOn(datasetsBuilder, "getCsvData");
      expect(result).toEqual(mockData);
      expect(getCsvDataSpy).toHaveBeenCalled();
    });
  });

  describe("getVisibleCsvData", () => {
    it("exports nothing before the chart has an x scale", async () => {
      const getCsvData = vi.fn().mockResolvedValue([]);
      datasetsBuilder.getCsvData = getCsvData;

      expect(await plotCoordinator.getVisibleCsvData()).toBeUndefined();
      expect(getCsvData).not.toHaveBeenCalled();
    });

    it("asks the builder for the visible x range only", async () => {
      const getCsvData = vi.fn().mockResolvedValue([]);
      datasetsBuilder.getCsvData = getCsvData;
      plotCoordinator["latestXScale"] = { min: 2, max: 9, left: 0, right: 100 };

      await plotCoordinator.getVisibleCsvData();

      expect(getCsvData).toHaveBeenCalledWith({ min: 2, max: 9 });
    });

    it("exports the analyzed time window of a spectrum, not its frequency range", async () => {
      const getCsvData = vi.fn().mockResolvedValue([]);
      datasetsBuilder.getCsvData = getCsvData;
      const config = PlotBuilder.config({
        xAxisVal: "timestamp",
        plotMode: "fft",
        timeWindow: "fixed",
        minXValue: 1,
        maxXValue: 3,
        paths: [],
      });
      plotCoordinator.handleConfig(config, "light", {});
      plotCoordinator["latestXScale"] = { min: 0, max: 50, left: 0, right: 100 };

      await plotCoordinator.getVisibleCsvData();
      plotCoordinator.handleConfig({ ...config, analysisRange: "all" }, "light", {});
      await plotCoordinator.getVisibleCsvData();

      expect(getCsvData.mock.calls).toEqual([[{ min: 1, max: 3 }], [undefined]]);
    });
  });
});
