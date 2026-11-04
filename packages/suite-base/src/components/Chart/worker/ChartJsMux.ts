// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import {
  CategoryScale,
  Chart,
  ChartData,
  ChartOptions,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Ticks,
  TimeScale,
  TimeSeriesScale,
  Title,
  Tooltip,
} from "chart.js";
import AnnotationPlugin from "chartjs-plugin-annotation";

import { loadDefaultFont } from "@lichtblick/suite-base/panels/shared/loadFont";

import ChartJSManager, { InitOpts, PanInput } from "./ChartJSManager";
import { RpcElement, RpcScales, TypedChartData } from "../types";

type RpcEvent<EventType> = { id: string; event: EventType };

export type ChartUpdateMessage = {
  data?: ChartData<"scatter">;
  typedData?: TypedChartData;
  height?: number;
  options?: ChartOptions;
  isBoundsReset: boolean;
  width?: number;
};

type RpcUpdateEvent = {
  id: string;
} & ChartUpdateMessage;

// Immediately start font loading in the Worker thread. Each ChartJSManager we instantiate will
// wait on this promise before instantiating a new Chart instance, which kicks off rendering
const fontLoaded = loadDefaultFont();

// Register the features we support globally on our chartjs instance
// Note: Annotation plugin must be registered, it does not work _inline_ (i.e. per instance)
Chart.register(
  LineElement,
  PointElement,
  LineController,
  ScatterController,
  CategoryScale,
  LinearScale,
  TimeScale,
  TimeSeriesScale,
  Filler,
  Legend,
  Title,
  Tooltip,
  AnnotationPlugin,
);

const fixedNumberFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/**
 * Adjust the `ticks` of the chart options to ensure the first/last x labels remain a constant
 * width. See https://github.com/foxglove/studio/issues/2926
 *
 * Because this requires passing a `callback` function for the tick options, this has to be done in
 * the worker, since functions can't be sent via postMessage.
 */
function fixTicks(args: RpcUpdateEvent): RpcUpdateEvent {
  const xScale = args.options?.scales?.x;

  if (xScale?.ticks) {
    xScale.ticks.callback = function (value, index, ticks) {
      // use a fixed formatter for the first/last ticks
      if (index === 0 || index === ticks.length - 1) {
        return fixedNumberFormat.format(value as number);
      }
      // otherwise use chart.js's default formatter
      return Ticks.formatters.numeric.apply(this, [value as number, index, ticks]);
    };
  }
  return args;
}

// Since we use a capped number of web-workers, a single web-worker may be running multiple chartjs instances
// The ChartJsMux forwards a request for a specific chartjs instance id to the appropriate instance
export default class ChartJsMux {
  readonly #managers = new Map<string, ChartJSManager>();

  // create a new chartjs instance
  // this must be done before sending any other requests to the instance
  public initialize(args: InitOpts): RpcScales {
    args.fontLoaded = fontLoaded;
    const manager = new ChartJSManager(args);
    this.#managers.set(args.id, manager);
    return manager.getScales();
  }

  public wheel(args: RpcEvent<WheelEvent>): RpcScales {
    return this.#getChart(args.id).wheel(args.event);
  }

  public mousedown(args: RpcEvent<MouseEvent>): RpcScales {
    return this.#getChart(args.id).mousedown(args.event);
  }

  public mousemove(args: RpcEvent<MouseEvent>): RpcScales {
    return this.#getChart(args.id).mousemove(args.event);
  }

  public mouseup(args: RpcEvent<MouseEvent>): RpcScales {
    return this.#getChart(args.id).mouseup(args.event);
  }

  public panstart(args: RpcEvent<PanInput>): RpcScales {
    return this.#getChart(args.id).panstart(args.event);
  }

  public panend(args: RpcEvent<PanInput>): RpcScales {
    return this.#getChart(args.id).panend(args.event);
  }

  public panmove(args: RpcEvent<PanInput>): RpcScales {
    return this.#getChart(args.id).panmove(args.event);
  }

  public update(args: RpcUpdateEvent): RpcScales {
    return this.#getChart(args.id).update(fixTicks(args));
  }

  public destroy(args: RpcEvent<void>): void {
    const manager = this.#managers.get(args.id);
    if (manager) {
      manager.destroy();
      this.#managers.delete(args.id);
    }
  }

  public getElementsAtEvent(
    args: RpcEvent<MouseEvent>,
  ): RpcElement[] {
    return this.#getChart(args.id).getElementsAtEvent(args);
  }

  public getDatalabelAtEvent(
    args: RpcEvent<Event>,
  ): unknown {
    return this.#getChart(args.id).getDatalabelAtEvent(args);
  }

  #getChart(id: string): ChartJSManager {
    const chart = this.#managers.get(id);
    if (!chart) {
      throw new Error(`Could not find chart with id ${id}`);
    }
    return chart;
  }
}
