// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as Comlink from "@foxglove/comlink";
import * as _ from "lodash-es";

import { pushAll } from "@lichtblick/den/collection";
import { ComlinkWrap } from "@lichtblick/den/worker";
import { MessagePath } from "@lichtblick/message-path";
import { Immutable, MessageEvent } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { Bounds1D } from "@lichtblick/suite-base/components/TimeBasedChart/types";
import { PlayerState } from "@lichtblick/suite-base/players/types";
import { extendBounds1D, unionBounds1D } from "@lichtblick/suite-base/types/Bounds";

import {
  CustomDatasetsBuilderImpl,
  UpdateDataAction,
  ValueItem,
} from "./CustomDatasetsBuilderImpl";
import {
  CsvDataset,
  GetViewportDatasetsResult,
  HandlePlayerStateResult,
  IDatasetsBuilder,
  SeriesItem,
  Viewport,
} from "./IDatasetsBuilder";
import { buildCurrentSeriesActions, buildFullSeriesActions } from "./utils";
import { resolveChartDatum } from "../utils/datum";

type CustomDatasetsSeriesItem = {
  config: Immutable<SeriesItem>;
};

// If the datasets builder is garbage collected we also need to cleanup the worker
// This registry ensures the worker is cleaned up when the builder is garbage collected
const registry = new FinalizationRegistry<() => void>((dispose) => {
  dispose();
});

export class CustomDatasetsBuilder implements IDatasetsBuilder {
  readonly #datasetsBuilderRemote: Comlink.Remote<Comlink.RemoteObject<CustomDatasetsBuilderImpl>>;
  #xParsedPath?: Immutable<MessagePath>;

  #pendingDispatch: Immutable<UpdateDataAction>[] = [];

  #lastSeekTime = 0;

  #series: Immutable<CustomDatasetsSeriesItem[]> = [];

  #xCurrentBounds?: Bounds1D;
  #xFullBounds?: Bounds1D;

  #hasRangeSource: boolean = false;

  public getXTopic(): string | undefined {
    return this.#xParsedPath?.topicName;
  }

  public constructor() {
    const worker = new Worker(new URL("./CustomDatasetsBuilderImpl.worker", import.meta.url));
    const { remote, dispose } =
      ComlinkWrap<Comlink.RemoteObject<CustomDatasetsBuilderImpl>>(worker);

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

    let datasetsChanged = false;

    const msgEvents = activeData.messages;
    if (!this.#hasRangeSource && msgEvents.length > 0) {
      // Read the x-axis values.
      // No reset on seek: without a range source, accumulated x-axis data is irrecoverable
      // (same reasoning as y-axis series in buildCurrentSeriesActions).
      if (this.#xParsedPath) {
        const pathItems = parseXPathItems(msgEvents, this.#xParsedPath);

        this.#pendingDispatch.push({
          type: "append-current-x",
          items: pathItems,
        });

        if (pathItems.length > 0) {
          datasetsChanged = true;
          this.#xCurrentBounds = computeBounds(this.#xCurrentBounds, pathItems);
        }
      }

      const { actions: seriesActions, datasetsChanged: seriesChanged } = buildCurrentSeriesActions(
        this.#series,
        { didSeek, hasRangeSource: this.#hasRangeSource },
        (config) => readSeriesItems(msgEvents, config),
      );
      pushAll(this.#pendingDispatch, seriesActions as UpdateDataAction[]);
      datasetsChanged ||= seriesChanged;
    }

    // Series with their own x path have x values outside the panel's x path bounds, so let the
    // chart fit the x-axis to all datasets.
    if (this.#series.some((series) => series.config.xParsed != undefined)) {
      return { range: undefined, datasetsChanged };
    }

    if (!this.#xCurrentBounds) {
      return {
        range: this.#xFullBounds ?? { min: 0, max: 1 },
        datasetsChanged,
      };
    }

    if (!this.#xFullBounds) {
      return {
        range: this.#xCurrentBounds,
        datasetsChanged,
      };
    }

    return {
      range: unionBounds1D(this.#xCurrentBounds, this.#xFullBounds),
      datasetsChanged,
    };
  }

  public handleMessageRange(
    messages: Immutable<MessageEvent[]>,
    options: { isReset: boolean },
  ): void {
    this.#hasRangeSource = true;
    const topic = messages[0]?.topic;
    if (!topic) {
      return;
    }

    const isXBatch = topic === this.#xParsedPath?.topicName;

    if (isXBatch) {
      if (options.isReset) {
        this.#pendingDispatch.push({ type: "reset-full-x" });
        this.#xFullBounds = undefined;
      }
      if (this.#xParsedPath) {
        const pathItems = parseXPathItems(messages, this.#xParsedPath);
        if (pathItems.length > 0) {
          this.#xFullBounds = computeBounds(this.#xFullBounds, pathItems);
          this.#pendingDispatch.push({ type: "append-full-x", items: pathItems });
        }
      }
      // Series on the x-axis topic read the same batch below.
    }

    const actions = buildFullSeriesActions(this.#series, topic, options, (config) =>
      readSeriesItems(messages, config),
    );
    pushAll(this.#pendingDispatch, actions as UpdateDataAction[]);
  }

  public setXPath(path: Immutable<MessagePath> | undefined): void {
    if (_.isEqual(path, this.#xParsedPath)) {
      return;
    }

    this.#xParsedPath = path;
    this.#xFullBounds = undefined;
    this.#xCurrentBounds = undefined;

    this.#pendingDispatch.push({
      type: "reset-current-x",
    });

    this.#pendingDispatch.push({
      type: "reset-full-x",
    });
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
    await this.#flushPendingDispatch();

    return await this.#datasetsBuilderRemote.getViewportDatasets(viewport);
  }

  public async getCsvData(xRange?: Immutable<Bounds1D>): Promise<CsvDataset[]> {
    await this.#flushPendingDispatch();
    return await this.#datasetsBuilderRemote.getCsvData(xRange);
  }

  /** Send queued updates to the worker so reads see the latest series and data */
  async #flushPendingDispatch(): Promise<void> {
    const dispatch = this.#pendingDispatch;
    if (dispatch.length > 0) {
      this.#pendingDispatch = [];
      await this.#datasetsBuilderRemote.updateData(dispatch);
    }
  }
}

/** Y values of a series; a series with its own x path also gets its x values (see readXYItems). */
function readSeriesItems(
  events: Immutable<MessageEvent[]>,
  config: Immutable<SeriesItem>,
): ValueItem[] {
  return config.xParsed
    ? readXYItems(events, config.parsed, config.xParsed)
    : readMessagePathItems(events, config.parsed);
}

/**
 * Pairs x and y values read from the same message, by their index in that message. The x path must
 * be on the same topic as the y path; values from other topics have no message to pair with.
 */
export function readXYItems(
  events: Immutable<MessageEvent[]>,
  yPath: Immutable<MessagePath>,
  xPath: Immutable<MessagePath>,
): ValueItem[] {
  const out: ValueItem[] = [];
  if (xPath.topicName !== yPath.topicName) {
    return out;
  }
  for (const event of events) {
    if (event.topic !== yPath.topicName) {
      continue;
    }
    const yItems = simpleGetMessagePathDataItems(event, yPath);
    const xItems = simpleGetMessagePathDataItems(event, xPath);
    for (let i = 0; i < yItems.length && i < xItems.length; ++i) {
      const yDatum = resolveChartDatum(yItems[i]);
      const xDatum = resolveChartDatum(xItems[i]);
      if (!yDatum || !xDatum) {
        continue;
      }
      out.push({
        x: xDatum.y,
        value: yDatum.y,
        originalValue: yDatum.value,
        receiveTime: event.receiveTime,
      });
    }
  }
  return out;
}

function parseXPathItems(
  messages: Immutable<MessageEvent[]>,
  xParsedPath: Immutable<MessagePath>,
): ValueItem[] {
  return readMessagePathItems(messages, xParsedPath);
}

function readMessagePathItems(
  events: Immutable<MessageEvent[]>,
  path: Immutable<MessagePath>,
): ValueItem[] {
  const out = [];
  for (const event of events) {
    if (event.topic !== path.topicName) {
      continue;
    }

    const items = simpleGetMessagePathDataItems(event, path);
    for (const item of items) {
      const datum = resolveChartDatum(item);
      if (!datum) {
        continue;
      }

      out.push({
        value: datum.y,
        originalValue: datum.value,
        receiveTime: event.receiveTime,
      });
    }
  }

  return out;
}

function accumulateBounds(acc: Bounds1D, item: Immutable<ValueItem>) {
  extendBounds1D(acc, item.value);
  return acc;
}

function computeBounds(
  currentBounds: Immutable<Bounds1D> | undefined,
  items: Immutable<ValueItem[]>,
): Bounds1D {
  const itemBounds = items.reduce(accumulateBounds, {
    min: Number.MAX_VALUE,
    max: -Number.MAX_VALUE,
  });

  return unionBounds1D(
    currentBounds ?? { min: Number.MAX_VALUE, max: -Number.MAX_VALUE },
    itemBounds,
  );
}
