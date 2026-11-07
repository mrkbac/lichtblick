// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { Zoom as ZoomPlugin } from "@foxglove/chartjs-plugin-zoom";
import { Chart, ChartOptions, Element, InteractionItem, Scale } from "chart.js";
import type { Mock } from "vitest";

import { Immutable } from "@lichtblick/suite";
import {
  alignTicksTo,
  ChartRenderer,
  holdXPadding,
} from "@lichtblick/suite-base/panels/Plot/ChartRenderer";
import { DEFAULT_ANNOTATION } from "@lichtblick/suite-base/panels/Plot/constants";
import { getChartOptions } from "@lichtblick/suite-base/panels/Plot/utils/getChartOptions";
import { BasicBuilder } from "@lichtblick/test-builders";

import {
  ChartOptionsPlot,
  ChartRendererProps,
  ChartType,
  Dataset,
  PanEndInteractionEvent,
  PanMoveInteractionEvent,
  PanStartInteractionEvent,
  ReferenceLine,
  UpdateAction,
  WheelInteractionEvent,
} from "./types";

const OPTIONS_CHART: ChartOptionsPlot = vi.hoisted(() => ({
  devicePixelRatio: 2,
  gridColor: "#ccc",
  tickColor: "#000",
  titleColor: "#111",
}));

const SCALES_CHART: Record<string, Partial<Scale>> = {
  x: { min: 0, max: 100 },
  y: { min: 0, max: 100 },
};

vi.mock("chart.js", () => {
  const canvas = { width: 0, height: 0 };
  const options: ChartOptions = {
    scales: {
      x: {
        ticks: {
          color: OPTIONS_CHART.tickColor,
        },
      },
      y: {
        ticks: {
          color: OPTIONS_CHART.tickColor,
        },
      },
    },
    plugins: {},
    interaction: {},
  };

  return {
    Ticks: { formatters: { numeric: (value: number) => String(value) } },
    Chart: vi.fn().mockImplementation(function () {
      return {
        update: vi.fn(),
        resize: vi.fn(),
        data: { datasets: [] },
        options,
        scales: SCALES_CHART,
        canvas,
        $zoom: {
          panStartHandler: vi.fn(),
          panHandler: vi.fn(),
          panEndHandler: vi.fn(),
        },
        getElementsAtEventForMode: vi.fn().mockReturnValue([]),
      };
    }),
  };
});

vi.mock("@foxglove/chartjs-plugin-zoom", () => ({
  Zoom: {
    start: vi.fn(),
  },
}));

vi.mock("@lichtblick/suite-base/panels/Plot/utils/getChartOptions", () => ({
  getChartOptions: vi.fn().mockReturnValue({}),
}));

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

type ChartRendererTestSetup = {
  actionOverride?: Partial<UpdateAction>;
};

describe("alignTicksTo", () => {
  it("keeps the step and moves the ticks to whole steps from the origin", () => {
    // chart.js ticks for 270.4–300.4, with includeBounds' short first step
    const ticks = [270.4, 275, 280, 285, 290, 295, 300].map((value) => ({ value }));
    const aligned = alignTicksTo(ticks, 270.4, 300.4, 300.4).map((tick) => tick.value);
    expect(aligned).toHaveLength(7);
    aligned.forEach((value, i) => {
      expect(value).toBeCloseTo(270.4 + i * 5);
    });
  });

  it("leaves fewer than two ticks alone", () => {
    expect(alignTicksTo([{ value: 1 }], 0, 2, 0.5)).toEqual([{ value: 1 }]);
  });
});

describe("ChartRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
  });

  function setup({ actionOverride }: ChartRendererTestSetup = {}) {
    const canvas = new OffscreenCanvas(500, 500);
    const props: ChartRendererProps = {
      canvas,
      ...OPTIONS_CHART,
    };

    const action: Immutable<UpdateAction> = {
      type: "update",
      ...actionOverride,
    };

    const chartOptions = {
      scales: {
        x: { ticks: { tickColor: props.tickColor } },
        y: { ticks: { tickColor: props.tickColor } },
      },
    };
    (getChartOptions as Mock).mockReturnValue(chartOptions);

    const chartRenderer = new ChartRenderer(props);

    return {
      canvas,
      props,
      chartRenderer,
      action,
      chartOptions,
    };
  }

  describe("constructor", () => {
    it("should initialize a Chart instance with correct chart options", () => {
      const { props } = setup();

      expect(Chart).toHaveBeenCalledWith(expect.anything(), {
        data: { datasets: [] },
        options: expect.any(Object),
        plugins: [ZoomPlugin],
        type: "scatter",
      });
      expect(getChartOptions).toHaveBeenCalledWith({
        devicePixelRatio: props.devicePixelRatio,
        gridColor: props.gridColor,
        tickColor: props.tickColor,
        titleColor: props.titleColor,
      });
    });
  });

  describe("update", () => {
    it("labels x ticks as seconds before the current time", () => {
      // GIVEN relative-to-now ticks at 300.4 s since start
      const { chartRenderer, chartOptions } = setup();
      chartRenderer.update({
        type: "update",
        xTickFormat: { relativeToNow: true },
        xNowSec: 300.4,
      });
      const x = chartOptions.scales.x as unknown as {
        afterBuildTicks: (scale: unknown) => void;
        ticks: { callback: (value: number, index: number, ticks: { value: number }[]) => string };
      };

      // WHEN chart.js builds ticks for a 30 s window
      const scale = {
        min: 270.4,
        max: 300.4,
        ticks: [275, 280, 285, 290, 295, 300].map((value) => ({ value })),
      };
      x.afterBuildTicks(scale);
      const labels = scale.ticks.map((tick, i) => x.ticks.callback(tick.value, i, scale.ticks));

      // THEN they read -30 … 0
      expect(labels.map(Number)).toEqual(
        [-30, -25, -20, -15, -10, -5, 0].map((v) => expect.closeTo(v)),
      );
      expect(labels.at(-1)).toBe("0");
    });

    it("should update chart dimensions on update action", () => {
      const { action, chartRenderer } = setup({
        actionOverride: {
          size: {
            width: BasicBuilder.number({ min: 800, max: 3840 }),
            height: BasicBuilder.number({ min: 600, max: 2160 }),
          },
        },
      });

      chartRenderer.update(action);
      const chartInstance = (chartRenderer as any).getChartInstance();
      const resizeSpy = vi.spyOn(chartInstance, "resize");

      expect(chartInstance.canvas.width).toBe(action.size?.width);
      expect(chartInstance.canvas.height).toBe(action.size?.height);
      expect(resizeSpy).toHaveBeenCalledTimes(1);
    });

    it("should update chart scales on update action", () => {
      const { action, chartRenderer } = setup({
        actionOverride: {
          xBounds: {
            min: BasicBuilder.number({ min: 0, max: 100 }),
            max: BasicBuilder.number({ min: 101, max: 200 }),
          },
          yBounds: {
            min: BasicBuilder.number({ min: 0, max: 100 }),
            max: BasicBuilder.number({ min: 101, max: 200 }),
          },
        },
      });

      chartRenderer.update(action);
      const chartInstance: ChartType = (chartRenderer as any).getChartInstance();

      expect(chartInstance.options.scales!.x!.min).toBe(action.xBounds!.min);
      expect(chartInstance.options.scales!.x!.max).toBe(action.xBounds!.max);
      expect(chartInstance.options.scales!.y!.min).toBe(action.yBounds!.min);
      expect(chartInstance.options.scales!.y!.max).toBe(action.yBounds!.max);
    });

    it("should display x-axis labels when enabled in update action", () => {
      const { action, chartRenderer } = setup({
        actionOverride: {
          showXAxisLabels: true,
        },
      });

      chartRenderer.update(action);
      const chartInstance: ChartType = (chartRenderer as any).getChartInstance();

      expect(chartInstance.options.scales!.x!.ticks?.display).toBe(true);
    });

    it("should display y-axis labels when enabled in update action", () => {
      const { action, chartRenderer } = setup({
        actionOverride: {
          showYAxisLabels: true,
        },
      });

      chartRenderer.update(action);
      const chartInstance: ChartType = (chartRenderer as any).getChartInstance();

      expect(chartInstance.options.scales!.y!.ticks?.display).toBe(true);
    });

    it("should set x-axis title when provided in update action", () => {
      const xAxisLabel = BasicBuilder.string();
      const { action, chartRenderer } = setup({
        actionOverride: {
          xAxisLabel,
        },
      });

      chartRenderer.update(action);
      const chartInstance: ChartType = (chartRenderer as any).getChartInstance();
      expect(chartInstance.options.scales!.x!.title).toEqual({
        display: true,
        text: xAxisLabel,
        color: OPTIONS_CHART.titleColor,
      });
    });

    it("should set y-axis title when provided in update action", () => {
      const yAxisLabel = BasicBuilder.string();
      const { action, chartRenderer } = setup({
        actionOverride: {
          yAxisLabel,
        },
      });

      chartRenderer.update(action);
      const chartInstance: ChartType = (chartRenderer as any).getChartInstance();
      expect(chartInstance.options.scales!.y!.title).toEqual({
        display: true,
        text: yAxisLabel,
        color: OPTIONS_CHART.titleColor,
      });
    });

    it("should update chart on update action", () => {
      const { action, chartRenderer } = setup();

      chartRenderer.update(action);
      const chartInstance = (chartRenderer as any).getChartInstance();
      const updateSpy = vi.spyOn(chartInstance, "update");

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith("none");
    });

    it("should update returns x and y scales", () => {
      const { action, chartRenderer } = setup();

      const chartUpdated = chartRenderer.update(action);

      expect(chartUpdated?.x.min).toBe(SCALES_CHART.x!.min!);
      expect(chartUpdated?.x.max).toBe(SCALES_CHART.x!.max!);
      expect(chartUpdated?.y.min).toBe(SCALES_CHART.y!.min!);
      expect(chartUpdated?.y.max).toBe(SCALES_CHART.y!.max!);
    });

    it("should update returns undefined", () => {
      (Chart as unknown as Mock).mockImplementationOnce(function () {
        return {
          update: vi.fn(),
          scales: {
            x: undefined,
            y: undefined,
          },
        };
      });
      const { action, chartRenderer } = setup();

      const chartUpdated = chartRenderer.update(action);

      expect(chartUpdated).toBeUndefined();
    });

    it("should update when wheel event type", () => {
      const wheelEvent = {
        type: "wheel",
        boundingClientRect: {},
        deltaX: BasicBuilder.number(),
        deltaY: BasicBuilder.number(),
      } as WheelInteractionEvent;
      const { action, chartRenderer } = setup({
        actionOverride: {
          type: "update",
          interactionEvents: [wheelEvent],
        },
      });
      const fakeNodeEventsEmitSpy = vi.spyOn((chartRenderer as any).getFakeNodeEvents(), "emit");

      chartRenderer.update(action);

      expect(fakeNodeEventsEmitSpy).toHaveBeenCalledWith("wheel", {
        deltaX: wheelEvent.deltaX,
        deltaY: wheelEvent.deltaY,
        target: expect.objectContaining({
          getBoundingClientRect: expect.any(Function),
        }),
      });
    });

    it("should update when panstart event type", () => {
      const panStartEvent = {
        type: "panstart",
        boundingClientRect: {},
        center: { x: BasicBuilder.number(), y: BasicBuilder.number() },
      } as PanStartInteractionEvent;
      const { action, chartRenderer } = setup({
        actionOverride: {
          type: "update",
          interactionEvents: [panStartEvent],
        },
      });
      const chartInstance = (chartRenderer as any).getChartInstance();
      const panStartHandlerSpy = vi.spyOn(chartInstance.$zoom, "panStartHandler");

      chartRenderer.update(action);

      expect(panStartHandlerSpy).toHaveBeenCalledWith({
        center: panStartEvent.center,
        deltaX: undefined,
        deltaY: undefined,
        target: expect.objectContaining({
          getBoundingClientRect: expect.any(Function),
        }),
      });
    });

    it("should update when panmove event type", () => {
      const panMoveEvent = {
        type: "panmove",
      } as PanMoveInteractionEvent;
      const { action, chartRenderer } = setup({
        actionOverride: {
          type: "update",
          interactionEvents: [panMoveEvent],
        },
      });
      const chartInstance = (chartRenderer as any).getChartInstance();
      const panHandlerSpy = vi.spyOn(chartInstance.$zoom, "panHandler");

      chartRenderer.update(action);

      expect(panHandlerSpy).toHaveBeenCalledWith(panMoveEvent);
    });

    it("should update when panend event type", () => {
      const panEndEvent = {
        type: "panend",
      } as PanEndInteractionEvent;
      const { action, chartRenderer } = setup({
        actionOverride: {
          type: "update",
          interactionEvents: [panEndEvent],
        },
      });
      const chartInstance = (chartRenderer as any).getChartInstance();
      const panHandlerSpy = vi.spyOn(chartInstance.$zoom, "panEndHandler");

      chartRenderer.update(action);

      expect(panHandlerSpy).toHaveBeenCalledTimes(1);
    });

    it("should handle reference lines in update action", () => {
      (Chart as unknown as Mock).mockImplementationOnce(function () {
        return {
          update: vi.fn(),
          scales: SCALES_CHART,
          options: {
            plugins: {
              annotation: {
                annotations: [{}],
              },
            },
          } as ChartOptions,
        };
      });
      const referenceLines: ReferenceLine[] = [
        { value: BasicBuilder.number(), color: BasicBuilder.string() },
        { value: BasicBuilder.number(), color: BasicBuilder.string() },
      ];
      const { chartRenderer, action } = setup({
        actionOverride: { referenceLines },
      });
      const chartInstance = (chartRenderer as any).getChartInstance();

      chartRenderer.update(action);

      const newAnnotations = chartInstance.options.plugins?.annotation?.annotations;
      expect(newAnnotations).toEqual([
        {
          ...DEFAULT_ANNOTATION,
          borderColor: referenceLines[0]?.color,
          value: referenceLines[0]?.value,
        },
        {
          ...DEFAULT_ANNOTATION,
          borderColor: referenceLines[1]?.color,
          value: referenceLines[1]?.value,
        },
      ]);
    });
  });

  describe("log scale and reference line options", () => {
    function setupWithAnnotations() {
      (Chart as unknown as Mock).mockImplementationOnce(function () {
        return {
          update: vi.fn(),
          scales: SCALES_CHART,
          options: {
            scales: { x: {}, y: { type: "linear" }, y2: { type: "linear" } },
            plugins: { annotation: { annotations: [] } },
          } as unknown as ChartOptions,
        };
      });
      const { chartRenderer } = setup();
      return {
        chartRenderer,
        chart: (
          chartRenderer as unknown as { getChartInstance: () => ChartType }
        ).getChartInstance(),
      };
    }

    it("switches each y axis between linear and logarithmic", () => {
      const { chartRenderer, chart } = setupWithAnnotations();

      chartRenderer.update({ type: "update", yLogScale: true, y2LogScale: false });

      expect(chart.options.scales?.y?.type).toBe("logarithmic");
      expect(chart.options.scales?.y2?.type).toBe("linear");

      chartRenderer.update({ type: "update", yLogScale: false });
      expect(chart.options.scales?.y?.type).toBe("linear");
    });

    it("uses dark label text on light reference lines", () => {
      const { chartRenderer, chart } = setupWithAnnotations();

      chartRenderer.update({
        type: "update",
        referenceLines: [{ value: 1, color: "#ffffff", label: "max" }],
      });

      const annotations = chart.options.plugins?.annotation?.annotations as Record<
        string,
        unknown
      >[];
      expect(annotations[0]).toMatchObject({ label: { color: "#000" } });
    });

    it("draws vertical reference lines and labels the ones that have a label", () => {
      const { chartRenderer, chart } = setupWithAnnotations();

      chartRenderer.update({
        type: "update",
        referenceLines: [
          { value: 3, color: "#f00", scaleID: "x", label: "start" },
          { value: 1, color: "#0f0" },
        ],
      });

      const annotations = chart.options.plugins?.annotation?.annotations as Record<
        string,
        unknown
      >[];
      expect(annotations[0]).toMatchObject({
        scaleID: "x",
        value: 3,
        label: { display: true, content: "start", backgroundColor: "#f00", color: "#fff" },
      });
      expect(annotations[1]).toMatchObject({ scaleID: "y", value: 1, label: undefined });
    });
  });

  describe("getLatestElementsAtPixel", () => {
    it("returns each dataset's last sample at or before the hovered x, with its age when stale", () => {
      // GIVEN a dense series, a sparse series and a series that starts after the cursor
      const { chartRenderer } = setup();
      const chartInstance = (chartRenderer as any).getChartInstance();
      // 1 pixel per unit
      chartInstance.scales = {
        x: {
          getValueForPixel: (px: number) => px,
          getPixelForValue: (value: number) => value,
        },
      };
      chartInstance.data.datasets = [
        {
          data: [
            { x: 9, y: 1 },
            { x: 10, y: 2 },
            { x: 11, y: 3 },
          ],
        },
        {
          data: [
            { x: 2, y: 5 },
            { x: 4, y: NaN },
            { x: 30, y: 6 },
          ],
        },
        { data: [{ x: 20, y: 7 }] },
      ];

      // WHEN hovering x = 10
      const elements = chartRenderer.getLatestElementsAtPixel({ x: 10, y: 0 });

      // THEN the dense series is under the cursor, the sparse one is 8 s old (the NaN break is
      // skipped) and the late series has nothing yet
      expect(elements).toEqual([
        { data: { x: 10, y: 2 }, configIndex: 0, ageSec: undefined },
        { data: { x: 2, y: 5 }, configIndex: 1, ageSec: 8 },
      ]);
    });
  });

  describe("zoomToRect", () => {
    it("zooms only the x scales in x mode", () => {
      // GIVEN x and y scales mapping 1 pixel to 1 unit
      const { chartRenderer } = setup();
      const chartInstance = (chartRenderer as any).getChartInstance();
      const scale = (id: "x" | "y") => ({
        id,
        isHorizontal: () => id === "x",
        getValueForPixel: (px: number) => px,
      });
      chartInstance.scales = { x: scale("x"), y: scale("y") };
      chartInstance.options.scales.x.min = undefined;
      chartInstance.options.scales.x.max = undefined;
      chartInstance.options.scales.y.min = undefined;
      chartInstance.options.scales.y.max = undefined;

      // WHEN box zooming from pixel 30 to 10 in x mode
      chartRenderer.zoomToRect({ left: 10, right: 30, top: 5, bottom: 50 }, "x");

      // THEN x spans the box and y is untouched
      expect(chartInstance.options.scales.x).toMatchObject({
        min: 10,
        max: 30,
      });
      expect(chartInstance.options.scales.y.min).toBeUndefined();
      expect(chartInstance.options.scales.y.max).toBeUndefined();
    });
  });

  describe("getElementsAtPixel", () => {
    it("should return elements sorted by proximity to a pixel", () => {
      const { chartRenderer } = setup();
      const chartInstance = (chartRenderer as any).getChartInstance();
      const elementsAtEventMock: InteractionItem[] = [
        { element: { x: 10, y: 10 } as Element, datasetIndex: 0, index: 0 },
        { element: { x: 30, y: 30 } as Element, datasetIndex: 1, index: 1 },
        { element: { x: 20, y: 20 } as Element, datasetIndex: 2, index: 2 },
      ];

      (chartInstance.getElementsAtEventForMode as Mock).mockReturnValue(elementsAtEventMock);
      chartInstance.data.datasets = [
        {
          data: [{ x: 10, y: 10 }],
        },
        {
          data: [
            { x: 20, y: 20 },
            { x: 60, y: 60 },
          ],
        },
      ];

      const elements = chartRenderer.getElementsAtPixel({ x: 1000, y: 1000 });

      expect(elements).toEqual([
        { data: chartInstance.data.datasets[1]!.data[1], configIndex: 1 },
        { data: chartInstance.data.datasets[0]!.data[0], configIndex: 0 },
      ]);
    });

    it("should return elements sorted by proximity to a pixel dinamically", () => {
      const { chartRenderer } = setup();
      const chartInstance = (chartRenderer as any).getChartInstance();

      const element1 = {
        x: BasicBuilder.number({ min: 5, max: 15 }),
        y: BasicBuilder.number({ min: 5, max: 15 }),
      };
      const element2 = {
        x: BasicBuilder.number({ min: 16, max: 30 }),
        y: BasicBuilder.number({ min: 16, max: 30 }),
      };

      (chartInstance.getElementsAtEventForMode as Mock).mockReturnValue([
        { element: element1, datasetIndex: 0, index: 0 },
        { element: element2, datasetIndex: 1, index: 1 },
      ]);

      chartInstance.data.datasets = [
        { data: [{ x: element1.x, y: element1.y }] },
        { data: [{ x: element2.x, y: element2.y }] },
      ];

      const pixelPoint = {
        x: BasicBuilder.number({ min: 500, max: 1000 }),
        y: BasicBuilder.number({ min: 500, max: 1000 }),
      };

      const elements = chartRenderer.getElementsAtPixel(pixelPoint);

      expect(elements).toEqual([{ data: { x: element1.x, y: element1.y }, configIndex: 0 }]);
    });
  });

  describe("getImageBlob", () => {
    it("draws the chart and a legend on an opaque background and encodes a PNG", async () => {
      const { chartRenderer } = setup();
      const chart = (
        chartRenderer as unknown as { getChartInstance: () => ChartType }
      ).getChartInstance() as unknown as Record<string, unknown>;
      chart.chartArea = { left: 10, top: 10, right: 100, bottom: 100 };
      chart.currentDevicePixelRatio = 2;
      const ctx = {
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        scale: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn(() => ({ width: 40 })),
      };
      const blob = new Blob(["png"]);
      const convertToBlob = vi.fn().mockResolvedValue(blob);
      const Original = global.OffscreenCanvas;
      global.OffscreenCanvas = class {
        public getContext = () => ctx;
        public convertToBlob = convertToBlob;
      } as unknown as typeof OffscreenCanvas;

      try {
        const result = await chartRenderer.getImageBlob("#fff", [{ label: "/a.x", color: "#f00" }]);

        expect(result).toBe(blob);
        expect(ctx.drawImage).toHaveBeenCalledTimes(1);
        expect(ctx.scale).toHaveBeenCalledWith(2, 2);
        expect(ctx.fillText).toHaveBeenCalledWith("/a.x", expect.any(Number), expect.any(Number));
        expect(convertToBlob).toHaveBeenCalledWith({ type: "image/png" });
      } finally {
        global.OffscreenCanvas = Original;
      }
    });
  });

  describe("threshold shading", () => {
    const series: Dataset[] = [{ data: [{ x: 0, y: 1 }] }, { data: [{ x: 0, y: 5 }] }];
    const shadedLine = { value: 2, color: "#f00", shade: "above" as const, dashed: false };

    function setupShaded() {
      const getElementsAtEventForMode = vi.fn();
      (Chart as unknown as Mock).mockImplementationOnce(function () {
        return {
          update: vi.fn(),
          // 1 pixel per x unit
          scales: {
            ...SCALES_CHART,
            x: {
              ...SCALES_CHART.x,
              getValueForPixel: (px: number) => px,
              getPixelForValue: (value: number) => value,
            },
          },
          data: { datasets: [] },
          getElementsAtEventForMode,
          options: { plugins: { annotation: { annotations: [] } } } as unknown as ChartOptions,
        };
      });
      const { chartRenderer } = setup();
      const chart = (
        chartRenderer as unknown as { getChartInstance: () => ChartType }
      ).getChartInstance();
      chartRenderer.updateDatasets(series);
      chartRenderer.update({ type: "update", referenceLines: [shadedLine] });
      return { chartRenderer, chart, getElementsAtEventForMode };
    }

    it("appends one fill per shaded series after the series datasets", () => {
      // Given two series on the primary axis
      // When a shaded line is set
      const { chart } = setupShaded();

      // Then the series keep their indices and the fills follow them
      expect(chart.data.datasets).toHaveLength(4);
      expect(chart.data.datasets.slice(0, 2)).toEqual(series);
      expect(chart.data.datasets[2]?.data).toBe(series[0]!.data);
      const annotations = chart.options.plugins?.annotation?.annotations as Record<
        string,
        unknown
      >[];
      expect(annotations[0]).toMatchObject({ borderDash: [] });
    });

    it("leaves fills out of hover results", () => {
      // Given a shaded line, and chart.js reporting a fill element under the cursor
      const { chartRenderer, getElementsAtEventForMode } = setupShaded();
      const underCursor: InteractionItem[] = [
        { element: { x: 0, y: 0 } as Element, datasetIndex: 3, index: 0 },
        { element: { x: 0, y: 0 } as Element, datasetIndex: 1, index: 0 },
      ];
      getElementsAtEventForMode.mockReturnValue(underCursor);

      // When hovering
      const elements = chartRenderer.getElementsAtPixel({ x: 0, y: 0 });
      const latest = chartRenderer.getLatestElementsAtPixel({ x: 0, y: 0 });

      // Then only series are reported, by config index
      expect(elements).toEqual([{ data: series[1]!.data[0], configIndex: 1 }]);
      expect(latest.map((element) => element.configIndex)).toEqual([0, 1]);
    });

    it("removes the fills when the line is no longer shaded", () => {
      // Given a shaded line
      const { chartRenderer, chart } = setupShaded();

      // When shading is turned off
      chartRenderer.update({ type: "update", referenceLines: [{ value: 2, color: "#f00" }] });

      // Then the chart shows the series datasets only
      expect(chart.data.datasets).toBe(series);
    });
  });

  describe("updateDatasets", () => {
    it("should update dataset and disable animations", () => {
      const { chartRenderer } = setup();
      const datasets: Dataset[] = [
        { data: [{ x: BasicBuilder.number(), y: BasicBuilder.number() }] },
      ];
      const chartInstance = (chartRenderer as any).getChartInstance();
      const updateSpy = vi.spyOn(chartInstance, "update");

      const result = chartRenderer.updateDatasets(datasets);

      expect(chartInstance.data.datasets).toBe(datasets);
      expect(updateSpy).toHaveBeenCalledWith("none");
      expect(result).toEqual({
        x: {
          min: chartInstance.scales.x?.min,
          max: chartInstance.scales.x?.max,
          left: chartInstance.scales.x?.left,
          right: chartInstance.scales.x?.right,
        },
        y: {
          min: chartInstance.scales.y?.min,
          max: chartInstance.scales.y?.max,
          log: false,
          top: chartInstance.scales.y?.top,
          bottom: chartInstance.scales.y?.bottom,
        },
      });
    });
  });
  it("holds the x padding through its afterFit hook until label visibility flips", () => {
    // Given a renderer and its x scale fit hook
    const { chartRenderer, chartOptions } = setup();
    const afterFit = (
      chartOptions.scales.x as { afterFit?: (scale: Record<string, number>) => void }
    ).afterFit!;
    const fit = (paddingLeft: number, paddingRight: number) => {
      const scale = { min: -34.97, max: 25.03, paddingLeft, paddingRight };
      afterFit(scale);
      return [scale.paddingLeft, scale.paddingRight];
    };

    chartRenderer.update({ type: "update", showXAxisLabels: true });

    // When the same-span window refits with shorter edge labels
    expect(fit(10, 15)).toEqual([10, 15]);
    // Then both paddings keep their widest value
    expect(fit(8, 12)).toEqual([10, 15]);

    // When the same label visibility is sent again, Then nothing resets
    chartRenderer.update({ type: "update", showXAxisLabels: true });
    expect(fit(8, 12)).toEqual([10, 15]);

    // When labels are hidden, Then the padding is sized afresh
    chartRenderer.update({ type: "update", showXAxisLabels: false });
    expect(fit(0, 0)).toEqual([0, 0]);
  });
});

describe("holdXPadding", () => {
  it("keeps the plot area steady while edge labels change width, and resizes on zoom", () => {
    // Given a sliding 60 s window whose edge label is first "25.03", then the shorter "25.1"
    const held = { span: Number.NaN, left: 0, right: 0 };
    const fit = (min: number, max: number, paddingRight: number) => {
      const scale = { min, max, paddingLeft: 0, paddingRight };
      holdXPadding(held, scale);
      return scale.paddingRight;
    };

    // When the window slides, Then the wider padding is kept
    expect(fit(-34.97, 25.03, 15)).toBe(15);
    expect(fit(-34.9, 25.1, 12)).toBe(15);

    // When zooming to a new span, Then the padding fits the new labels
    expect(fit(0, 10, 9)).toBe(9);
  });
});
