// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Zoom as ZoomPlugin } from "@foxglove/chartjs-plugin-zoom";
import { Chart, Scale as ChartScale, Ticks } from "chart.js";
import { AnnotationOptions } from "chartjs-plugin-annotation";
import EventEmitter from "eventemitter3";

import { unwrap } from "@lichtblick/den/monads";
import { Immutable } from "@lichtblick/suite";
import {
  addEventListener,
  removeEventListener,
} from "@lichtblick/suite-base/components/Chart/worker/eventHandler";
import { DEFAULT_ANNOTATION } from "@lichtblick/suite-base/panels/Plot/constants";
import { getChartOptions } from "@lichtblick/suite-base/panels/Plot/utils/getChartOptions";
import { buildThresholdFills } from "@lichtblick/suite-base/panels/Plot/utils/thresholdFill";
import { Bounds, Bounds1D } from "@lichtblick/suite-base/types/Bounds";
import { maybeCast } from "@lichtblick/suite-base/util/maybeCast";
import { isLight, parseColor } from "@lichtblick/suite-base/util/parseColor";
// Not the package index: it pulls MUI component styles and icons, which crash in a worker
import { fontMonospace } from "@lichtblick/theme/src/typography";

import {
  ChartRendererProps,
  ChartType,
  ImageLegendEntry,
  Dataset,
  Datum,
  HoverElement,
  InteractionEvent,
  MutableContext,
  PixelRect,
  ReferenceLine,
  Scale,
  UpdateAction,
  WheelInteractionEvent,
  YScale,
  ZoomableChart,
  ZoomMode,
} from "./types";

/** A sample further than this from the cursor is reported with its age in the tooltip. */
const STALE_SAMPLE_PX = 4;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock time, HH:MM:SS.mmm */
export function formatClockTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${ms}`;
}

type XPadding = { span: number; left: number; right: number };

/**
 * The x tick labels at the window edges (e.g. "25.0", then "25.03") change width as a live window
 * slides, and chart.js sizes the plot area to fit them, so the whole chart wobbled sideways. Keep
 * the widest padding seen for the current span; a zoom (new span) sizes it afresh.
 */
export function holdXPadding(
  held: XPadding,
  scale: Pick<ChartScale, "min" | "max" | "paddingLeft" | "paddingRight">,
): void {
  const span = scale.max - scale.min;
  // the follow window's span differs by float rounding from frame to frame
  if (!(Math.abs(span - held.span) <= Math.abs(held.span) * 1e-9)) {
    held.span = span;
    held.left = 0;
    held.right = 0;
  }
  held.left = Math.max(held.left, scale.paddingLeft);
  held.right = Math.max(held.right, scale.paddingRight);
  scale.paddingLeft = held.left;
  scale.paddingRight = held.right;
}

export class ChartRenderer {
  #chartInstance: ChartType;
  #fakeNodeEvents = new EventEmitter();
  #fakeDocumentEvents = new EventEmitter();
  readonly #titleColor: string;
  #absoluteStartSec?: number;
  #xPadding: XPadding = { span: Number.NaN, left: 0, right: 0 };
  #equalAxes = false;
  /** Series datasets by config index; the chart's datasets also hold threshold fills after them */
  #seriesDatasets: Dataset[] = [];
  #referenceLines: Immutable<ReferenceLine[]> = [];
  /** Threshold fill datasets at the end of the chart's datasets */
  #fillCount = 0;

  public constructor(args: ChartRendererProps) {
    const fakeNode = {
      addEventListener: addEventListener(this.#fakeNodeEvents),
      removeEventListener: removeEventListener(this.#fakeNodeEvents),
      ownerDocument: {
        addEventListener: addEventListener(this.#fakeDocumentEvents),
        removeEventListener: removeEventListener(this.#fakeDocumentEvents),
      },
    };

    this.#titleColor = args.titleColor;

    const chartOptions = getChartOptions({
      devicePixelRatio: args.devicePixelRatio,
      gridColor: args.gridColor,
      tickColor: args.tickColor,
      titleColor: args.titleColor,
    });

    const xTicks = chartOptions.scales?.x?.ticks;
    if (xTicks) {
      const getStartSec = () => this.#absoluteStartSec;
      xTicks.callback = function (this: ChartScale, value, index, ticks) {
        const startSec = getStartSec();
        return startSec == undefined || typeof value !== "number"
          ? Ticks.formatters.numeric.call(this, value as number, index, ticks)
          : formatClockTime(startSec + value);
      };
    }

    const xScaleOptions = chartOptions.scales?.x;
    if (xScaleOptions) {
      xScaleOptions.afterFit = (scale) => {
        holdXPadding(this.#xPadding, scale);
      };
    }

    const origZoomStart = ZoomPlugin.start?.bind(ZoomPlugin);
    ZoomPlugin.start = (chartInstance: MutableContext<unknown>, startArgs, pluginOptions) => {
      // swap the canvas with our fake dom node canvas to support zoom plugin addEventListener
      const ctx = chartInstance.ctx;
      chartInstance.ctx = {
        canvas: fakeNode,
      };
      const res = origZoomStart?.(chartInstance as Chart, startArgs, pluginOptions);
      chartInstance.ctx = ctx;
      return res;
    };

    // ChartJS supports offscreen canvas however the type definitions do not so we need to cast and
    // fool the constructor.
    //
    // https://www.chartjs.org/docs/latest/general/performance.html#parallel-rendering-with-web-workers-chromium-only
    const canvas = args.canvas as unknown as HTMLCanvasElement;
    const chartInstance = new Chart<"scatter", Datum[]>(canvas, {
      type: "scatter",
      data: {
        datasets: [],
      },
      options: chartOptions,
      plugins: [ZoomPlugin],
    });

    ZoomPlugin.start = origZoomStart;
    this.#chartInstance = chartInstance;
  }

  public update(action: Immutable<UpdateAction>): Bounds | undefined {
    if (action.size) {
      this.#chartInstance.canvas.width = action.size.width;
      this.#chartInstance.canvas.height = action.size.height;
      this.#chartInstance.resize();
    }

    this.#applyBounds("y", action.yBounds);
    this.#applyBounds("y2", action.y2Bounds);
    this.#applyBounds("x", action.xBounds);

    if (action.y2Axis) {
      const y2 = this.#chartInstance.options.scales?.y2;
      if (y2) {
        const { display, showLabels, label, showGrid } = action.y2Axis;
        y2.display = display;
        if (y2.ticks) {
          y2.ticks.display = showLabels;
        }
        if (y2.grid) {
          y2.grid.display = showGrid;
        }
        y2.title = { display: label.length > 0, text: label, color: this.#titleColor };
      }
    }

    for (const [scaleId, log] of [
      ["y", action.yLogScale],
      ["y2", action.y2LogScale],
    ] as const) {
      if (log == undefined) {
        continue;
      }
      const scaleOption = this.#chartInstance.options.scales?.[scaleId];
      if (scaleOption) {
        scaleOption.type = log ? "logarithmic" : "linear";
      }
    }

    if (action.showXAxisGrid != undefined) {
      const grid = this.#chartInstance.options.scales?.x?.grid;
      if (grid) {
        grid.display = action.showXAxisGrid;
      }
    }

    if (action.showYAxisGrid != undefined) {
      const grid = this.#chartInstance.options.scales?.y?.grid;
      if (grid) {
        grid.display = action.showYAxisGrid;
      }
    }

    if (action.xTickFormat) {
      this.#absoluteStartSec = action.xTickFormat.absoluteStartSec;
      // labels change length with the format: size the padding afresh
      this.#xPadding.span = Number.NaN;
    }

    if (action.equalAxes != undefined) {
      this.#equalAxes = action.equalAxes;
    }

    if (action.showYAxisLabels != undefined) {
      const ticksOptions = this.#chartInstance.options.scales?.y?.ticks;
      if (ticksOptions) {
        ticksOptions.display = action.showYAxisLabels;
      }
    }

    if (action.showXAxisLabels != undefined) {
      const ticksOptions = this.#chartInstance.options.scales?.x?.ticks;
      if (ticksOptions) {
        ticksOptions.display = action.showXAxisLabels;
      }
    }

    if (action.yAxisLabel != undefined) {
      const yScale = this.#chartInstance.options.scales?.y;
      if (yScale) {
        yScale.title = {
          display: action.yAxisLabel.length > 0,
          text: action.yAxisLabel,
          color: this.#titleColor,
        };
      }
    }

    if (action.xAxisLabel != undefined) {
      const xScale = this.#chartInstance.options.scales?.x;
      if (xScale) {
        xScale.title = {
          display: action.xAxisLabel.length > 0,
          text: action.xAxisLabel,
          color: this.#titleColor,
        };
      }
    }

    if (action.interactionEvents) {
      for (const event of action.interactionEvents) {
        this.#applyInteractionEvent(event);
      }
    }

    if (action.zoomMode) {
      unwrap(this.#chartInstance.options.plugins?.zoom?.zoom).mode = action.zoomMode;
    }

    if (action.referenceLines) {
      const annotation = this.#chartInstance.options.plugins?.annotation;
      if (!annotation) {
        return;
      }

      const newAnnotations: AnnotationOptions[] = action.referenceLines.map((config) => {
        const vertical = config.scaleID === "x";
        return {
          ...DEFAULT_ANNOTATION,
          scaleID: config.scaleID ?? "y",
          borderColor: config.color,
          ...(config.width != undefined && { borderWidth: config.width }),
          ...(config.dashed === false && { borderDash: [] }),
          value: config.value,
          label: config.label
            ? {
                display: true,
                content: config.label,
                position: vertical ? "start" : "end",
                backgroundColor: config.color,
                color: isLight(parseColor(config.color)) ? "#000" : "#fff",
                font: { family: fontMonospace, size: 10 },
                padding: 3,
              }
            : undefined,
        };
      });

      annotation.annotations = newAnnotations;
      // Fills only change with shaded lines; config updates arrive often
      const hadShade = this.#referenceLines.some((line) => line.shade != undefined);
      this.#referenceLines = action.referenceLines;
      if (hadShade || action.referenceLines.some((line) => line.shade != undefined)) {
        this.#setDatasets();
      }
    }

    this.#render();
    return this.#getBounds();
  }

  /**
   * Zoom to a canvas-pixel rectangle (box zoom). Every scale in `mode` gets the rectangle's range,
   * so a secondary y-axis zooms along with the primary one.
   */
  public zoomToRect(rect: PixelRect, mode: ZoomMode): Bounds | undefined {
    for (const scale of Object.values(this.#chartInstance.scales)) {
      const horizontal = scale.isHorizontal();
      if ((horizontal && mode === "y") || (!horizontal && mode === "x")) {
        continue;
      }
      const options = this.#chartInstance.options.scales?.[scale.id];
      if (!options) {
        continue;
      }
      const a = scale.getValueForPixel(horizontal ? rect.left : rect.bottom);
      const b = scale.getValueForPixel(horizontal ? rect.right : rect.top);
      if (a == undefined || b == undefined || a === b) {
        continue;
      }
      options.min = Math.min(a, b);
      options.max = Math.max(a, b);
    }
    this.#render();
    return this.#getBounds();
  }

  #applyBounds(scaleId: "x" | "y" | "y2", bounds: Immutable<Partial<Bounds1D>> | undefined): void {
    if (!bounds) {
      return;
    }
    const scaleOption = this.#chartInstance.options.scales?.[scaleId];
    if (!scaleOption) {
      return;
    }
    if (scaleOption.min !== bounds.min) {
      scaleOption.min = bounds.min;
    }
    if (scaleOption.max !== bounds.max) {
      scaleOption.max = bounds.max;
    }
  }

  /**
   * Update the chart. With equal axes, a second pass widens the axis with fewer units per pixel so
   * both axes share one scale. The fitted bounds are not kept in the options, so the next update
   * still fits the data.
   */
  #render(): void {
    // NOTE: "none" disables animations - this is important for chart performance because we update
    // the entire data set which does not preserve history for the chart animations
    this.#chartInstance.update("none");
    // 1:1 scaling is linear, so a log y axis keeps its own fit
    if (!this.#equalAxes || this.#chartInstance.scales.y?.type === "logarithmic") {
      return;
    }

    const { x, y } = this.#chartInstance.scales;
    const xOptions = this.#chartInstance.options.scales?.x;
    const yOptions = this.#chartInstance.options.scales?.y;
    if (!x || !y || !xOptions || !yOptions || x.width <= 0 || y.height <= 0) {
      return;
    }
    const xPerPx = (x.max - x.min) / x.width;
    const yPerPx = (y.max - y.min) / y.height;
    const perPx = Math.max(xPerPx, yPerPx);
    if (!(perPx > 0) || !Number.isFinite(perPx) || Math.abs(xPerPx - yPerPx) <= perPx * 1e-6) {
      return;
    }

    const saved = {
      xMin: xOptions.min,
      xMax: xOptions.max,
      yMin: yOptions.min,
      yMax: yOptions.max,
    };
    const xCenter = (x.min + x.max) / 2;
    const yCenter = (y.min + y.max) / 2;
    xOptions.min = xCenter - (perPx * x.width) / 2;
    xOptions.max = xCenter + (perPx * x.width) / 2;
    yOptions.min = yCenter - (perPx * y.height) / 2;
    yOptions.max = yCenter + (perPx * y.height) / 2;
    this.#chartInstance.update("none");

    // chart.js rebuilds the scale option objects on update, so restore through fresh references.
    const scales = this.#chartInstance.options.scales;
    if (scales?.x && scales.y) {
      scales.x.min = saved.xMin;
      scales.x.max = saved.xMax;
      scales.y.min = saved.yMin;
      scales.y.max = saved.yMax;
    }
  }

  #getBounds(): Bounds | undefined {
    // fill our rpc scales - we only support x and y scales for now
    const xScale = this.#chartInstance.scales.x;
    const yScale = this.#chartInstance.scales.y;

    if (!xScale || !yScale) {
      return undefined;
    }

    return {
      x: {
        min: xScale.min,
        max: xScale.max,
      },
      y: {
        min: yScale.min,
        max: yScale.max,
      },
    };
  }

  /**
   * For each dataset, the last sample at or before the hovered x. Samples away from the cursor get
   * `ageSec` so the tooltip can show sparse series ("0.4s ago") instead of dropping them.
   */
  public getLatestElementsAtPixel(pixel: { x: number; y: number }): HoverElement[] {
    const xScale = this.#chartInstance.scales.x;
    const xValue = xScale?.getValueForPixel(pixel.x);
    if (!xScale || xValue == undefined) {
      return [];
    }

    const out: HoverElement[] = [];
    const datasets = this.#chartInstance.data.datasets;
    // Runs on every mouse move: index up to the series instead of slicing off the threshold fills
    const seriesCount = datasets.length - this.#fillCount;
    for (let configIndex = 0; configIndex < seriesCount; ++configIndex) {
      const data = datasets[configIndex]?.data ?? [];
      // ponytail: linear scan of the (already downsampled) visible data; binary search if it shows
      // up in profiles. NaN entries are line breaks, so they are skipped.
      for (let i = data.length - 1; i >= 0; --i) {
        const datum = data[i];
        if (datum == undefined || !(datum.x <= xValue) || Number.isNaN(datum.y)) {
          continue;
        }
        const stale = pixel.x - xScale.getPixelForValue(datum.x) > STALE_SAMPLE_PX;
        out.push({ data: datum, configIndex, ageSec: stale ? xValue - datum.x : undefined });
        break;
      }
    }
    return out;
  }

  public getElementsAtPixel(pixel: { x: number; y: number }): HoverElement[] {
    const x = pixel.x;
    const y = pixel.y;

    const ev = {
      native: true,
      x,
      y,
    };

    // ev is cast to any because the typings for getElementsAtEventForMode are wrong
    // ev is specified as a dom Event - but the implementation does not require it for the basic platform
    const elements = this.#chartInstance.getElementsAtEventForMode(
      ev as unknown as Event,
      this.#chartInstance.options.interaction?.mode ?? "intersect",
      this.#chartInstance.options.interaction ?? {},
      false,
    );

    const out: HoverElement[] = [];

    // sort elements by proximity to the cursor so the closer items are earlier in the list
    elements.sort((a, b) => {
      const dxA = pixel.x - a.element.x;
      const dyA = pixel.y - a.element.y;
      const dxB = pixel.x - b.element.x;
      const dyB = pixel.y - b.element.y;
      const distSquaredA = dxA * dxA + dyA * dyA;
      const distSquaredB = dxB * dxB + dyB * dyB;
      return distSquaredA - distSquaredB;
    });

    for (const element of elements) {
      if (element.datasetIndex >= this.#chartInstance.data.datasets.length - this.#fillCount) {
        continue; // threshold fill
      }
      const data = this.#chartInstance.data.datasets[element.datasetIndex]?.data[element.index];
      if (data == undefined || typeof data === "number") {
        continue;
      }

      out.push({
        data,
        configIndex: element.datasetIndex,
      });
    }

    return out;
  }

  public updateDatasets(datasets: Dataset[]): { x?: Scale; y?: YScale } {
    this.#seriesDatasets = datasets;
    this.#setDatasets();

    // While the chartjs API doesn't indicate update should be called after resize, in practice
    // we've found that performing a resize after an update sometimes results in a blank chart.
    this.#render();
    return { x: this.#getXScale(), y: this.#getYScale() };
  }

  #setDatasets(): void {
    const fills = buildThresholdFills(this.#seriesDatasets, this.#referenceLines);
    this.#fillCount = fills.length;
    this.#chartInstance.data.datasets =
      fills.length > 0 ? [...this.#seriesDatasets, ...fills] : this.#seriesDatasets;
  }

  #getXScale(): Scale | undefined {
    const xScale = this.#chartInstance.scales.x;
    if (!xScale) {
      return undefined;
    }

    return {
      min: xScale.min,
      max: xScale.max,
      left: xScale.left,
      right: xScale.right,
    };
  }

  #getYScale(): YScale | undefined {
    const yScale = this.#chartInstance.scales.y;
    if (!yScale) {
      return undefined;
    }

    return {
      min: yScale.min,
      max: yScale.max,
      log: yScale.type === "logarithmic",
      top: yScale.top,
      bottom: yScale.bottom,
    };
  }

  #applyInteractionEvent(event: Immutable<InteractionEvent>): void {
    const { type, boundingClientRect, ...rest } = event;
    switch (type) {
      case "wheel":
        this.#withWheelZoomMode(event, () => {
          this.#fakeNodeEvents.emit("wheel", {
            ...rest,
            target: {
              getBoundingClientRect() {
                return boundingClientRect;
              },
            },
          });
        });
        break;
      case "panstart":
        maybeCast<ZoomableChart>(this.#chartInstance)?.$zoom.panStartHandler({
          center: event.center,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          target: {
            getBoundingClientRect() {
              return boundingClientRect;
            },
          },
        });
        break;
      case "panmove":
        maybeCast<ZoomableChart>(this.#chartInstance)?.$zoom.panHandler(event);
        break;
      case "panend":
        maybeCast<ZoomableChart>(this.#chartInstance)?.$zoom.panEndHandler();
        break;
    }
  }

  /**
   * Run a wheel zoom with the event's zoom mode. Over an axis (outside the chart area) only that
   * axis zooms.
   */
  #withWheelZoomMode(event: Immutable<WheelInteractionEvent>, zoom: () => void): void {
    // eslint-disable-next-line no-underscore-dangle -- the zoom plugin's resolved options
    const zoomOptions = maybeCast<ZoomableChart>(this.#chartInstance)?.$zoom._options?.zoom;
    if (!zoomOptions) {
      zoom();
      return;
    }

    const x = event.clientX - event.boundingClientRect.left;
    const y = event.clientY - event.boundingClientRect.top;
    const { chartArea } = this.#chartInstance;
    const insideChartArea =
      x >= chartArea.left && x <= chartArea.right && y >= chartArea.top && y <= chartArea.bottom;
    const axisUnderCursor = insideChartArea
      ? undefined
      : Object.values(this.#chartInstance.scales).find(
          (scale) => x >= scale.left && x <= scale.right && y >= scale.top && y <= scale.bottom,
        )?.axis;

    const { mode, overScaleMode } = zoomOptions;
    if (axisUnderCursor === "x" || axisUnderCursor === "y") {
      zoomOptions.mode = axisUnderCursor;
      zoomOptions.overScaleMode = axisUnderCursor;
    } else if (event.zoomMode) {
      zoomOptions.mode = event.zoomMode;
    }
    try {
      zoom();
    } finally {
      zoomOptions.mode = mode;
      zoomOptions.overScaleMode = overScaleMode;
    }
  }

  /**
   * The chart as a PNG on an opaque background, with a legend of `legend` drawn in the top-left
   * corner of the chart area.
   */
  public async getImageBlob(backgroundColor: string, legend: ImageLegendEntry[]): Promise<Blob> {
    const chart = this.#chartInstance;
    const source = chart.canvas as unknown as OffscreenCanvas;
    const image = new OffscreenCanvas(source.width, source.height);
    const ctx = unwrap(image.getContext("2d"));
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, image.width, image.height);
    ctx.drawImage(source, 0, 0);

    if (legend.length > 0) {
      const dpr = chart.currentDevicePixelRatio;
      ctx.scale(dpr, dpr);
      const fontSize = 12;
      const rowHeight = fontSize + 4;
      const pad = 6;
      const swatch = 12;
      ctx.font = `${fontSize}px ${fontMonospace}`;
      ctx.textBaseline = "middle";
      const textWidth = Math.max(...legend.map((entry) => ctx.measureText(entry.label).width));
      const left = chart.chartArea.left + pad;
      const top = chart.chartArea.top + pad;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(left, top, pad * 3 + swatch + textWidth, pad * 2 + rowHeight * legend.length);
      ctx.globalAlpha = 1;
      legend.forEach((entry, i) => {
        const y = top + pad + rowHeight * i + rowHeight / 2;
        ctx.fillStyle = entry.color;
        ctx.fillRect(left + pad, y - 1.5, swatch, 3);
        ctx.fillStyle = this.#titleColor;
        ctx.fillText(entry.label, left + pad * 2 + swatch, y);
      });
    }

    return await image.convertToBlob({ type: "image/png" });
  }

  /**
   * Exposed as protected for unit testing strictly private fields.
   * Developers are encouraged to avoid using these methods in production logic.
   */
  protected getChartInstance(): ChartType {
    return this.#chartInstance;
  }

  /**
   * Exposed as protected for unit testing strictly private fields.
   * Developers are encouraged to avoid using these methods in production logic.
   */
  protected getFakeNodeEvents(): EventEmitter {
    return this.#fakeNodeEvents;
  }
}
