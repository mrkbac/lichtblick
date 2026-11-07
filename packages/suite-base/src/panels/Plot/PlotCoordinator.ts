// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare as compareTime, subtract as subtractTime, toSec } from "@foxglove/rostime";
import EventEmitter from "eventemitter3";
import * as _ from "lodash-es";

import { debouncePromise } from "@lichtblick/den/async";
import { filterMap } from "@lichtblick/den/collection";
import Logger from "@lichtblick/log";
import { MessagePath, parseMessagePath } from "@lichtblick/message-path";
import { Immutable, Time } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { stringifyMessagePath } from "@lichtblick/suite-base/components/MessagePathSyntax/stringifyRosPath";
import { fillInGlobalVariablesInPath } from "@lichtblick/suite-base/components/MessagePathSyntax/useCachedGetMessagePathDataItems";
import { UseSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter/useSubscribeMessageRange";
import { Bounds1D } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { GlobalVariables } from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { MessageEvent, PlayerState, Topic } from "@lichtblick/suite-base/players/types";
import { Bounds } from "@lichtblick/suite-base/types/Bounds";
import { getContrastColor, getLineColor } from "@lichtblick/suite-base/util/plotColors";

import { OffscreenCanvasRenderer } from "./OffscreenCanvasRenderer";
import {
  CsvDataset,
  IDatasetsBuilder,
  PlotAnalysis,
  SeriesConfigKey,
  SeriesItem,
  Viewport,
} from "./builders/IDatasetsBuilder";
import { isDerivedSeries } from "./builders/utils";
import {
  ConfigBounds,
  Dataset,
  InteractionEvent,
  PixelRect,
  PlotCoordinatorEventTypes,
  Scale,
  UpdateAction,
  YScale,
  ZoomMode,
} from "./types";
import {
  getPlotMode,
  getTimeWindow,
  isReferenceLinePlotPathType,
  PlotAnalysisRange,
  PlotConfig,
} from "./utils/config";
import { getSeriesTimestamp } from "./utils/seriesTimestamp";
import { pathToSubscribePayload } from "./utils/subscription";

const log = Logger.getLogger(__filename);

const replaceUndefinedWithEmptyDataset = (dataset: Dataset | undefined) => dataset ?? { data: [] };

/** Window size of a sliding time window that has no size set yet */
export const DEFAULT_SLIDING_WINDOW_SECONDS = 10;

/**
 * PlotCoordinator interfaces commands and updates between the dataset builder and the chart
 * renderer. Uses subscribeMessageRange for full dataset history.
 */
export class PlotCoordinator extends EventEmitter<PlotCoordinatorEventTypes> {
  private renderer: OffscreenCanvasRenderer;
  private datasetsBuilder: IDatasetsBuilder;
  private shouldSync: boolean = false;
  private configBounds: ConfigBounds = { x: {}, y: {} };
  private configY2Bounds: Partial<Bounds1D> = {};
  /** Keep the playhead in the middle of a sliding window instead of at its right edge */
  private playheadCenter = false;
  /** Wheel zoom mode without modifier keys: x for time/index plots, xy for path x-axis plots */
  private defaultZoomMode: ZoomMode = "x";
  private absoluteTimeTicks = false;
  /** Start of the x-axis tick format last sent to the renderer; NaN = never sent */
  private sentTickStartSec: number | undefined = NaN;
  private globalBounds?: Immutable<Partial<Bounds1D>>;
  private datasetRange?: Bounds1D;
  private followRange?: number;
  private interactionBounds?: Bounds;
  private lastSeekTime = NaN;
  /** Normalized series from latest config */
  private series: Immutable<SeriesItem[]> = [];
  /** Current value for each series to show in the legend */
  private currentValuesByConfigIndex: unknown[] = [];
  /** Message time of each current value, for series not timed by receive time */
  private currentValueTimesByConfigIndex: (Time | undefined)[] = [];
  /** Flag indicating that new Y bounds should be sent to the renderer because the bounds have been reset */
  private shouldResetY = false;
  private holdYRange = false;
  private updateAction: UpdateAction = { type: "update" };
  private isTimeseriesPlot: boolean = false;
  /** FFT or histogram settings; undefined plots the time series. x/y then are frequency or value. */
  private analysis?: Omit<PlotAnalysis, "timeRange">;
  private analysisRange: PlotAnalysisRange = "visible";
  private currentSeconds?: number;
  private viewport: Viewport = {
    size: { width: 0, height: 0 },
    bounds: { x: undefined, y: undefined },
  };
  private latestXScale?: Scale;
  private latestYScale?: YScale;
  private queueDispatchRender = debouncePromise(this.dispatchRender.bind(this));
  private queueDispatchDownsample = debouncePromise(this.dispatchDownsample.bind(this));
  private queueDerivedValues = debouncePromise(this.dispatchDerivedValues.bind(this));
  /** Bumped on seeks and series changes so legend lookups started before them are dropped */
  private derivedGeneration = 0;
  private queueDatasetsRender = debouncePromise(this.dispatchDatasetsRender.bind(this));
  private destroyed = false;

  private readonly subscribeMessageRange: UseSubscribeMessageRange;
  private readonly rangeSubscriptionCancels = new Map<
    string,
    {
      cancel: () => void;
      seriesKeys: ReadonlySet<SeriesConfigKey>;
      active: boolean;
    }
  >();
  private startTime: Immutable<Time> | undefined;
  private seriesKeysByTopic = new Map<string, Set<SeriesConfigKey>>();
  /** Tracks activeData.topics reference to detect when topics change (e.g. user script update).*/
  private lastTopicsRef: readonly Topic[] | undefined;

  public constructor(
    renderer: OffscreenCanvasRenderer,
    builder: IDatasetsBuilder,
    subscribeMessageRange: UseSubscribeMessageRange,
  ) {
    super();
    this.renderer = renderer;
    this.datasetsBuilder = builder;
    this.subscribeMessageRange = subscribeMessageRange;
  }

  /** Stop the coordinator from sending any future updates to the renderer. */
  public destroy(): void {
    for (const { cancel } of this.rangeSubscriptionCancels.values()) {
      cancel();
    }
    this.rangeSubscriptionCancels.clear();
    this.destroyed = true;
  }

  private isDestroyed(): boolean {
    return this.destroyed;
  }

  public setShouldSync({ shouldSync }: { shouldSync: boolean }): void {
    this.shouldSync = shouldSync;
  }

  public handlePlayerState(state: Immutable<PlayerState>): void {
    if (this.isDestroyed()) {
      return;
    }

    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const { messages, lastSeekTime, currentTime, startTime } = activeData;
    this.startTime = startTime;
    this.updateTickFormat();

    // When individual topic object references change (e.g. user script source code updated),
    // mark only the affected subscriptions as inactive so subscribeTopicRanges re-creates
    // them with fresh batch iterators, leaving unaffected topics untouched.
    if (activeData.topics !== this.lastTopicsRef) {
      const oldTopicsByName = new Map<string, Topic>();
      if (this.lastTopicsRef) {
        for (const topic of this.lastTopicsRef) {
          oldTopicsByName.set(topic.name, topic);
        }
      }
      this.lastTopicsRef = activeData.topics;

      for (const [topicName, entry] of this.rangeSubscriptionCancels) {
        const oldTopic = oldTopicsByName.get(topicName);
        const newTopic = activeData.topics.find((t) => t.name === topicName);
        // Invalidate if the topic is new or its object reference changed
        if (oldTopic == undefined || oldTopic !== newTopic) {
          entry.active = false;
        }
      }
    }

    this.subscribeTopicRanges(this.seriesKeysByTopic);

    if (this.isTimeseriesPlot) {
      this.updateCurrentSeconds(toSec(subtractTime(currentTime, startTime)));
    }

    if (lastSeekTime !== this.lastSeekTime) {
      this.derivedGeneration += 1;
      this.currentValuesByConfigIndex = [];
      this.currentValueTimesByConfigIndex = [];
      // The first player state is no seek: there is no held range yet
      if (!Number.isNaN(this.lastSeekTime)) {
        this.updateAction.resetHeldYRange = true;
        this.queueDispatchRender();
      }
      this.lastSeekTime = lastSeekTime;
    }

    for (const seriesItem of this.series) {
      if (this.showsDerivedValue(seriesItem)) {
        // the legend shows the plotted value, which comes from the datasets builder
        continue;
      }
      if (seriesItem.timestampMethod !== "receiveTime") {
        this.updateStampedCurrentValue(seriesItem, messages);
        continue;
      }
      for (let i = messages.length - 1; i >= 0; --i) {
        const msgEvent = messages[i]!;
        if (msgEvent.topic !== seriesItem.parsed.topicName) {
          continue;
        }
        const items = simpleGetMessagePathDataItems(msgEvent, seriesItem.parsed);
        if (items.length > 0) {
          this.currentValuesByConfigIndex[seriesItem.configIndex] = items[items.length - 1];
          break;
        }
      }
    }

    this.emit("currentValuesChanged", this.currentValuesByConfigIndex);

    const handlePlayerStateResult = this.datasetsBuilder.handlePlayerState(state);
    // after the builder has this frame's data
    this.queueDerivedValues();

    if (!handlePlayerStateResult) {
      this.datasetRange = undefined;
      this.queueDispatchRender();
      return;
    }

    const newRange = handlePlayerStateResult.range;

    // If the range has changed we will trigger a render to incorporate the new range into the chart
    // axis
    if (!_.isEqual(this.datasetRange, newRange)) {
      this.datasetRange = handlePlayerStateResult.range;
      this.queueDispatchRender();
    }

    if (handlePlayerStateResult.datasetsChanged) {
      this.queueDispatchDownsample();
    }
  }

  /** The legend value of a series computed across samples is its plotted value, not the raw one */
  private showsDerivedValue(seriesItem: Immutable<SeriesItem>): boolean {
    return this.datasetsBuilder.getDerivedValuesAt != undefined && isDerivedSeries(seriesItem);
  }

  /** Fetch the plotted value at the current time of each series computed across samples */
  private async dispatchDerivedValues(): Promise<void> {
    const getDerivedValuesAt = this.datasetsBuilder.getDerivedValuesAt?.bind(this.datasetsBuilder);
    const x = this.currentSeconds;
    const derived = this.series.filter((item) => this.showsDerivedValue(item));
    if (this.isDestroyed() || !getDerivedValuesAt || x == undefined || derived.length === 0) {
      return;
    }
    const generation = this.derivedGeneration;
    let values: readonly unknown[];
    try {
      values = await getDerivedValuesAt(x);
    } catch (error: unknown) {
      log.error("Failed to read plotted legend values", error);
      return;
    }
    // A seek or series change while waiting makes the result stale; a newer lookup is queued
    if (this.isDestroyed() || generation !== this.derivedGeneration) {
      return;
    }
    let changed = false;
    for (const { configIndex } of derived) {
      // series are compacted (reference lines and invalid paths are skipped): find by index
      const current = this.series.find((item) => item.configIndex === configIndex);
      if (current == undefined || !this.showsDerivedValue(current)) {
        continue;
      }
      if (this.currentValuesByConfigIndex[configIndex] !== values[configIndex]) {
        this.currentValuesByConfigIndex[configIndex] = values[configIndex];
        changed = true;
      }
    }
    if (changed) {
      this.emit("currentValuesChanged", this.currentValuesByConfigIndex);
    }
  }

  /**
   * Messages timed by a header stamp or field can arrive out of order, so the current value is the
   * one with the latest message time seen since the last seek.
   */
  private updateStampedCurrentValue(
    seriesItem: Immutable<SeriesItem>,
    messages: Immutable<MessageEvent[]>,
  ): void {
    const { configIndex, parsed, timestampMethod, timestampParsed } = seriesItem;
    for (const msgEvent of messages) {
      if (msgEvent.topic !== parsed.topicName) {
        continue;
      }
      const time = getSeriesTimestamp(msgEvent, timestampMethod, timestampParsed);
      const latest = this.currentValueTimesByConfigIndex[configIndex];
      if (!time || (latest && compareTime(time, latest) < 0)) {
        continue;
      }
      const items = simpleGetMessagePathDataItems(msgEvent, parsed);
      if (items.length > 0) {
        this.currentValuesByConfigIndex[configIndex] = items[items.length - 1];
        this.currentValueTimesByConfigIndex[configIndex] = time;
      }
    }
  }

  public handleConfig(
    config: Immutable<PlotConfig>,
    colorScheme: "light" | "dark",
    globalVariables: GlobalVariables,
    resolveEnumNames: (path: MessagePath) => MessagePath = (path) => path,
  ): void {
    if (this.isDestroyed()) {
      return;
    }
    this.isTimeseriesPlot = config.xAxisVal === "timestamp";
    const plotMode = getPlotMode(config);
    const analysis =
      plotMode === "time"
        ? undefined
        : { mode: plotMode, bins: plotMode === "histogram" ? config.histogramBins : undefined };
    if (analysis?.mode !== this.analysis?.mode) {
      // Zoom on a time axis means nothing on a frequency or value axis, and vice versa
      this.interactionBounds = undefined;
      this.shouldResetY = true;
    }
    this.analysis = analysis;
    this.analysisRange = config.analysisRange ?? "visible";
    if (!this.isTimeseriesPlot) {
      this.currentSeconds = undefined;
    }
    // Plots with a path x-axis only have fixed (or automatic) bounds.
    const timeWindow = this.isTimeseriesPlot ? getTimeWindow(config) : "fixed";
    this.followRange =
      timeWindow === "sliding"
        ? (config.followingViewWidth ?? DEFAULT_SLIDING_WINDOW_SECONDS)
        : undefined;
    this.playheadCenter = config.playheadPosition === "center";
    this.absoluteTimeTicks =
      this.isTimeseriesPlot && !this.analysis && config.timestampFormat === "absolute";
    this.updateTickFormat();

    const isPathXAxis = config.xAxisVal === "custom" || config.xAxisVal === "currentCustom";
    const defaultZoomMode: ZoomMode = isPathXAxis ? "xy" : "x";
    if (defaultZoomMode !== this.defaultZoomMode) {
      this.defaultZoomMode = defaultZoomMode;
      this.updateAction.zoomMode = defaultZoomMode;
    }
    this.updateAction.equalAxes = isPathXAxis && config.axisScales === "equal";

    const newConfigBounds = {
      x:
        timeWindow === "fixed"
          ? {
              max: config.maxXValue,
              min: config.minXValue,
            }
          : {},
      // Configured y bounds are for the time series, not for magnitudes or counts
      y: this.analysis
        ? {}
        : {
            max: config.maxYValue == undefined ? undefined : +config.maxYValue,
            min: config.minYValue == undefined ? undefined : +config.minYValue,
          },
    };
    const configYBoundsChanged =
      this.configBounds.y.min !== newConfigBounds.y.min ||
      this.configBounds.y.max !== newConfigBounds.y.max;
    this.configBounds = newConfigBounds;

    const newY2Bounds = this.analysis ? {} : { min: config.minY2Value, max: config.maxY2Value };
    if (!_.isEqual(newY2Bounds, this.configY2Bounds)) {
      this.configY2Bounds = newY2Bounds;
      this.updateAction.y2Bounds = newY2Bounds;
    }

    const referenceLines = filterMap(config.paths, (path, idx) => {
      if (!path.enabled || !isReferenceLinePlotPathType(path)) {
        return;
      }

      const value = +path.value;
      if (Number.isNaN(value)) {
        return;
      }

      const label = path.label?.trim();
      const vertical = path.referenceLineAxis === "x";
      // Shading compares series values with the line, which an FFT or histogram doesn't plot
      const shade =
        !vertical && !this.analysis && path.referenceLineShade !== "none"
          ? path.referenceLineShade
          : undefined;
      const shadeSeriesPath = path.referenceLineShadeSeries;
      return {
        color: getLineColor(path.color, idx),
        value,
        scaleID: vertical
          ? ("x" as const)
          : path.axis === "secondary"
            ? ("y2" as const)
            : ("y" as const),
        label: label === "" ? undefined : label,
        dashed: path.referenceLineDashed,
        width: path.lineSize,
        shade,
        shadeSeries:
          shade && shadeSeriesPath != undefined && shadeSeriesPath !== ""
            ? config.paths.flatMap((other, otherIdx) =>
                other.value === shadeSeriesPath ? [otherIdx] : [],
              )
            : undefined,
      };
    });

    this.updateAction.showXAxisLabels = config.showXAxisLabels;
    this.updateAction.showYAxisLabels = config.showYAxisLabels;
    // An empty label clears one shown before, e.g. a mode's default label after switching modes
    this.updateAction.xAxisLabel = config.xAxisLabel ?? "";
    this.updateAction.yAxisLabel = config.yAxisLabel ?? "";
    this.updateAction.referenceLines = referenceLines;
    this.updateAction.yLogScale = config.yAxisLogScale ?? false;
    this.updateAction.y2LogScale = config.y2AxisLogScale ?? false;
    this.updateAction.showXAxisGrid = config.showXAxisGrid ?? true;
    this.updateAction.showYAxisGrid = config.showYAxisGrid ?? true;
    this.updateAction.y2Axis = {
      display: config.paths.some((path) => path.enabled && path.axis === "secondary"),
      showLabels: config.showY2AxisLabels ?? true,
      label: config.y2AxisLabel ?? "",
      showGrid: config.showY2AxisGrid ?? false,
    };

    const holdYRange = config.yRangeMode === "hold";
    if (holdYRange !== this.holdYRange) {
      this.holdYRange = holdYRange;
      this.updateAction.holdYRange = holdYRange;
    }

    if (configYBoundsChanged) {
      // Config changes to yBounds always takes precedence over user interaction changes like pan/zoom
      this.updateAction.yBounds = this.configBounds.y;
    }
    const newSeriesKeysByTopic = new Map<string, Set<SeriesConfigKey>>();
    const newCurrentValuesByConfigIndex: unknown[] = [];
    const newCurrentValueTimesByConfigIndex: (Time | undefined)[] = [];
    const newSeries = filterMap(config.paths, (path, idx): Immutable<SeriesItem> | undefined => {
      if (isReferenceLinePlotPathType(path)) {
        return;
      }

      const parsed = parseMessagePath(path.value);
      if (!parsed) {
        return;
      }

      const filledParsed = resolveEnumNames(fillInGlobalVariablesInPath(parsed, globalVariables));

      // A series' own x path only applies to accumulated path plots
      const xPath = config.xAxisVal === "custom" ? path.xValue?.trim() : undefined;
      const xParsedRaw = xPath ? parseMessagePath(xPath) : undefined;
      const xParsed = xParsedRaw
        ? fillInGlobalVariablesInPath(xParsedRaw, globalVariables)
        : undefined;

      // When global variables change the path.value is still the original value with the variable
      // names But we need to consider this as a new series (new block cursor) so we compute new
      // values when variables cause the resolved path value to update.
      //
      // We also want to re-compute values when the timestamp method changes. So we use a _key_ that
      // is the filled path and the timestamp method. If either change, we consider this a new
      // series.
      //
      // This key lets us treat series with the same name but different timestamp methods as distinct
      // using a key instead of the path index lets us preserve loaded data when a path is removed
      // The custom time field is read from the same messages, like the series' own x path
      const timestampPath =
        path.timestampMethod === "customField" ? path.timestampPath?.trim() : undefined;
      const timestampParsedRaw = timestampPath ? parseMessagePath(timestampPath) : undefined;
      const timestampParsed =
        timestampParsedRaw != undefined && timestampParsedRaw.topicName === filledParsed.topicName
          ? fillInGlobalVariablesInPath(timestampParsedRaw, globalVariables)
          : undefined;

      const xKey = xParsed ? `:x=${stringifyMessagePath(xParsed)}` : "";
      const timeKey = timestampParsed ? `:t=${stringifyMessagePath(timestampParsed)}` : "";
      const key = `${idx}:${path.timestampMethod}:${stringifyMessagePath(
        filledParsed,
      )}${xKey}${timeKey}` as SeriesConfigKey;

      // Keep current values for paths that match existing ones, unless the legend switches
      // between the raw and the plotted value (moving average or stream modifier toggled)
      const existingSeries = this.series.find((series) => series.key === key);
      if (
        existingSeries != undefined &&
        isDerivedSeries(existingSeries) ===
          isDerivedSeries({ parsed: filledParsed, smoothing: path.smoothing })
      ) {
        newCurrentValuesByConfigIndex[idx] =
          this.currentValuesByConfigIndex[existingSeries.configIndex];
        newCurrentValueTimesByConfigIndex[idx] =
          this.currentValueTimesByConfigIndex[existingSeries.configIndex];
      }

      const color = getLineColor(path.color, idx);

      if (pathToSubscribePayload(filledParsed, "full") != undefined) {
        const keys = newSeriesKeysByTopic.get(filledParsed.topicName) ?? new Set<SeriesConfigKey>();
        keys.add(key);
        newSeriesKeysByTopic.set(filledParsed.topicName, keys);
      }

      return {
        key,
        configIndex: idx,
        messagePath: path.value,
        parsed: filledParsed,
        color,
        contrastColor: getContrastColor(colorScheme, color),
        lineSize: path.lineSize ?? 1.0,
        timestampMethod: path.timestampMethod,
        showLine: path.showLine ?? true,
        enabled: path.enabled,
        interpolation: path.interpolation ?? "linear",
        yAxisID: path.axis === "secondary" ? "y2" : "y",
        smoothing: path.smoothing ?? 0,
        xParsed,
        timestampParsed,
      };
    });

    // If the builder uses a separate x-axis topic (e.g. custom x-axis), subscribe to it too.
    const xTopic = this.datasetsBuilder.getXTopic?.();
    if (xTopic && !newSeriesKeysByTopic.has(xTopic)) {
      newSeriesKeysByTopic.set(xTopic, new Set<SeriesConfigKey>());
    }

    this.seriesKeysByTopic = newSeriesKeysByTopic;
    const seriesChanged =
      newSeries.length !== this.series.length ||
      newSeries.some((item, idx) => {
        const old = this.series[idx];
        return (
          item.key !== old?.key || item.enabled !== old.enabled || item.yAxisID !== old.yAxisID
        );
      });
    if (seriesChanged) {
      // A removed or moved series' old extremes no longer belong on the axis
      this.updateAction.resetHeldYRange = true;
    }
    this.series = newSeries;

    this.currentValuesByConfigIndex = newCurrentValuesByConfigIndex;
    this.currentValueTimesByConfigIndex = newCurrentValueTimesByConfigIndex;
    this.emit("currentValuesChanged", this.currentValuesByConfigIndex);

    // Dispatch because bounds changed
    this.queueDispatchRender();

    // Dispatch since we might have series changes
    this.datasetsBuilder.setSeries(this.series);
    this.queueDispatchDownsample();
    this.derivedGeneration += 1;
    this.queueDerivedValues();
  }

  public setGlobalBounds(bounds: Immutable<Bounds1D> | undefined): void {
    this.globalBounds = bounds;
    // Synced time bounds pick the analyzed window; the zoom of a spectrum or histogram stays
    if (!this.analysis) {
      this.interactionBounds = undefined;
    }
    if (bounds == undefined && !this.analysis) {
      // This happens when "reset view" is clicked in a different panel or otherwise cleared the global bounds
      this.shouldResetY = true;
    }
    this.queueDispatchRender();
  }

  public setZoomMode(mode: ZoomMode): void {
    this.updateAction.zoomMode = mode;
    this.queueDispatchRender();
  }

  /** Back to the zoom mode of this plot type, after a zoom-mode key is released. */
  public resetZoomMode(): void {
    this.setZoomMode(this.defaultZoomMode);
  }

  /** Box zoom to a canvas-pixel rectangle */
  public async zoomToPixelRect(rect: PixelRect, mode: ZoomMode): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }
    const bounds = await this.renderer.zoomToRect(rect, mode);
    if (this.isDestroyed() || !bounds) {
      return;
    }
    this.interactionBounds = bounds;
    if (this.shouldSync && mode !== "y" && !this.analysis) {
      this.emit("timeseriesBounds", bounds.x);
    }
    this.queueDispatchRender();
  }

  public resetBounds(): void {
    this.interactionBounds = undefined;
    // Resetting a spectrum or histogram zoom keeps the synced time window it analyzes
    if (!this.analysis) {
      this.globalBounds = undefined;
    }
    this.shouldResetY = true;
    this.queueDispatchRender();
  }

  public setSize(size: { width: number; height: number }): void {
    this.viewport.size = size;
    this.updateAction.size = size;
    this.queueDispatchRender();
    this.queueDispatchDownsample();
  }

  public addInteractionEvent(ev: InteractionEvent): void {
    this.updateAction.interactionEvents ??= [];
    this.updateAction.interactionEvents.push(ev);
    this.queueDispatchRender();
  }

  /** Get the plot x value at the canvas pixel x location */
  public getXValueAtPixel(pixelX: number): number {
    if (!this.latestXScale) {
      return -1;
    }

    const pixelRange = this.latestXScale.right - this.latestXScale.left;
    if (pixelRange <= 0) {
      return -1;
    }

    // Linear interpolation to place the pixelX value within min/max
    return (
      this.latestXScale.min +
      ((pixelX - this.latestXScale.left) / pixelRange) *
        (this.latestXScale.max - this.latestXScale.min)
    );
  }

  /** Get the entire data for all series */
  public async getCsvData(xRange?: Immutable<Bounds1D>): Promise<CsvDataset[]> {
    if (this.isDestroyed()) {
      return [];
    }
    return await this.datasetsBuilder.getCsvData(xRange);
  }

  /** The data of all series within the visible x range */
  /** Undefined until the chart has drawn an x axis, since the visible range is unknown before. */
  public async getVisibleCsvData(): Promise<CsvDataset[] | undefined> {
    // A spectrum's or histogram's x is not time: export the samples it analyzes
    if (this.analysis) {
      const timeRange = this.getAnalysis()?.timeRange;
      return await this.getCsvData(
        timeRange && { min: timeRange.min ?? -Infinity, max: timeRange.max ?? Infinity },
      );
    }
    const scale = this.latestXScale;
    if (!scale) {
      return undefined;
    }
    return await this.getCsvData({ min: scale.min, max: scale.max });
  }

  private updateCurrentSeconds(secondsSinceStart: number): void {
    const moved = secondsSinceStart !== this.currentSeconds;
    // Set the time first: queueDispatchRender may start rendering right away and reads it.
    this.currentSeconds = secondsSinceStart;
    // In follow mode the x-axis window ends at the current time. A source with a fixed range
    // (file playback) never changes the dataset range, so nothing else would re-render the axis
    // and it would stay where the panel was first drawn. A zoomed/panned or synced x-axis does not
    // follow the time, so there is nothing to re-render then.
    const zoomed = this.analysis
      ? this.analysisRange === "all"
      : this.interactionBounds != undefined;
    if (this.followRange != undefined && moved && !zoomed && !this.globalBounds) {
      this.queueDispatchRender();
    }
  }

  /** Send the x tick format when the absolute-time setting or the data start changes. */
  private updateTickFormat(): void {
    const startSec = this.absoluteTimeTicks && this.startTime ? toSec(this.startTime) : undefined;
    if (startSec !== this.sentTickStartSec) {
      this.sentTickStartSec = startSec;
      this.updateAction.xTickFormat = { absoluteStartSec: startSec };
      this.queueDispatchRender();
    }
  }

  private canReset(): boolean {
    // Reset view also forgets a held y range
    if (this.interactionBounds || this.holdYRange) {
      return true;
    }
    if (this.analysis) {
      return false;
    }

    if (this.globalBounds) {
      const resetBounds = this.getXResetBounds();
      return this.globalBounds.min !== resetBounds.min || this.globalBounds.max !== resetBounds.max;
    }

    return false;
  }

  private getXResetBounds(): Partial<Bounds1D> {
    const currentSecondsIfFollowMode =
      this.isTimeseriesPlot && this.followRange != undefined && this.currentSeconds != undefined
        ? this.currentSeconds + (this.playheadCenter ? this.followRange / 2 : 0)
        : undefined;
    const xMax = currentSecondsIfFollowMode ?? this.configBounds.x.max ?? this.datasetRange?.max;

    const xMinIfFollowMode =
      this.isTimeseriesPlot && this.followRange != undefined && xMax != undefined
        ? xMax - this.followRange
        : undefined;
    const xMin = xMinIfFollowMode ?? this.configBounds.x.min ?? this.datasetRange?.min;

    return { min: xMin, max: xMax };
  }

  private getXBounds(): Partial<Bounds1D> {
    if (this.analysis) {
      return { min: this.interactionBounds?.x.min, max: this.interactionBounds?.x.max };
    }
    const resetBounds = this.getXResetBounds();
    return {
      min: this.interactionBounds?.x.min ?? this.globalBounds?.min ?? resetBounds.min,
      max: this.interactionBounds?.x.max ?? this.globalBounds?.max ?? resetBounds.max,
    };
  }

  /** The analyzed samples: the time window a time plot would show, or everything */
  private getAnalysis(): PlotAnalysis | undefined {
    if (!this.analysis) {
      return undefined;
    }
    if (this.analysisRange === "all") {
      return this.analysis;
    }
    const resetBounds = this.getXResetBounds();
    const timeRange = {
      min: this.globalBounds?.min ?? resetBounds.min,
      max: this.globalBounds?.max ?? resetBounds.max,
    };
    return { ...this.analysis, timeRange };
  }

  private async dispatchRender(): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }
    this.updateAction.xBounds = this.getXBounds();

    if (this.shouldResetY) {
      const yMin = this.interactionBounds?.y.min ?? this.configBounds.y.min;
      const yMax = this.interactionBounds?.y.max ?? this.configBounds.y.max;
      this.updateAction.yBounds = { min: yMin, max: yMax };
      this.updateAction.y2Bounds = this.configY2Bounds;
      this.updateAction.resetHeldYRange = true;
      this.shouldResetY = false;
    }

    const haveInteractionEvents = (this.updateAction.interactionEvents?.length ?? 0) > 0;

    const action = this.updateAction;
    this.updateAction = { type: "update" };

    const bounds = await this.renderer.update(action);
    if (this.isDestroyed()) {
      return;
    }

    if (haveInteractionEvents) {
      this.interactionBounds = bounds;
    }

    if (haveInteractionEvents && bounds && this.shouldSync && !this.analysis) {
      this.emit("timeseriesBounds", bounds.x);
    }

    this.emit("viewportChange", this.canReset());

    // The viewport has changed from some render interactions so we need to consider new datasets
    const x = this.getXBounds();
    const y = this.interactionBounds?.y ?? this.configBounds.y;
    const analysis = this.getAnalysis();
    if (
      !_.isEqual(this.viewport.bounds.x, x) ||
      !_.isEqual(this.viewport.bounds.y, y) ||
      !_.isEqual(this.viewport.analysis, analysis)
    ) {
      this.viewport.bounds.x = x;
      this.viewport.bounds.y = y;
      this.viewport.analysis = analysis;
      this.queueDispatchDownsample();
    }
  }

  /** Dispatch getting the latest downsampled datasets and then queue rendering them */
  private async dispatchDownsample(): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }

    const result = await this.datasetsBuilder.getViewportDatasets(this.viewport);
    if (this.isDestroyed()) {
      return;
    }
    this.emit("pathsWithMismatchedDataLengthsChanged", [...result.pathsWithMismatchedDataLengths]);

    // Use Array.from to fill in any `undefined` entries with an empty dataset (`map` would not
    // work for sparse arrays)
    const datasets = Array.from(result.datasetsByConfigIndex, replaceUndefinedWithEmptyDataset);
    this.queueDatasetsRender(datasets);
    // preloaded data may have just reached the current time
    this.queueDerivedValues();
  }

  /** Render the provided datasets */
  private async dispatchDatasetsRender(datasets: Dataset[]): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }

    const scales = await this.renderer.updateDatasets(datasets);
    if (this.isDestroyed()) {
      return;
    }
    this.latestXScale = scales.x;
    this.latestYScale = scales.y;
    this.emit("xScaleChanged", this.latestXScale);
    this.emit("yScaleChanged", this.latestYScale);
  }

  private cancelTopicSubscription(topic: string): void {
    this.rangeSubscriptionCancels.get(topic)?.cancel();
    this.rangeSubscriptionCancels.delete(topic);
  }

  private seriesKeysChanged(
    previousKeys: ReadonlySet<SeriesConfigKey>,
    currentKeys: ReadonlySet<SeriesConfigKey>,
  ): boolean {
    if (previousKeys.size !== currentKeys.size) {
      return true;
    }
    for (const key of currentKeys) {
      if (!previousKeys.has(key)) {
        return true;
      }
    }
    return false;
  }

  private subscribeTopicRanges(seriesKeysByTopic: Map<string, Set<SeriesConfigKey>>): void {
    const handleMessageRange = this.datasetsBuilder.handleMessageRange?.bind(this.datasetsBuilder);

    if (!handleMessageRange) {
      return;
    }

    // Cancel subscriptions for topics that are no longer needed
    for (const topic of this.rangeSubscriptionCancels.keys()) {
      if (!seriesKeysByTopic.has(topic)) {
        this.cancelTopicSubscription(topic);
      }
    }

    // Start subscriptions only for new or changed topics
    for (const [topic, currentKeys] of seriesKeysByTopic) {
      const existing = this.rangeSubscriptionCancels.get(topic);
      if (existing?.seriesKeys) {
        // Retry if previous subscription was inactive (no-op cancel from missing getBatchIterator)
        if (!this.seriesKeysChanged(existing.seriesKeys, currentKeys) && existing.active) {
          continue;
        }
        this.cancelTopicSubscription(topic);
      }

      // Use a mutable container so the async onNewRangeIterator callback can update `active`
      // after it fires. Without this, `active` would always be `false` because it's captured
      // synchronously before the async callback runs, causing every frame to cancel and
      // recreate all subscriptions.
      const entry: {
        cancel: () => void;
        seriesKeys: ReadonlySet<SeriesConfigKey>;
        active: boolean;
      } = {
        cancel: () => {},
        seriesKeys: new Set(currentKeys),
        active: false,
      };

      const cancel = this.subscribeMessageRange({
        topic,
        onNewRangeIterator: async (batchIterator) => {
          entry.active = true;
          let isReset = true;
          for await (const batch of batchIterator) {
            if (this.isDestroyed()) {
              return;
            }
            const startTime = this.startTime;
            if (!startTime) {
              continue;
            }
            handleMessageRange(batch, { isReset }, startTime);
            isReset = false;
            this.queueDispatchDownsample();
          }
        },
      });

      entry.cancel = cancel;
      this.rangeSubscriptionCancels.set(topic, entry);
    }
  }
}
