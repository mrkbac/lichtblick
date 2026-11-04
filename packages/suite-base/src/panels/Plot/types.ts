// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Chart, ChartDataset } from "chart.js";
import { TFunction } from "i18next";
import { RefObject } from "react";

import { Immutable, SettingsTreeActionUpdatePayload } from "@lichtblick/suite";
import { PanelContextMenuItem } from "@lichtblick/suite-base/components/PanelContextMenu";
import { TimeBasedChartTooltipData } from "@lichtblick/suite-base/components/TimeBasedChart/TimeBasedChartTooltipContent";
import { OffscreenCanvasRenderer } from "@lichtblick/suite-base/panels/Plot/OffscreenCanvasRenderer";
import type { PlotCoordinator } from "@lichtblick/suite-base/panels/Plot/PlotCoordinator";
import { CurrentCustomDatasetsBuilder } from "@lichtblick/suite-base/panels/Plot/builders/CurrentCustomDatasetsBuilder";
import { CustomDatasetsBuilder } from "@lichtblick/suite-base/panels/Plot/builders/CustomDatasetsBuilder";
import { IndexDatasetsBuilder } from "@lichtblick/suite-base/panels/Plot/builders/IndexDatasetsBuilder";
import { TimestampDatasetsBuilder } from "@lichtblick/suite-base/panels/Plot/builders/TimestampDatasetsBuilder";
import {
  PlotConfig,
  PlotPath,
  PlotXAxisVal,
} from "@lichtblick/suite-base/panels/Plot/utils/config";
import { DeltaMarker } from "@lichtblick/suite-base/panels/shared/types";
import { Bounds1D } from "@lichtblick/suite-base/types/Bounds";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { OriginalValue } from "./utils/datum";

export type Scale = {
  min: number;
  max: number;
  left: number;
  right: number;
};

export type YScale = {
  min: number;
  max: number;
  top: number;
  bottom: number;
};

export type BaseInteractionEvent = {
  cancelable: boolean;
  deltaY: number;
  deltaX: number;

  boundingClientRect: DOMRect;
};

export type MouseBase = BaseInteractionEvent & {
  clientX: number;
  clientY: number;
};

export type ZoomMode = "x" | "y" | "xy";

export type WheelInteractionEvent = {
  type: "wheel";
  /** Overrides the zoom mode for this event (modifier keys). Hovering an axis always zooms only that axis. */
  zoomMode?: ZoomMode;
} & BaseInteractionEvent &
  MouseBase;

export type PanStartInteractionEvent = {
  type: "panstart";
} & BaseInteractionEvent & {
    center: { x: number; y: number };
  };
export type PanMoveInteractionEvent = {
  type: "panmove";
} & BaseInteractionEvent;

export type PanEndInteractionEvent = { type: "panend" } & BaseInteractionEvent;

export type InteractionEvent =
  | WheelInteractionEvent
  | PanStartInteractionEvent
  | PanMoveInteractionEvent
  | PanEndInteractionEvent;

export type Datum = { x: number; y: number } & { value?: OriginalValue };

export type Dataset = ChartDataset<"scatter", Datum[]>;

export type ChartType = Chart<"scatter", Datum[]>;

export type HoverElement = {
  data: Datum;
  configIndex: number;
  /** Seconds between the sample and the hovered time, set when the sample is not under the cursor. */
  ageSec?: number;
};

/** Canvas-pixel rectangle */
export type PixelRect = { left: number; right: number; top: number; bottom: number };

export type Size = { width: number; height: number };

export type ReferenceLine = { color: string; value: number; scaleID?: "y" | "y2" };

export type SecondaryYAxisOptions = {
  display: boolean;
  showLabels: boolean;
  label: string;
  showGrid: boolean;
};

export type UpdateAction = {
  type: "update";
  size?: { width: number; height: number };
  showXAxisLabels?: boolean;
  showYAxisLabels?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  xBounds?: Partial<Bounds1D>;
  yBounds?: Partial<Bounds1D>;
  y2Bounds?: Partial<Bounds1D>;
  y2Axis?: SecondaryYAxisOptions;
  showXAxisGrid?: boolean;
  showYAxisGrid?: boolean;
  /** Format x ticks as wall-clock time: seconds of the plot's x = 0. Undefined shows relative seconds. */
  xTickFormat?: { absoluteStartSec?: number };
  /** Lock one x unit to one y unit */
  equalAxes?: boolean;
  zoomMode?: ZoomMode;
  referenceLines?: ReferenceLine[];
  interactionEvents?: InteractionEvent[];
};

// allows us to override the chart.ctx instance field which zoom plugin uses for adding event listeners
export type MutableContext<T> = Omit<Chart, "ctx"> & { ctx: T };

export type PanEvent = {
  deltaX: number;
  deltaY: number;
};

export type PanStartEvent = PanEvent & {
  center: { x: number; y: number };
  target: {
    getBoundingClientRect(): DOMRect;
  };
};

export type ZoomableChart = Chart & {
  $zoom: {
    /** Plugin options as resolved at the last chart update; read by the wheel handler. */
    _options?: { zoom?: { mode?: ZoomMode; overScaleMode?: ZoomMode } };
    panStartHandler(event: PanStartEvent): void;
    panHandler(event: PanEvent): void;
    panEndHandler(): void;
  };
};

export type PlotProps = {
  config: PlotConfig;
  saveConfig: SaveConfig<PlotConfig>;
};

export type ElementAtPixelArgs = {
  clientX: number;
  clientY: number;
  canvasX: number;
  canvasY: number;
};

export type UseHoverHandlersHook = {
  onMouseMove: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseOut: () => void;
  onWheel: (event: React.WheelEvent<HTMLElement>) => void;
  onResetView: () => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onClickPath: (index: number) => void;
  focusedPath: string[] | undefined;
  keyDownHandlers: {
    v: () => void;
    b: () => void;
    r: () => boolean;
  };
  keyUpHandlers: {
    v: () => void;
    b: () => void;
  };
  getPanelContextMenuItems: () => PanelContextMenuItem[];
  /** True while the mouse is over the plot */
  isHovered: () => boolean;
};

export type TooltipStateSetter = {
  x: number;
  y: number;
  data: TimeBasedChartTooltipData[];
};

export type ChartRendererProps = {
  canvas: OffscreenCanvas;
  devicePixelRatio: number;
  gridColor: string;
  tickColor: string;
  titleColor: string;
};

export type ChartOptionsPlot = Omit<ChartRendererProps, "canvas">;

export type VerticalBarsProps = {
  coordinator?: PlotCoordinator;
  hoverComponentId: string;
  xAxisIsPlaybackTime: boolean;
};

export type DeltaMarkerBarsProps = {
  coordinator?: Pick<PlotCoordinator, "on" | "off">;
  /** Whether Measure mode is active - the DeltaOverlay renders as soon as this is true. */
  active: boolean;
  markerA?: DeltaMarker;
  markerB?: DeltaMarker;
  colorsByDatasetIndex: Record<string, string>;
  deltaRowLabel: string;
  xColumnLabel: string;
  yColumnLabel: string;
  markerALabel: string;
  markerBLabel: string;
  onRemoveMarkerA: () => void;
  onRemoveMarkerB: () => void;
  /** Shown below the delta overlay, e.g. range statistics */
  children?: React.ReactNode;
};

export type UsePlotDataHandling = {
  colorsByDatasetIndex: Record<string, string>;
  labelsByDatasetIndex: Record<string, string>;
  datasetsBuilder:
    | TimestampDatasetsBuilder
    | IndexDatasetsBuilder
    | CustomDatasetsBuilder
    | CurrentCustomDatasetsBuilder;
};

export type UsePlotInteractionHandlersProps = {
  config: PlotConfig;
  coordinator: PlotCoordinator | undefined;
  draggingRef: RefObject<boolean>;
  renderer: OffscreenCanvasRenderer | undefined;
  setActiveTooltip: (data: TooltipStateSetter | undefined) => void;
  shouldSync: boolean;
  subscriberId: string;
};

export type PlotCoordinatorEventTypes = {
  timeseriesBounds(bounds: Immutable<Bounds1D>): void;

  /** X scale changed. */
  xScaleChanged(scale: Scale | undefined): void;

  /** Y scale changed. */
  yScaleChanged(scale: YScale | undefined): void;

  /** Current values changed (for displaying in the legend) */
  currentValuesChanged(values: readonly unknown[]): void;

  /** Paths with mismatched data lengths were detected */
  pathsWithMismatchedDataLengthsChanged(pathsWithMismatchedDataLengths: string[]): void;

  /** Rendering updated the viewport. `canReset` is true if the viewport can be reset. */
  viewportChange(canReset: boolean): void;
};

export type ConfigBounds = { x: Partial<Bounds1D>; y: Partial<Bounds1D> };

export type HandleAction = {
  draft: PlotConfig;
};

export type HandleDeleteSeriesAction = HandleAction & {
  index: number;
};

export type HandleUpdateAction = HandleAction & Omit<SettingsTreeActionUpdatePayload, "input">;

export type MakeSeriesNode = {
  path: PlotPath;
  /** Cross-message modifiers like `.@derivative` need a time axis */
  supportsStreamModifiers: boolean;
  index: number;
  canDelete: boolean;
  canReorder: boolean;
  t: TFunction<"plot">;
  /** Some series settings only apply to one x-axis mode */
  xAxisVal?: PlotXAxisVal;
};

export type MakeRootSeriesNode = {
  paths: PlotPath[];
  supportsStreamModifiers: boolean;
  t: TFunction<"plot">;
  xAxisVal?: PlotXAxisVal;
};

export type HandleMoveSeriesAction = HandleAction & {
  index: number;
  direction: "up" | "down";
};
