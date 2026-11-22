/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChartOptions } from "chart.js";

import ChartJsMux from "./ChartJsMux";

// The worker loads its font once at import; hold it so the chart is created late, as in the app.
const font = vi.hoisted(() => {
  let resolve: (font: FontFace) => void = () => {};
  const loaded = new Promise<FontFace>((r) => {
    resolve = r;
  });
  return {
    loaded,
    resolve: (f: FontFace) => {
      resolve(f);
    },
  };
});
vi.mock("@lichtblick/suite-base/panels/shared/loadFont", () => ({
  loadDefaultFont: async () => await font.loaded,
}));

// The plugin resolves to its UMD build, whose export is the plugin itself rather than `Zoom`.
vi.mock("@foxglove/chartjs-plugin-zoom", async () => ({
  Zoom: (await vi.importActual<{ default: unknown }>("@foxglove/chartjs-plugin-zoom")).default,
}));

function options(xMax: number): ChartOptions {
  return {
    animation: false,
    scales: { x: { type: "linear", min: 0, max: xMax }, y: { type: "linear", min: -10, max: -3 } },
  };
}

describe("ChartJsMux", () => {
  it("applies the first update even when the font loads after initialize was called", async () => {
    const mux = new ChartJsMux();
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 100;

    // The panel initializes before it knows the recording's end time, then updates the bounds.
    const initialized = mux.initialize({
      id: "chart",
      node: { canvas },
      type: "scatter",
      data: { datasets: [] },
      options: options(1),
      devicePixelRatio: 1,
      fontLoaded: Promise.resolve({} as FontFace),
    });
    setTimeout(() => {
      font.resolve({ family: "monospace", status: "loaded" } as FontFace);
    }, 10);
    await initialized;

    const scales = mux.update({ id: "chart", options: options(30), isBoundsReset: false });

    expect(scales.x).toMatchObject({ min: 0, max: 30 });
    mux.destroy({ id: "chart", event: undefined });
  });
});
