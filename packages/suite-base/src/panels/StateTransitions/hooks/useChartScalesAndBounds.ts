// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ScaleOptions } from "chart.js";
import { RefCallback, useEffect, useMemo } from "react";

import { useElementSize } from "@lichtblick/suite-base/hooks/useElementSize";
import {
  DEFAULT_X_END_TIME,
  Y_AXIS_MAX,
} from "@lichtblick/suite-base/panels/StateTransitions/hooks/constants";
import { StateTransitionConfig } from "@lichtblick/suite-base/panels/StateTransitions/types";
import { Bounds } from "@lichtblick/suite-base/types/Bounds";

type UseChartScalesAndBounds = {
  yScale: ScaleOptions<"linear">;
  xScale: ScaleOptions<"linear">;
  databounds: Bounds | undefined;
  width: number | undefined;
  sizeRef: RefCallback<HTMLDivElement>;
};

const useChartScalesAndBounds = (
  minY: number | undefined,
  currentTimeSinceStart: number | undefined,
  endTimeSinceStart: number | undefined,
  config: StateTransitionConfig,
): UseChartScalesAndBounds => {
  const yScale = useMemo<ScaleOptions<"linear">>(() => {
    return {
      ticks: {
        // Hide all y-axis ticks since each bar on the y-axis is just a separate path.
        display: false,
      },
      grid: {
        display: false,
      },
      type: "linear",
      min: minY,
      max: Y_AXIS_MAX,
    };
  }, [minY]);

  const xScale = useMemo<ScaleOptions<"linear">>(() => {
    return {
      type: "linear",
      border: {
        display: false,
      },
      title: {
        display: (config.xAxisLabel ?? "").length > 0,
        text: config.xAxisLabel,
      },
    };
  }, [config.xAxisLabel]);

  // Compute the fixed bounds (either via min/max x-axis config or end time since start).
  //
  // For recordings, the bounds are actually fixed but for live connections the "endTimeSinceStart"
  // will increase and these bounds are not technically fixed. But in those instances there is also
  // new data coming in when the bounds are changing.
  //
  // We need to keep the fixedBounds reference stable (if it can be stable) for the databounds memo
  // below, otherwise playing through a recording will update the currentTimeSince start and return
  // a new fixedBounds reference which causes expensive downstream rendering.
  const fixedBounds = useMemo(() => {
    const xDefaultMax = endTimeSinceStart ?? DEFAULT_X_END_TIME;

    if (config.xAxisMinValue != undefined || config.xAxisMaxValue != undefined) {
      return {
        x: {
          min: config.xAxisMinValue ?? 0,
          max: config.xAxisMaxValue ?? xDefaultMax,
        },
        y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
      };
    }

    // If we have no configured xAxis min/max or range, then we set the x axis max to end time
    // This will mirror the plot behavior of showing the full x-axis for data time range rather
    // than constantly adjusting the end time to the latest loaded state transition while data
    // is loading.
    return {
      x: { min: 0, max: xDefaultMax },
      y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    };
  }, [config.xAxisMaxValue, config.xAxisMinValue, endTimeSinceStart]);

  // Compute the data bounds. The bounds are either a fixed amount of lookback from the current time
  // or they are fixed bounds with a specific range.
  const databounds: undefined | Bounds = useMemo(() => {
    if (config.xAxisRange != undefined && currentTimeSinceStart != undefined) {
      return {
        x: { min: currentTimeSinceStart - config.xAxisRange, max: currentTimeSinceStart },
        y: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
      };
    }

    return fixedBounds;
  }, [config.xAxisRange, currentTimeSinceStart, fixedBounds]);

  const { width, ref: sizeRef, element: sizeElement } = useElementSize<HTMLDivElement>();

  // A plain wheel zooms the chart, so native scrolling of the chart wrapper (sizeRef) is always
  // blocked; it would otherwise zoom AND scroll once the rows overflow the panel. Shift+wheel
  // scrolls the panel instead (macOS reports it as deltaX, Firefox may report lines).
  useEffect(() => {
    const el = sizeElement;
    const handler = (ev: WheelEvent) => {
      ev.preventDefault();
      const scroller = el?.parentElement;
      if (!ev.shiftKey || !scroller) {
        return;
      }
      // Runs before React's root listener, so the chart's onWheel doesn't zoom.
      ev.stopPropagation();
      const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
      scroller.scrollTop += ev.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta * 16 : delta;
    };

    el?.addEventListener("wheel", handler, { passive: false });
    return () => {
      el?.removeEventListener("wheel", handler);
    };
  }, [sizeElement]);

  return { yScale, xScale, databounds, width, sizeRef };
};

export default useChartScalesAndBounds;
