// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { add as addTimes, fromSec, isTime, toSec } from "@foxglove/rostime";
import { useCallback, useRef, useMemo, useState } from "react";
import { useMountedState } from "react-use";

import { debouncePromise } from "@lichtblick/den/async";
import { useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { PanelContextMenuItem } from "@lichtblick/suite-base/components/PanelContextMenu";
import { TimeBasedChartTooltipData } from "@lichtblick/suite-base/components/TimeBasedChart/TimeBasedChartTooltipContent";
import {
  TimelineInteractionStateStore,
  useClearHoverValue,
  useSetHoverValue,
  useTimelineInteractionState,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import {
  ElementAtPixelArgs,
  UseHoverHandlersHook as UsePlotInteractionHandlers,
  UsePlotInteractionHandlersProps,
  ZoomMode,
} from "@lichtblick/suite-base/panels/Plot/types";
import {
  PlotPath,
  PlotXAxisVal,
  plotPathDisplayName,
} from "@lichtblick/suite-base/panels/Plot/utils/config";
import { downloadCSV, getCSVColName } from "@lichtblick/suite-base/panels/Plot/utils/csv";
import clipboard from "@lichtblick/suite-base/util/clipboard";
import { downloadFiles } from "@lichtblick/suite-base/util/download";
import { PANEL_TITLE_CONFIG_KEY } from "@lichtblick/suite-base/util/layout";
import { getLineColor } from "@lichtblick/suite-base/util/plotColors";

const selectSetGlobalBounds = (store: TimelineInteractionStateStore) => store.setGlobalBounds;

const DEFAULT_FILE_TITLE = "plot_data";

const usePlotInteractionHandlers = ({
  config,
  coordinator,
  draggingRef,
  renderer,
  setActiveTooltip,
  shouldSync,
  subscriberId,
}: UsePlotInteractionHandlersProps): UsePlotInteractionHandlers => {
  const setHoverValue = useSetHoverValue();
  const clearHoverValue = useClearHoverValue();
  const isMounted = useMountedState();
  const mousePresentRef = useRef(false);
  const { xAxisVal: xAxisMode, [PANEL_TITLE_CONFIG_KEY]: customTitle } = config;
  const setGlobalBounds = useTimelineInteractionState(selectSetGlobalBounds);
  const getMessagePipelineState = useMessagePipelineGetter();
  const [focusedPath, setFocusedPath] = useState<undefined | string[]>(undefined);
  /** x value and tooltip rows under the cursor, for "Copy values at cursor" */
  const cursorValuesRef = useRef<{ x?: number; items: TimeBasedChartTooltipData[] }>({
    items: [],
  });

  const buildTooltip = useMemo(() => {
    return debouncePromise(async (args: ElementAtPixelArgs) => {
      const pixel = { x: args.canvasX, y: args.canvasY };
      // Time plots show every series' value at the hovered time, including sparse series whose last
      // sample is earlier. Other plots show the points under the cursor.
      const elements =
        xAxisMode === "timestamp"
          ? await renderer?.getLatestElementsAtPixel(pixel)
          : await renderer?.getElementsAtPixel(pixel);

      if (!isMounted()) {
        return;
      }

      // Looking up a tooltip is an async operation so the mouse might leave the component while
      // that is happening and we need to avoid showing a tooltip.
      if (!elements || elements.length === 0 || !mousePresentRef.current) {
        cursorValuesRef.current.items = [];
        setActiveTooltip(undefined);
        return;
      }

      const tooltipItems: TimeBasedChartTooltipData[] = [];

      for (const element of elements) {
        const value = element.data.value ?? element.data.y;
        const tooltipValue = typeof value === "object" && isTime(value) ? toSec(value) : value;

        tooltipItems.push({
          configIndex: element.configIndex,
          value: tooltipValue,
          ageSec: element.ageSec,
        });
      }

      cursorValuesRef.current.items = tooltipItems;
      setActiveTooltip({
        x: args.clientX,
        y: args.clientY,
        data: tooltipItems,
      });
    });
  }, [renderer, isMounted, setActiveTooltip, xAxisMode]);

  // Extract the bounding client rect from currentTarget before calling the debounced function
  // because react re-uses the SyntheticEvent objects.
  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      mousePresentRef.current = true;
      const boundingRect = event.currentTarget.getBoundingClientRect();
      buildTooltip({
        clientX: event.clientX,
        clientY: event.clientY,
        canvasX: event.clientX - boundingRect.left,
        canvasY: event.clientY - boundingRect.top,
      });

      if (!coordinator) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const seconds = coordinator.getXValueAtPixel(mouseX);
      cursorValuesRef.current.x = seconds;

      setHoverValue({
        componentId: subscriberId,
        value: seconds,
        type: xAxisMode === "timestamp" ? "PLAYBACK_SECONDS" : "OTHER",
      });
    },
    [buildTooltip, coordinator, setHoverValue, subscriberId, xAxisMode],
  );

  const onMouseOut = useCallback(() => {
    mousePresentRef.current = false;
    cursorValuesRef.current = { items: [] };
    setActiveTooltip(undefined);
    clearHoverValue(subscriberId);
  }, [clearHoverValue, subscriberId, setActiveTooltip]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      if (!coordinator) {
        return;
      }

      const boundingRect = event.currentTarget.getBoundingClientRect();
      coordinator.addInteractionEvent({
        type: "wheel",
        zoomMode: zoomModeForModifiers(event),
        cancelable: false,
        // Shift+wheel scrolls horizontally on some platforms, so the delta can arrive as deltaX.
        deltaY: event.deltaY !== 0 ? event.deltaY : event.deltaX,
        deltaX: event.deltaX,
        clientX: event.clientX,
        clientY: event.clientY,
        boundingClientRect: boundingRect.toJSON(),
      });
    },
    [coordinator],
  );

  const onResetView = useCallback(() => {
    if (!coordinator) {
      return;
    }

    coordinator.resetBounds();

    if (shouldSync) {
      setGlobalBounds(undefined);
    }
  }, [coordinator, setGlobalBounds, shouldSync]);

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      // If we started a drag we should not register a seek
      if (draggingRef.current) {
        return;
      }

      // Only timestamp plots support click-to-seek
      if (xAxisMode !== "timestamp" || !coordinator) {
        return;
      }

      const {
        seekPlayback,
        playerState: { activeData: { startTime: start } = {} },
      } = getMessagePipelineState();

      if (!seekPlayback || !start) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;

      const seekSeconds = coordinator.getXValueAtPixel(mouseX);
      // Avoid normalizing a negative time if the clicked point had x < 0.
      if (seekSeconds >= 0) {
        seekPlayback(addTimes(start, fromSec(seekSeconds)));
      }
    },
    [coordinator, draggingRef, getMessagePipelineState, xAxisMode],
  );

  const onClickPath = useCallback((index: number) => {
    setFocusedPath(["paths", String(index)]);
  }, []);

  const isHovered = useCallback(() => mousePresentRef.current, []);

  const { keyDownHandlers, keyUpHandlers } = useMemo(() => {
    return {
      keyDownHandlers: {
        v: () => {
          coordinator?.setZoomMode("y");
        },
        b: () => {
          coordinator?.setZoomMode("xy");
        },
        // Reset the hovered plot. Other keys and plots keep the event.
        r: () => {
          if (!mousePresentRef.current) {
            return false;
          }
          onResetView();
          return true;
        },
      },
      keyUpHandlers: {
        v: () => {
          coordinator?.resetZoomMode();
        },
        b: () => {
          coordinator?.resetZoomMode();
        },
      },
    };
  }, [coordinator, onResetView]);

  const fileTitle = customTitle ?? DEFAULT_FILE_TITLE;

  const onDownloadCsvClick = useCallback(
    (range: "all" | "visible") => {
      void (async () => {
        try {
          const data = await (range === "visible"
            ? coordinator?.getVisibleCsvData()
            : coordinator?.getCsvData());
          if (!data || !isMounted()) {
            return;
          }

          downloadCSV(range === "visible" ? `${fileTitle}_visible` : fileTitle, data, xAxisMode);
        } catch (err: unknown) {
          console.error(err);
        }
      })();
    },
    [coordinator, fileTitle, isMounted, xAxisMode],
  );

  const onSavePngClick = useCallback(() => {
    void (async () => {
      try {
        const legend = config.paths.flatMap((path, index) =>
          path.enabled
            ? [{ label: plotPathDisplayName(path, index), color: getLineColor(path.color, index) }]
            : [],
        );
        const blob = await renderer?.getImageBlob(legend);
        if (!blob || !isMounted()) {
          return;
        }
        downloadFiles([{ blob, fileName: `${fileTitle}.png` }]);
      } catch (err: unknown) {
        console.error(err);
      }
    })();
  }, [config.paths, fileTitle, isMounted, renderer]);

  const getPanelContextMenuItems = useCallback(() => {
    // Read when the menu opens, while the cursor is still over the plot
    const cursorValues = cursorValuesRef.current;
    const cursorText = formatCursorValues(cursorValues, config.paths, xAxisMode);
    const items: PanelContextMenuItem[] = [
      {
        type: "item",
        label: "Copy values at cursor",
        disabled: cursorText == undefined,
        onclick: () => {
          if (cursorText != undefined) {
            void clipboard.copy(cursorText);
          }
        },
      },
      { type: "divider" },
      {
        type: "item",
        label: "Download plot data as CSV",
        onclick: () => {
          onDownloadCsvClick("all");
        },
      },
      {
        type: "item",
        label: "Download visible range as CSV",
        onclick: () => {
          onDownloadCsvClick("visible");
        },
      },
      {
        type: "item",
        label: "Save as PNG",
        onclick: onSavePngClick,
      },
    ];
    return items;
  }, [config.paths, onDownloadCsvClick, onSavePngClick, xAxisMode]);

  return {
    onMouseMove,
    onMouseOut,
    onWheel,
    onResetView,
    onClick,
    onClickPath,
    focusedPath,
    keyDownHandlers,
    keyUpHandlers,
    getPanelContextMenuItems,
    isHovered,
  };
};

/**
 * Tab-separated "name, value" rows for the x value and each series under the cursor, ready to
 * paste into a spreadsheet. Undefined when the cursor is not over a value.
 */
export function formatCursorValues(
  cursor: { x?: number; items: readonly TimeBasedChartTooltipData[] },
  paths: readonly PlotPath[],
  xAxisVal: PlotXAxisVal,
): string | undefined {
  if (cursor.items.length === 0) {
    return undefined;
  }
  const rows = cursor.items.map((item) => {
    const path = paths[item.configIndex];
    const name = path
      ? plotPathDisplayName(path, item.configIndex)
      : `Series ${item.configIndex + 1}`;
    return `${name}\t${String(item.value)}`;
  });
  if (cursor.x != undefined) {
    rows.unshift(`${getCSVColName(xAxisVal)}\t${cursor.x}`);
  }
  return rows.join("\n");
}

/** Shift zooms y, Alt/Option zooms x, both zoom both; no modifier keeps the plot's mode. */
export function zoomModeForModifiers(event: {
  shiftKey: boolean;
  altKey: boolean;
}): ZoomMode | undefined {
  if (event.shiftKey && event.altKey) {
    return "xy";
  }
  if (event.shiftKey) {
    return "y";
  }
  if (event.altKey) {
    return "x";
  }
  return undefined;
}

export default usePlotInteractionHandlers;
