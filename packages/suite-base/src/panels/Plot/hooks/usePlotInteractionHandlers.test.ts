/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable @typescript-eslint/unbound-method */
import { Time, toSec } from "@foxglove/rostime";
import { act, renderHook } from "@testing-library/react";
import type { Mock } from "vitest";

import { debouncePromise } from "@lichtblick/den/async";
import { useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { PanelContextMenuItem } from "@lichtblick/suite-base/components/PanelContextMenu";
import { TimeBasedChartTooltipData } from "@lichtblick/suite-base/components/TimeBasedChart/TimeBasedChartTooltipContent";
import {
  useClearHoverValue,
  useSetHoverValue,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import { PlotCoordinator } from "@lichtblick/suite-base/panels/Plot/PlotCoordinator";
import { DEFAULT_PLOT_CONFIG } from "@lichtblick/suite-base/panels/Plot/constants";
import {
  TooltipStateSetter,
  UsePlotInteractionHandlersProps,
} from "@lichtblick/suite-base/panels/Plot/types";
import { PlotConfig } from "@lichtblick/suite-base/panels/Plot/utils/config";
import { downloadCSV } from "@lichtblick/suite-base/panels/Plot/utils/csv";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { PlayerState } from "@lichtblick/suite-base/players/types";
import PlayerBuilder from "@lichtblick/suite-base/testing/builders/PlayerBuilder";
import PlotBuilder from "@lichtblick/suite-base/testing/builders/PlotBuilder";
import RosTimeBuilder from "@lichtblick/suite-base/testing/builders/RosTimeBuilder";
import { downloadFiles } from "@lichtblick/suite-base/util/download";
import { PANEL_TITLE_CONFIG_KEY } from "@lichtblick/suite-base/util/layout";
import { BasicBuilder } from "@lichtblick/test-builders";

import usePlotInteractionHandlers, {
  formatCursorValues,
  formatTimeAgo,
  liveTimeAgo,
} from "./usePlotInteractionHandlers";

vi.mock("@lichtblick/suite-base/panels/Plot/utils/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lichtblick/suite-base/panels/Plot/utils/csv")>()),
  downloadCSV: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/util/download", () => ({
  downloadFiles: vi.fn(),
}));

vi.mock("@lichtblick/den/async", () => ({
  debouncePromise: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/TimelineInteractionStateContext", () => ({
  useSetHoverValue: vi.fn(),
  useClearHoverValue: vi.fn(),
  useTimelineInteractionState: vi.fn(() => vi.fn()),
}));

vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipelineGetter: vi.fn(),
}));

type MenuItem = PanelContextMenuItem & { type: "item" };
function findMenuItem(items: PanelContextMenuItem[], label: string): MenuItem {
  const item = items.find((it): it is MenuItem => it.type === "item" && it.label === label);
  if (!item) {
    throw new Error(`No menu item ${label}`);
  }
  return item;
}

describe("usePlotInteractionHandlers", () => {
  const mockCoordinator = {
    addInteractionEvent: vi.fn(),
    getCsvData: vi.fn(),
    getXValueAtPixel: vi.fn(() => BasicBuilder.number()),
    resetBounds: vi.fn(),
    resetZoomMode: vi.fn(),
    setZoomMode: vi.fn(),
  } as unknown as PlotCoordinator;
  const mockSetHoverValue = vi.fn();
  const mockClearHoverValue = vi.fn();
  const mockSeekPlayback = vi.fn();
  const mockBuildTooltip = vi.fn();

  const setup = ({
    config,
    coordinator,
    draggingRef,
    renderer,
    setActiveTooltip = vi.fn(),
    shouldSync,
    subscriberId,
    playerState = { capabilities: [], activeData: { startTime: RosTimeBuilder.time() } },
  }: Partial<UsePlotInteractionHandlersProps> & { playerState?: unknown } = {}) => {
    (useSetHoverValue as Mock).mockReturnValue(mockSetHoverValue);
    (useClearHoverValue as Mock).mockReturnValue(mockClearHoverValue);
    (useMessagePipelineGetter as Mock).mockReturnValueOnce(
      vi.fn(() => ({
        seekPlayback: mockSeekPlayback,
        playerState,
      })),
    );

    const props: UsePlotInteractionHandlersProps = {
      config: {
        ...DEFAULT_PLOT_CONFIG,
        ...config,
      },
      coordinator,
      draggingRef: { current: false, ...draggingRef },
      renderer: {
        getElementsAtPixel: vi.fn(),
        getLatestElementsAtPixel: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-misused-spread
        ...renderer,
      },
      setActiveTooltip,
      shouldSync: shouldSync ?? false,
      subscriberId: subscriberId ?? BasicBuilder.string(),
    } as unknown as UsePlotInteractionHandlersProps;

    return {
      ...renderHook(() => usePlotInteractionHandlers(props)),
      props,
    };
  };

  const triggerMouseMove = async (
    result: any,
  ): Promise<
    Partial<React.MouseEvent<HTMLElement>> & { expectedCanvasX?: number; expectedCanvasY?: number }
  > => {
    const boundingClientRect = {
      left: BasicBuilder.number(),
      top: BasicBuilder.number(),
    };
    const event: Partial<React.MouseEvent<HTMLElement>> = {
      clientX: BasicBuilder.number(),
      clientY: BasicBuilder.number(),
      currentTarget: {
        getBoundingClientRect: vi.fn(() => ({
          left: boundingClientRect.left,
          top: boundingClientRect.top,
        })),
      } as unknown as EventTarget & HTMLElement,
    };

    const expectedCanvasX = event.clientX! - boundingClientRect.left;
    const expectedCanvasY = event.clientY! - boundingClientRect.top;

    await act(async () => {
      result.current.onMouseMove(event);
    });

    return {
      ...event,
      expectedCanvasX,
      expectedCanvasY,
    };
  };

  const triggerWheel = (
    result: any,
    boundingRect: DOMRect,
  ): Partial<React.WheelEvent<HTMLElement>> => {
    const event: Partial<React.WheelEvent<HTMLElement>> = {
      deltaX: BasicBuilder.number(),
      deltaY: BasicBuilder.number(),
      clientX: BasicBuilder.number(),
      clientY: BasicBuilder.number(),
      currentTarget: {
        getBoundingClientRect: vi.fn(() => boundingRect),
      } as unknown as EventTarget & HTMLElement,
    };

    act(() => {
      result.current.onWheel(event);
    });

    return event;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (debouncePromise as Mock).mockReturnValue(mockBuildTooltip);
  });

  describe("setActiveTooltip", () => {
    it("clears active tooltip if no tooltip items are found", async () => {
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const { result, props } = setup();
      (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce([]);

      await triggerMouseMove(result);

      expect(props.setActiveTooltip).toHaveBeenCalledWith(undefined);
      expect(props.setActiveTooltip).toHaveBeenCalledTimes(1);
    });

    it("passes the age of a sparse series' last sample to the tooltip", async () => {
      const elements = [
        { ...PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: 3 }) }), ageSec: 0.4 },
      ];
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const { result, props } = setup();
      (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce(elements);

      await triggerMouseMove(result);

      expect(props.setActiveTooltip).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [{ configIndex: elements[0]!.configIndex, value: 3, ageSec: 0.4 }],
        }),
      );
    });

    it("says how long ago the hovered time was on a live source", async () => {
      const elements = [PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: 3 }) })];
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const coordinator = {
        ...(mockCoordinator as unknown as Record<string, unknown>),
        getXValueAtPixel: vi.fn(() => 7.69),
      } as unknown as PlotCoordinator;
      const { result, props } = setup({
        coordinator,
        playerState: {
          capabilities: [],
          activeData: { startTime: { sec: 100, nsec: 0 }, endTime: { sec: 110, nsec: 0 } },
        },
      });
      (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce(elements);

      await triggerMouseMove(result);

      expect(props.setActiveTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ header: "2.31 s ago" }),
      );
    });

    it("uses the points under the cursor when the x-axis is not time", async () => {
      const elements = [PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: 5 }) })];
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const { result, props } = setup({ config: { ...DEFAULT_PLOT_CONFIG, xAxisVal: "index" } });
      (props.renderer?.getElementsAtPixel as Mock).mockReturnValueOnce(elements);

      await triggerMouseMove(result);

      expect(props.renderer?.getLatestElementsAtPixel).not.toHaveBeenCalled();
      expect(props.setActiveTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ data: [{ configIndex: elements[0]!.configIndex, value: 5 }] }),
      );
    });

    it("set active tooltip if tooltip items are found with correct data", async () => {
      const elements = [
        PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: BasicBuilder.number() }) }),
      ];
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const { result, props } = setup();
      (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce(elements);

      const mouseMoved = await triggerMouseMove(result);

      const expectedResult: TooltipStateSetter = {
        x: mouseMoved.clientX!,
        y: mouseMoved.clientY!,
        data: [
          {
            configIndex: elements[0]!.configIndex,
            value: elements[0]!.data.value,
          } as TimeBasedChartTooltipData,
        ],
      };
      expect(props.setActiveTooltip).toHaveBeenCalledWith(expectedResult);
      expect(props.setActiveTooltip).toHaveBeenCalledTimes(1);
    });

    it("set active tooltip if tooltip items are found when value is a time object", async () => {
      const elements = [
        PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: RosTimeBuilder.time() }) }),
      ];
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const { result, props } = setup();
      (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce(elements);

      const mouseMoved = await triggerMouseMove(result);

      const expectedResult: TooltipStateSetter = {
        x: mouseMoved.clientX!,
        y: mouseMoved.clientY!,
        data: [
          { configIndex: elements[0]!.configIndex, value: toSec(elements[0]!.data.value as Time) },
        ],
      };
      expect(props.setActiveTooltip).toHaveBeenCalledWith(expectedResult);
      expect(props.setActiveTooltip).toHaveBeenCalledTimes(1);
    });

    it("set active tooltip if tooltip items are found when value is undefined", async () => {
      const elements = PlotBuilder.hoverElements(1);
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const { result, props } = setup();
      (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce(elements);

      const mouseMoved = await triggerMouseMove(result);

      const expectedResult: TooltipStateSetter = {
        x: mouseMoved.clientX!,
        y: mouseMoved.clientY!,
        data: [{ configIndex: elements[0]!.configIndex, value: elements[0]!.data.y }],
      };
      expect(props.setActiveTooltip).toHaveBeenCalledWith(expectedResult);
      expect(props.setActiveTooltip).toHaveBeenCalledTimes(1);
    });

    it("set active tooltip if tooltip items are found when having multiple hover elements", async () => {
      const elements = [
        PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: BasicBuilder.number() }) }),
        PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: BasicBuilder.number() }) }),
        PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: BasicBuilder.number() }) }),
      ];
      (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
      const { result, props } = setup();
      (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce(elements);

      const mouseMoved = await triggerMouseMove(result);

      const expectedResult: TooltipStateSetter = {
        x: mouseMoved.clientX!,
        y: mouseMoved.clientY!,
        data: elements.map((element) => ({
          configIndex: element.configIndex,
          value: element.data.value,
        })) as TimeBasedChartTooltipData[],
      };
      expect(props.setActiveTooltip).toHaveBeenCalledWith(expectedResult);
      expect(props.setActiveTooltip).toHaveBeenCalledTimes(1);
    });
  });

  describe("onMouseMove", () => {
    it("sets hover value when xAxisMode is timestamp", async () => {
      const { result, props } = setup({ coordinator: mockCoordinator });

      const mouseMoved = await triggerMouseMove(result);

      expect(result.current.onMouseMove).toBeDefined();
      expect(props.coordinator?.getXValueAtPixel).toHaveBeenCalledWith(mouseMoved.expectedCanvasX);
      expect(mockBuildTooltip).toHaveBeenCalledWith({
        clientX: mouseMoved.clientX,
        clientY: mouseMoved.clientY,
        canvasX: mouseMoved.expectedCanvasX,
        canvasY: mouseMoved.expectedCanvasY,
      });
      expect(mockSetHoverValue).toHaveBeenCalledWith({
        componentId: props.subscriberId,
        value: expect.any(Number),
        type: "PLAYBACK_SECONDS",
      });
    });

    it("sets hover value with type 'other' when xAxisMode is not timestamp", async () => {
      const { result, props } = setup({
        config: { xAxisVal: "other" } as unknown as PlotConfig,
        coordinator: mockCoordinator,
      });

      const mouseMoved = await triggerMouseMove(result);

      expect(result.current.onMouseMove).toBeDefined();
      expect(props.coordinator?.getXValueAtPixel).toHaveBeenCalledWith(mouseMoved.expectedCanvasX);
      expect(mockBuildTooltip).toHaveBeenCalledWith({
        clientX: mouseMoved.clientX,
        clientY: mouseMoved.clientY,
        canvasX: mouseMoved.expectedCanvasX,
        canvasY: mouseMoved.expectedCanvasY,
      });
      expect(mockSetHoverValue).toHaveBeenCalledWith({
        componentId: props.subscriberId,
        value: expect.any(Number),
        type: "OTHER",
      });
    });

    it("should return early when coordinator is not provided", async () => {
      const { result } = setup();

      await triggerMouseMove(result);

      expect(mockCoordinator.getXValueAtPixel).not.toHaveBeenCalled();
      expect(mockSetHoverValue).not.toHaveBeenCalled();
    });

    describe("when using actual debouncePromise", () => {
      it("calls debouncePromise with correct arguments", async () => {
        const { result, props } = setup({ coordinator: mockCoordinator });

        const mouseMoved = await triggerMouseMove(result);

        expect(props.coordinator?.getXValueAtPixel).toHaveBeenCalledWith(
          mouseMoved.expectedCanvasX,
        );
        expect(mockSetHoverValue).toHaveBeenCalledWith({
          componentId: props.subscriberId,
          value: expect.any(Number),
          type: "PLAYBACK_SECONDS",
        });
      });

      it("calls debouncePromise with correct arguments when elements are found", async () => {
        const elements = [
          PlotBuilder.hoverElement({ data: PlotBuilder.datum({ value: BasicBuilder.number() }) }),
        ];
        (debouncePromise as Mock).mockImplementationOnce((fn) => fn);
        const { result, props } = setup({ coordinator: mockCoordinator });
        (props.renderer?.getLatestElementsAtPixel as Mock).mockReturnValueOnce(elements);

        await triggerMouseMove(result);

        expect(props.setActiveTooltip).toHaveBeenCalled();
        expect(mockSetHoverValue).toHaveBeenCalled();
      });
    });
  });

  describe("onMouseOut", () => {
    it("clears hover value", () => {
      const { result, props } = setup();

      act(() => {
        result.current.onMouseOut();
      });

      expect(props.setActiveTooltip).toHaveBeenCalledWith(undefined);
      expect(mockClearHoverValue).toHaveBeenCalledWith(props.subscriberId);
    });

    it("sets mousePresentRef to false", () => {
      const { result, props } = setup();

      act(() => {
        result.current.onMouseOut();
      });

      expect(props.draggingRef.current).toBe(false);
    });
  });

  describe("onWheel", () => {
    it("handles wheel event correctly", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });
      const boundingRect = {
        left: BasicBuilder.number(),
        top: BasicBuilder.number(),
        toJSON: vi.fn().mockReturnValue({
          left: BasicBuilder.number(),
          top: BasicBuilder.number(),
        }),
      } as unknown as DOMRect;

      const wheel = triggerWheel(result, boundingRect);

      expect(props.coordinator?.addInteractionEvent).toHaveBeenCalledWith({
        type: "wheel",
        cancelable: false,
        deltaX: wheel.deltaX,
        deltaY: wheel.deltaY,
        clientX: wheel.clientX,
        clientY: wheel.clientY,
        boundingClientRect: boundingRect.toJSON(),
      });
    });

    it("should onWheel return early when coordinator is not provided", () => {
      const { result } = setup();

      triggerWheel(result, {
        left: BasicBuilder.number(),
        top: BasicBuilder.number(),
      } as DOMRect);

      expect(mockCoordinator.addInteractionEvent).not.toHaveBeenCalled();
    });
  });

  describe("onResetView", () => {
    it("should onResetView return early when coordinator is not provided", () => {
      const { result } = setup();

      act(() => {
        result.current.onResetView();
      });

      expect(mockCoordinator.resetBounds).not.toHaveBeenCalled();
    });

    it("resets coordinator bounds", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });

      act(() => {
        result.current.onResetView();
      });

      expect(props.coordinator?.resetBounds).toHaveBeenCalled();
    });
  });

  describe("key handlers", () => {
    it("sets zoom mode to 'y' on key down 'v'", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });

      act(() => {
        result.current.keyDownHandlers["plot.zoomY"]();
      });

      expect(props.coordinator?.setZoomMode).toHaveBeenCalledWith("y");
    });

    it("sets zoom mode to 'xy' on key down 'b'", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });

      act(() => {
        result.current.keyDownHandlers["plot.zoomXY"]();
      });

      expect(props.coordinator?.setZoomMode).toHaveBeenCalledWith("xy");
    });

    it("restores the plot's zoom mode on key up 'v'", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });

      act(() => {
        result.current.keyUpHandlers.v();
      });

      expect(props.coordinator?.resetZoomMode).toHaveBeenCalled();
    });

    it("restores the plot's zoom mode on key up 'b'", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });

      act(() => {
        result.current.keyUpHandlers.b();
      });

      expect(props.coordinator?.resetZoomMode).toHaveBeenCalled();
    });
  });

  describe("onClick", () => {
    function buildClickEvent(): React.MouseEvent<HTMLElement> {
      return {
        clientX: BasicBuilder.number(),
        currentTarget: {
          getBoundingClientRect: vi.fn(() => ({ left: BasicBuilder.number() })),
        } as unknown as EventTarget & HTMLElement,
      } as unknown as React.MouseEvent<HTMLElement>;
    }

    it("should return early if draggingRef is true", () => {
      const { result } = setup({ draggingRef: { current: true } });

      act(() => {
        result.current.onClick(buildClickEvent());
      });

      expect(mockSeekPlayback).not.toHaveBeenCalled();
    });

    it("should return early if xAxisMode is not 'timestamp'", () => {
      const { result } = setup({
        config: {
          xAxisVal: "other",
        } as unknown as PlotConfig,
      });

      act(() => {
        result.current.onClick(buildClickEvent());
      });

      expect(mockSeekPlayback).not.toHaveBeenCalled();
    });

    it("should return early if seekPlayback or startTime is undefined", () => {
      (useMessagePipelineGetter as Mock).mockReturnValueOnce({
        seekPlayback: vi.fn(),
        playerState: { capabilities: [], activeData: { startTime: RosTimeBuilder.time() } },
      });
      const { result } = setup();

      act(() => {
        result.current.onClick(buildClickEvent());
      });

      expect(mockSeekPlayback).not.toHaveBeenCalled();
    });

    it("should call seekPlayback when seekSeconds greater than 0", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });
      const seekSeconds = BasicBuilder.number();
      (props.coordinator?.getXValueAtPixel as Mock).mockReturnValueOnce(seekSeconds);

      act(() => {
        result.current.onClick(buildClickEvent());
      });

      expect(mockSeekPlayback).toHaveBeenCalledTimes(1);
    });

    it("should not normalize time if seekSeconds is negative", () => {
      const { result, props } = setup({ coordinator: mockCoordinator });
      const seekSeconds = -1;
      (props.coordinator?.getXValueAtPixel as Mock).mockReturnValue(seekSeconds);

      act(() => {
        result.current.onClick(buildClickEvent());
      });

      expect(mockSeekPlayback).not.toHaveBeenCalled();
    });
  });

  describe("onDownloadCsvClick", () => {
    it("downloads CSV when coordinator returns valid data and component is mounted", async () => {
      const csvData = BasicBuilder.string();
      const customTitle = "my_chart";
      const { result } = setup({
        coordinator: mockCoordinator,
        config: { [PANEL_TITLE_CONFIG_KEY]: customTitle } as unknown as PlotConfig,
      });
      (mockCoordinator.getCsvData as Mock).mockResolvedValueOnce(csvData);

      await act(async () => {
        const item = findMenuItem(
          result.current.getPanelContextMenuItems(),
          "Download plot data as CSV",
        );
        item.onclick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(downloadCSV).toHaveBeenCalledWith(customTitle, csvData, "timestamp");
    });

    it("uses default title when customTitle is undefined", async () => {
      const csvData = BasicBuilder.string();
      const { result } = setup({ coordinator: mockCoordinator });
      (mockCoordinator.getCsvData as Mock).mockResolvedValueOnce(csvData);

      await act(async () => {
        const item = findMenuItem(
          result.current.getPanelContextMenuItems(),
          "Download plot data as CSV",
        );
        item.onclick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(downloadCSV).toHaveBeenCalledWith("plot_data", csvData, "timestamp");
    });

    it("does not download CSV when coordinator returns null data", async () => {
      const { result } = setup({ coordinator: mockCoordinator });
      (mockCoordinator.getCsvData as Mock).mockResolvedValueOnce(undefined);

      await act(async () => {
        const item = findMenuItem(
          result.current.getPanelContextMenuItems(),
          "Download plot data as CSV",
        );
        item.onclick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(downloadCSV).not.toHaveBeenCalled();
    });

    it("does not download CSV when component is not mounted", async () => {
      const csvData = BasicBuilder.string();
      const { result, unmount } = setup({ coordinator: mockCoordinator });
      unmount();
      (mockCoordinator.getCsvData as Mock).mockResolvedValueOnce(csvData);

      await act(async () => {
        const item = findMenuItem(
          result.current.getPanelContextMenuItems(),
          "Download plot data as CSV",
        );
        item.onclick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(downloadCSV).not.toHaveBeenCalled();
    });

    it("handles error and logs to console.error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("CSV fetch failed");
      const { result } = setup({ coordinator: mockCoordinator });
      (mockCoordinator.getCsvData as Mock).mockRejectedValueOnce(error);

      await act(async () => {
        const item = findMenuItem(
          result.current.getPanelContextMenuItems(),
          "Download plot data as CSV",
        );
        item.onclick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(error);
      expect(downloadCSV).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("getPanelContextMenuItems", () => {
    it("offers copy, both CSV downloads and PNG export", () => {
      const { result } = setup();

      const labels = result.current
        .getPanelContextMenuItems()
        .flatMap((item) => (item.type === "item" ? [item.label] : []));

      expect(labels).toEqual([
        "Copy values at cursor",
        "Download plot data as CSV",
        "Download visible range as CSV",
        "Save as PNG",
      ]);
    });

    it("disables copy when the cursor is not over a value", () => {
      const { result } = setup();

      const item = findMenuItem(result.current.getPanelContextMenuItems(), "Copy values at cursor");

      expect(item.disabled).toBe(true);
    });

    it("downloads the visible range with a _visible file name", async () => {
      const csvData = BasicBuilder.string();
      const coordinator = {
        getVisibleCsvData: vi.fn().mockResolvedValueOnce(csvData),
      } as unknown as PlotCoordinator;
      const { result } = setup({ coordinator });

      await act(async () => {
        findMenuItem(
          result.current.getPanelContextMenuItems(),
          "Download visible range as CSV",
        ).onclick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(downloadCSV).toHaveBeenCalledWith("plot_data_visible", csvData, "timestamp");
    });

    it("saves the chart as PNG with a legend of the enabled series", async () => {
      const blob = new Blob(["png"]);
      const getImageBlob = vi.fn().mockResolvedValueOnce(blob);
      const { result } = setup({
        renderer: { getImageBlob } as unknown as UsePlotInteractionHandlersProps["renderer"],
        config: {
          paths: [
            { value: "/a.x", enabled: true, timestampMethod: "receiveTime", color: "#f00" },
            { value: "/b.y", enabled: false, timestampMethod: "receiveTime" },
          ],
        } as unknown as PlotConfig,
      });

      await act(async () => {
        findMenuItem(result.current.getPanelContextMenuItems(), "Save as PNG").onclick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(getImageBlob).toHaveBeenCalledWith([{ label: "/a.x", color: "#f00" }]);
      expect(downloadFiles).toHaveBeenCalledWith([{ blob, fileName: "plot_data.png" }]);
    });
  });
});

describe("formatCursorValues", () => {
  const paths = [
    { value: "/a.x", enabled: true, timestampMethod: "receiveTime" as const },
    { value: "/b.y", label: "speed", enabled: true, timestampMethod: "receiveTime" as const },
  ];

  it("returns undefined without values under the cursor", () => {
    expect(formatCursorValues({ x: 1, items: [] }, paths, "timestamp")).toBeUndefined();
  });

  it("lists the x value and each series as tab-separated rows", () => {
    expect(
      formatCursorValues(
        {
          x: 1.5,
          items: [
            { configIndex: 0, value: 3 },
            { configIndex: 1, value: "fast" },
          ],
        },
        paths,
        "timestamp",
      ),
    ).toBe("elapsed time\t1.5\n/a.x\t3\nspeed\tfast");
  });
});

describe("formatTimeAgo", () => {
  it.each([
    [0, "0.00 s ago"],
    [2.314, "2.31 s ago"],
    [59.5, "59.50 s ago"],
    [192.4, "3 min 12 s ago"],
    [7500, "2 h 5 min ago"],
  ])("formats %d s as %s", (seconds, text) => {
    expect(formatTimeAgo(seconds)).toBe(text);
  });
});

describe("liveTimeAgo", () => {
  const activeData = { startTime: { sec: 100, nsec: 0 }, endTime: { sec: 110, nsec: 0 } };
  const state = (capabilities: string[]) =>
    ({ capabilities, activeData }) as unknown as PlayerState;

  it("measures from the newest data on a live source", () => {
    expect(liveTimeAgo(state([]), 4)).toBe("6.00 s ago");
  });

  it("is empty for recordings", () => {
    expect(liveTimeAgo(state([PLAYER_CAPABILITIES.playbackControl]), 4)).toBeUndefined();
  });

  it("is empty before the data or without an x scale", () => {
    expect(liveTimeAgo(state([]), -1)).toBeUndefined();
  });

  it("is empty past the newest data", () => {
    expect(liveTimeAgo(state([]), 11)).toBeUndefined();
  });

  it("measures from the current time on any source when labelled relative to now", () => {
    const playback = PlayerBuilder.playerState({
      capabilities: [PLAYER_CAPABILITIES.playbackControl],
      activeData: PlayerBuilder.activeData({
        startTime: { sec: 100, nsec: 0 },
        currentTime: { sec: 107, nsec: 0 },
        endTime: { sec: 110, nsec: 0 },
      }),
    });
    expect(liveTimeAgo(playback, 4, { relativeToNow: true })).toBe("3.00 s ago");
  });
});
