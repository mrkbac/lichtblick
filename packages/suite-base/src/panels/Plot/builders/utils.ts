// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { pushAll } from "@lichtblick/den/collection";
import { STREAM_MODIFIERS } from "@lichtblick/message-path";
import { Immutable, MessageEvent } from "@lichtblick/suite";

import {
  GetViewportDatasetsResult,
  MessageRangeOptions,
  SeriesConfigKey,
  SeriesItem,
} from "./IDatasetsBuilder";
import { CurrentFrameSeriesItem } from "./types";
import { Dataset } from "../types";

/**
 * Series item type shared by builders that work only with the current frame (no accumulation).
 * Used by IndexDatasetsBuilder and CurrentCustomDatasetsBuilder.
 */
const emptyPaths = new Set<string>();

/**
 * True when the plotted y is computed across samples (a stream modifier like `.@derivative`, or a
 * moving average), so it differs from the value in the latest message.
 */
export function isDerivedSeries(
  config: Immutable<Pick<SeriesItem, "parsed" | "smoothing">>,
): boolean {
  const { modifier } = config.parsed;
  return (
    (modifier != undefined && STREAM_MODIFIERS.includes(modifier)) ||
    Math.round(config.smoothing ?? 0) > 1
  );
}

/**
 * Builds the chart.js dataset styling fields derived from a series config. Shared by builders
 * that render full/current data (CustomDatasetsBuilderImpl, TimestampDatasetsBuilderImpl) and
 * `setSeries` below for builders that only track the current frame.
 */
export function buildDatasetStyle(config: Immutable<SeriesItem>): Omit<Dataset, "data"> {
  const { color, contrastColor, showLine, lineSize, lineDash, interpolation, yAxisID } = config;
  return {
    borderColor: color,
    showLine,
    // "before" draws the horizontal segment first, i.e. holds each value until the next sample.
    stepped: interpolation === "step" ? "before" : false,
    yAxisID: yAxisID ?? "y",
    fill: false,
    borderWidth: lineSize,
    borderDash: lineDash != undefined ? [...lineDash] : [],
    pointRadius: lineSize * 1.2,
    pointHoverRadius: 3,
    pointBackgroundColor: showLine ? contrastColor : color,
    pointBorderColor: "transparent",
  };
}

/**
 * Rebuilds the series map from a new config array, preserving existing dataset data for
 * matching keys and updating chart.js styling properties.
 */
export function setSeries(
  existing: ReadonlyMap<SeriesConfigKey, CurrentFrameSeriesItem>,
  series: Immutable<SeriesItem[]>,
): Map<SeriesConfigKey, CurrentFrameSeriesItem> {
  const newSeries = new Map<SeriesConfigKey, CurrentFrameSeriesItem>();

  for (const item of series) {
    let existingSeries = existing.get(item.key);
    existingSeries ??= {
      configIndex: item.configIndex,
      enabled: item.enabled,
      messagePath: item.messagePath,
      parsed: item.parsed,
      dataset: { data: [] },
    };

    existingSeries.configIndex = item.configIndex;
    existingSeries.enabled = item.enabled;
    existingSeries.dataset = {
      ...existingSeries.dataset,
      ...buildDatasetStyle(item),
    };

    newSeries.set(item.key, existingSeries);
  }

  return newSeries;
}

/**
 * Builds a GetViewportDatasetsResult from a series map. No downsampling is performed —
 * suitable for builders that process only the current frame.
 */
export function buildViewportDatasets(
  seriesByKey: ReadonlyMap<SeriesConfigKey, CurrentFrameSeriesItem>,
  pathsWithMismatchedDataLengths: ReadonlySet<string> = emptyPaths,
): GetViewportDatasetsResult {
  const datasets: Dataset[] = [];
  for (const series of seriesByKey.values()) {
    if (series.enabled) {
      datasets[series.configIndex] = series.dataset;
    }
  }
  return { datasetsByConfigIndex: datasets, pathsWithMismatchedDataLengths };
}

export function lastMatchingTopic(
  msgEvents: Immutable<MessageEvent[]>,
  topic: string,
): MessageEvent | undefined {
  return msgEvents.findLast((msgEvent) => msgEvent.topic === topic);
}

type SeriesCurrentAction<T> = { type: "append-current"; series: SeriesConfigKey; items: T[] };

/**
 * Appends the items returned by `getItems` to each series. Returns whether any series produced
 * items. Only used without a range source (e.g. UserScript output topics): the accumulated data
 * can't be reloaded, so a seek doesn't reset it here.
 *
 * Shared by TimestampDatasetsBuilder and CustomDatasetsBuilder for current-frame y-series
 * processing.
 */
export function buildCurrentSeriesActions<TItem>(
  series: Immutable<Array<{ config: Immutable<SeriesItem> }>>,
  getItems: (config: Immutable<SeriesItem>) => TItem[],
): { actions: SeriesCurrentAction<TItem>[]; datasetsChanged: boolean } {
  let datasetsChanged = false;
  const actions: SeriesCurrentAction<TItem>[] = [];
  for (const s of series) {
    const items = getItems(s.config);
    datasetsChanged ||= items.length > 0;
    actions.push({ type: "append-current", series: s.config.key, items });
  }
  return { actions, datasetsChanged };
}

/**
 * The batches of an earlier window as one append per series (and x-axis), items in order, so the
 * worker inserts the window into place once.
 */
export function mergeAppends<
  A extends { readonly type: string; readonly series?: SeriesConfigKey; readonly items?: unknown },
>(actions: readonly A[]): A[] {
  const out: A[] = [];
  const itemsByKey = new Map<string, unknown[]>();
  for (const action of actions) {
    if (!Array.isArray(action.items)) {
      out.push(action);
      continue;
    }
    const key = `${action.type}\0${action.series ?? ""}`;
    let items = itemsByKey.get(key);
    if (!items) {
      items = [];
      itemsByKey.set(key, items);
      out.push({ ...action, items });
    }
    pushAll(items, action.items);
  }
  return out;
}

type SeriesFullAction<T> =
  | { type: "reset-full"; series: SeriesConfigKey }
  | { type: "append-full"; series: SeriesConfigKey; items: T[] };

/**
 * Iterates over each series whose topic matches `topic`, optionally pushing a reset-full action
 * when isReset is true, then appending non-empty items returned by `getItems`.
 *
 * Shared by TimestampDatasetsBuilder and CustomDatasetsBuilder for range y-series processing.
 */
export function buildFullSeriesActions<TItem>(
  series: Immutable<Array<{ config: Immutable<SeriesItem> }>>,
  topic: string,
  options: Immutable<MessageRangeOptions>,
  getItems: (config: Immutable<SeriesItem>) => TItem[],
): SeriesFullAction<TItem>[] {
  const actions: SeriesFullAction<TItem>[] = [];
  for (const s of series) {
    if (
      s.config.parsed.topicName !== topic ||
      (options.seriesKeys != undefined && !options.seriesKeys.has(s.config.key))
    ) {
      continue;
    }
    if (options.isReset) {
      actions.push({ type: "reset-full", series: s.config.key });
    }
    const items = getItems(s.config);
    if (items.length > 0) {
      actions.push({ type: "append-full", series: s.config.key, items });
    }
  }
  return actions;
}
