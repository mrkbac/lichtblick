// SPDX-License-Identifier: MPL-2.0

import type { Chart, ChartType } from "chart.js";

type AxisMode = "x" | "y" | "xy";
type AxisOptions = { enabled?: boolean; mode?: AxisMode };

type ViewportOptions = { zoom?: AxisOptions; pan?: AxisOptions };

/** Share of the span one wheel step zooms by. */
const ZOOM_SPEED = 0.1;

declare module "chart.js" {
  interface PluginOptionsByType<TType extends ChartType> {
    zoom?: ViewportOptions;
  }
}

type ViewportChart = Pick<Chart, "chartArea" | "scales"> & {
  options: { plugins?: { zoom?: ViewportOptions } };
  update(mode: "none"): void;
};

export type PanInput = { deltaX: number; deltaY: number };

export type WheelInput = {
  deltaY: number;
  clientX: number;
  clientY: number;
  boundingClientRect: Pick<DOMRect, "left" | "top">;
  zoomMode?: AxisMode;
};

function contains(
  rect: { left: number; right: number; top: number; bottom: number },
  { x, y }: { x: number; y: number },
): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Apply serialized gestures directly to Chart.js scales on an OffscreenCanvas. */
export class ChartViewport {
  #pan?: PanInput;

  readonly #chart: ViewportChart;
  readonly #axisUnderCursor: boolean;

  public constructor(chart: ViewportChart, options?: { axisUnderCursor: boolean }) {
    this.#chart = chart;
    this.#axisUnderCursor = options?.axisUnderCursor ?? false;
  }

  public wheel(event: WheelInput): void {
    const zoom = this.#chart.options.plugins?.zoom?.zoom;
    if (zoom?.enabled !== true || !Number.isFinite(event.deltaY) || event.deltaY === 0) {
      return;
    }

    const point = {
      x: event.clientX - event.boundingClientRect.left,
      y: event.clientY - event.boundingClientRect.top,
    };
    const scales = Object.values(this.#chart.scales);
    const hoveredScale =
      this.#axisUnderCursor && !contains(this.#chart.chartArea, point)
        ? scales.find((scale) => contains(scale, point))
        : undefined;
    const mode = event.zoomMode ?? zoom.mode ?? "xy";
    const span = 1 + Math.sign(event.deltaY) * ZOOM_SPEED;
    this.#transform(hoveredScale?.id, (axis, pixel) => {
      const anchor = point[axis];
      return hoveredScale || mode.includes(axis) ? anchor + (pixel - anchor) * span : pixel;
    });
  }

  /** Pan by a scroll gesture (two-finger swipe, mouse wheel); scrolling down moves the view down. */
  public scroll(event: PanInput): void {
    const pan = this.#chart.options.plugins?.zoom?.pan;
    if (pan?.enabled !== true) {
      return;
    }
    const mode = pan.mode ?? "xy";
    const delta = { x: event.deltaX, y: event.deltaY };
    this.#transform(undefined, (axis, pixel) =>
      mode.includes(axis) && Number.isFinite(delta[axis]) ? pixel + delta[axis] : pixel,
    );
  }

  public panstart(event: PanInput): void {
    this.#pan = { deltaX: 0, deltaY: 0 };
    this.panmove(event);
  }

  public panmove(event: PanInput): void {
    const previous = this.#pan;
    const pan = this.#chart.options.plugins?.zoom?.pan;
    if (!previous || pan?.enabled !== true) {
      return;
    }
    this.#pan = event;
    const x = event.deltaX - previous.deltaX;
    const y = event.deltaY - previous.deltaY;
    const mode = pan.mode ?? "xy";
    const delta = { x, y };
    this.#transform(undefined, (axis, pixel) =>
      mode.includes(axis) ? pixel - delta[axis] : pixel,
    );
  }

  public panend(): void {
    this.#pan = undefined;
  }

  #transform(
    selectedScaleId: string | undefined,
    transform: (axis: "x" | "y", pixel: number) => number,
  ): void {
    let changed = false;
    for (const scale of Object.values(this.#chart.scales)) {
      const { axis } = scale;
      if (
        (axis !== "x" && axis !== "y") ||
        (selectedScaleId != undefined && selectedScaleId !== scale.id)
      ) {
        continue;
      }

      const minPixel = scale.getPixelForValue(scale.min);
      const maxPixel = scale.getPixelForValue(scale.max);
      const nextMinPixel = transform(axis, minPixel);
      const nextMaxPixel = transform(axis, maxPixel);
      if (nextMinPixel === minPixel && nextMaxPixel === maxPixel) {
        continue;
      }
      const min = scale.getValueForPixel(nextMinPixel);
      const max = scale.getValueForPixel(nextMaxPixel);
      if (
        min != undefined &&
        max != undefined &&
        Number.isFinite(min) &&
        Number.isFinite(max) &&
        min < max
      ) {
        scale.options.min = min;
        scale.options.max = max;
        changed = true;
      }
    }
    if (changed) {
      this.#chart.update("none");
    }
  }
}
