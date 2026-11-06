// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@foxglove/comlink";
import { toSec, subtract as subtractTime } from "@foxglove/rostime";

import { ComlinkWrap } from "@lichtblick/den/worker";
import { Immutable, MessageEvent, Time } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { PlayerState } from "@lichtblick/suite-base/players/types";
import { getTimestampForMessage } from "@lichtblick/suite-base/util/time";

import {
  CsvDataset,
  GetViewportDatasetsResult,
  HandlePlayerStateResult,
  IDatasetsBuilder,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import type {
  DataItem,
  TimestampDatasetsBuilderImpl,
  UpdateDataAction,
} from "./TimestampDatasetsBuilderImpl";
import { buildCurrentSeriesActions, buildFullSeriesActions } from "./utils";
import { resolveChartDatum } from "../utils/datum";
import { getSeriesTimestamp } from "../utils/seriesTimestamp";

// If the datasets builder is garbage collected we also need to cleanup the worker
// This registry ensures the worker is cleaned up when the builder is garbage collected
const registry = new FinalizationRegistry<() => void>((dispose) => {
  dispose();
});

const emptyPaths = new Set<string>();

type TimestampSeriesItem = {
  config: Immutable<SeriesItem>;
};

/**
 * TimestampDatasetsBuilder builds timeseries datasets.
 *
 * It supports full (preload) data and current frame data. The series datums are extracted from
 * input player states and sent to the worker. The worker accumulates the data and provides
 * downsampled data.
 */
export class TimestampDatasetsBuilder implements IDatasetsBuilder {
  #datasetsBuilderRemote: Comlink.Remote<Comlink.RemoteObject<TimestampDatasetsBuilderImpl>>;

  #pendingDispatch: Immutable<UpdateDataAction>[] = [];

  #lastSeekTime = 0;

  #series: Immutable<TimestampSeriesItem[]> = [];
  // True once handleMessageRange has been called — indicates a range-capable source (file/bag).
  // When true, handlePlayerState skips append-current since the full history comes from the range.
  #hasRangeSource = false;

  public constructor() {
    const worker = new Worker(new URL("./TimestampDatasetsBuilderImpl.worker", import.meta.url));
    const { remote, dispose } =
      ComlinkWrap<Comlink.RemoteObject<TimestampDatasetsBuilderImpl>>(worker);
    this.#datasetsBuilderRemote = remote;

    registry.register(this, dispose);
  }

  public handlePlayerState(state: Immutable<PlayerState>): HandlePlayerStateResult | undefined {
    const activeData = state.activeData;
    if (!activeData) {
      return;
    }

    const didSeek = activeData.lastSeekTime !== this.#lastSeekTime;
    this.#lastSeekTime = activeData.lastSeekTime;

    const msgEvents = activeData.messages;
    let datasetsChanged = false;
    if (!this.#hasRangeSource && msgEvents.length > 0) {
      const { actions: seriesActions, datasetsChanged: seriesChanged } = buildCurrentSeriesActions(
        this.#series,
        { didSeek, hasRangeSource: this.#hasRangeSource },
        (config) => readMessagePathItems(msgEvents, config, activeData.startTime),
      );
      this.#pendingDispatch.push(...(seriesActions as UpdateDataAction[]));
      datasetsChanged ||= seriesChanged;
    }

    return {
      range: { min: 0, max: toSec(subtractTime(activeData.endTime, activeData.startTime)) },
      datasetsChanged,
    };
  }

  public handleMessageRange(
    messages: Immutable<MessageEvent[]>,
    options: { isReset: boolean },
    startTime: Immutable<Time>,
  ): void {
    this.#hasRangeSource = true;
    const topic = messages[0]?.topic;
    if (!topic) {
      return;
    }

    const actions = buildFullSeriesActions(this.#series, topic, options, (config) =>
      readMessagePathItems(messages, config, startTime),
    );
    this.#pendingDispatch.push(...(actions as UpdateDataAction[]));
  }

  public setSeries(series: Immutable<SeriesItem[]>): void {
    this.#series = series.map((item) => ({ config: item }));
    this.#pendingDispatch.push({
      type: "update-series-config",
      seriesItems: series,
    });
  }

  public async getViewportDatasets(
    viewport: Immutable<Viewport>,
  ): Promise<GetViewportDatasetsResult> {
    const dispatch = this.#pendingDispatch;
    if (dispatch.length > 0) {
      this.#pendingDispatch = [];
      await this.#datasetsBuilderRemote.applyActions(dispatch);
    }

    const datasets = await this.#datasetsBuilderRemote.getViewportDatasets(viewport);
    return { datasetsByConfigIndex: datasets, pathsWithMismatchedDataLengths: emptyPaths };
  }

  public async getCsvData(): Promise<CsvDataset[]> {
    return await this.#datasetsBuilderRemote.getCsvData();
  }
}

export function readMessagePathItems(
  events: Immutable<MessageEvent[]>,
  config: Immutable<Pick<SeriesItem, "parsed" | "timestampMethod" | "timestampParsed">>,
  startTime: Immutable<Time>,
): DataItem[] {
  const { parsed: path, timestampMethod, timestampParsed } = config;
  const out = [];
  for (const event of events) {
    if (event.topic !== path.topicName) {
      continue;
    }

    const timestamp = getSeriesTimestamp(event, timestampMethod, timestampParsed);
    if (!timestamp) {
      continue;
    }
    const headerStamp = getTimestampForMessage(event.message);
    const xValue = toSec(subtractTime(timestamp, startTime));

    const items = simpleGetMessagePathDataItems(event, path);
    for (const item of items) {
      const datum = resolveChartDatum(item);
      if (!datum) {
        continue;
      }

      out.push({
        x: xValue,
        y: datum.y,
        receiveTime: event.receiveTime,
        headerStamp,
        value: datum.value,
      });
    }
  }

  return out;
}
