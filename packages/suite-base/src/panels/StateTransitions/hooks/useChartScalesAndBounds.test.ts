/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { act, renderHook } from "@testing-library/react";

import { DEFAULT_X_END_TIME } from "@lichtblick/suite-base/panels/StateTransitions/hooks/constants";
import { StateTransitionConfig } from "@lichtblick/suite-base/panels/StateTransitions/types";

import useChartScalesAndBounds from "./useChartScalesAndBounds";

describe("useChartScalesAndBounds", () => {
  const config: StateTransitionConfig = {
    xAxisMinValue: undefined,
    xAxisMaxValue: undefined,
    xAxisRange: undefined,
    paths: [],
    isSynced: false,
  };

  it("should return correct yScale with given minY", () => {
    const { result } = renderHook(() => useChartScalesAndBounds(0, undefined, undefined, config));
    expect(result.current.yScale).toEqual({
      ticks: { display: false },
      grid: { display: false },
      type: "linear",
      min: 0,
      max: -3,
    });
  });

  it("should return correct xScale", () => {
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, undefined, config),
    );
    expect(result.current.xScale).toEqual({
      type: "linear",
      border: { display: false },
      title: { display: false, text: undefined },
    });
  });

  it("should return xScale with title when xAxisLabel is set", () => {
    const customConfig = { ...config, xAxisLabel: "Time (s)" };
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, undefined, customConfig),
    );
    expect(result.current.xScale).toEqual({
      type: "linear",
      border: { display: false },
      title: { display: true, text: "Time (s)" },
    });
  });

  it("should return correct databounds when xAxisRange is defined", () => {
    const customConfig = { ...config, xAxisRange: 100 };
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, 200, undefined, customConfig),
    );
    expect(result.current.databounds).toEqual({
      x: { min: 100, max: 200 },
      y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    });
  });

  it("should return correct databounds when xAxisMinValue and xAxisMaxValue are defined", () => {
    const customConfig = { ...config, xAxisMinValue: 0, xAxisMaxValue: 500 };
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, 1000, customConfig),
    );
    expect(result.current.databounds).toEqual({
      x: { min: 0, max: 500 },
      y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    });
  });

  it("should return correct databounds when only xAxisMinValue is defined", () => {
    const customConfig = { ...config, xAxisMinValue: 50 };
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, 1000, customConfig),
    );
    expect(result.current.databounds).toEqual({
      x: { min: 50, max: 1000 },
      y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    });
  });

  it("should return correct databounds when only xAxisMaxValue is defined", () => {
    const customConfig = { ...config, xAxisMaxValue: 500 };
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, 1000, customConfig),
    );
    expect(result.current.databounds).toEqual({
      x: { min: 0, max: 500 },
      y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    });
  });

  it("should return correct databounds when endTimeSinceStart is defined", () => {
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, 1000, config),
    );
    expect(result.current.databounds).toEqual({
      x: { min: 0, max: 1000 },
      y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    });
  });

  it("should default to safe databounds when endTimeSinceStart is undefined", () => {
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, undefined, config),
    );
    expect(result.current.databounds).toEqual({
      x: { min: 0, max: DEFAULT_X_END_TIME },
      y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    });
  });

  it("should return correct width and sizeRef", () => {
    const { result } = renderHook(() =>
      useChartScalesAndBounds(undefined, undefined, undefined, config),
    );
    expect(result.current.width).toBeUndefined();
    expect(result.current.sizeRef).toBeDefined();
  });
  describe("wheel over the chart", () => {
    beforeEach(() => {
      // Size tracking is irrelevant here; the jsdom stub fires during the effect and trips React.
      vi.stubGlobal(
        "ResizeObserver",
        class {
          public observe(): void {}
          public disconnect(): void {}
        },
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function setup() {
      const scroller = document.createElement("div");
      const wrapper = document.createElement("div");
      scroller.appendChild(wrapper);
      document.body.appendChild(scroller);
      const { result, unmount } = renderHook(() =>
        useChartScalesAndBounds(undefined, undefined, undefined, config),
      );
      act(() => {
        result.current.sizeRef(wrapper);
      });
      // React listens at the root, so a listener above the wrapper stands in for the chart's zoom.
      const zoom = vi.fn();
      scroller.addEventListener("wheel", zoom);
      const wheel = (init: WheelEventInit) => {
        const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
        wrapper.dispatchEvent(event);
        return event;
      };
      return { scroller, zoom, wheel, unmount };
    }

    it("zooms on a plain wheel and never scrolls natively", () => {
      const { scroller, zoom, wheel, unmount } = setup();
      const event = wheel({ deltaY: 100 });
      expect(event.defaultPrevented).toBe(true);
      expect(zoom).toHaveBeenCalledTimes(1);
      expect(scroller.scrollTop).toBe(0);
      unmount();
    });

    it.each([
      { name: "deltaY", init: { deltaY: 100 }, expected: 100 },
      {
        name: "deltaX (macOS reports Shift+wheel as horizontal)",
        init: { deltaX: 50 },
        expected: 50,
      },
      {
        name: "line mode",
        init: { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE },
        expected: 48,
      },
    ])("scrolls the panel instead of zooming on Shift+wheel ($name)", ({ init, expected }) => {
      const { scroller, zoom, wheel, unmount } = setup();
      const event = wheel({ shiftKey: true, ...init });
      expect(event.defaultPrevented).toBe(true);
      expect(zoom).not.toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(expected);
      unmount();
    });
  });
});
