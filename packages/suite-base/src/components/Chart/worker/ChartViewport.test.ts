/** @vitest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import {
  BasicPlatform,
  Chart,
  LinearScale,
  LogarithmicScale,
  PointElement,
  ScatterController,
} from "chart.js";

import { ChartViewport } from "./ChartViewport";

Chart.register(LinearScale, LogarithmicScale, PointElement, ScatterController);

describe("ChartViewport", () => {
  let chart: Chart<"scatter">;
  let viewport: ChartViewport;

  beforeEach(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    chart = new Chart(canvas, {
      type: "scatter",
      // A worker chart uses BasicPlatform and receives gestures over RPC.
      platform: BasicPlatform,
      data: { datasets: [] },
      options: {
        scales: {
          x: { min: 0, max: 100 },
          y: { min: 0, max: 100 },
          y2: { type: "logarithmic", min: 1, max: 1000, position: "right" },
        },
        plugins: {
          zoom: { zoom: { enabled: true, mode: "x" }, pan: { enabled: true, mode: "xy" } },
        },
      },
    });
    viewport = new ChartViewport(chart, { axisUnderCursor: true });
  });

  afterEach(() => {
    chart.destroy();
  });

  it("zooms the hovered axis without changing the configured wheel mode", () => {
    const { x, y, y2 } = chart.scales;
    const rect = { left: 30, top: 40 };
    viewport.wheel({
      clientX: (y2!.left + y2!.right) / 2 + rect.left,
      clientY: (y2!.top + y2!.bottom) / 2 + rect.top,
      deltaY: -100,
      boundingClientRect: rect,
      zoomMode: "xy",
    });

    expect(y2!.min).toBeGreaterThan(1);
    expect(y2!.max).toBeLessThan(1000);
    expect([x!.min, x!.max, y!.min, y!.max]).toEqual([0, 100, 0, 100]);

    viewport.wheel({
      clientX: x!.getPixelForValue(25) + rect.left,
      clientY: y!.getPixelForValue(50) + rect.top,
      deltaY: -100,
      boundingClientRect: rect,
    });

    expect(x!.min).toBeCloseTo(2.5);
    expect(x!.max).toBeCloseTo(92.5);
    expect([y!.min, y!.max]).toEqual([0, 100]);
  });

  it("applies only the incremental pan distance and stops after pan end", () => {
    const { x, y } = chart.scales;
    const distance = x!.width / 10;
    viewport.panstart({ deltaX: distance, deltaY: 0 });
    viewport.panmove({ deltaX: 2 * distance, deltaY: 0 });
    viewport.panend();
    viewport.panmove({ deltaX: 3 * distance, deltaY: 0 });

    expect(x!.min).toBeCloseTo(-20);
    expect(x!.max).toBeCloseTo(80);
    expect([y!.min, y!.max]).toEqual([0, 100]);
  });

  it("scrolls the view along both pan axes", () => {
    const { x, y } = chart.scales;
    viewport.scroll({ deltaX: x!.width / 10, deltaY: -y!.height / 10 });

    expect(x!.min).toBeCloseTo(10);
    expect(x!.max).toBeCloseTo(110);
    expect(y!.min).toBeCloseTo(10);
    expect(y!.max).toBeCloseTo(110);
  });
});
