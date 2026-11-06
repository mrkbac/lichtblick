// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  ArrowCounterclockwise20Regular,
  TextBulletListLtr20Regular,
  ZoomIn20Regular,
} from "@fluentui/react-icons";
import { Tooltip, Fade, useTheme } from "@mui/material";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { MessagePath } from "@lichtblick/message-path";
import { Immutable } from "@lichtblick/suite";
import * as PanelAPI from "@lichtblick/suite-base/PanelAPI";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { messagePathStructures } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import { resolveEnumNamesInPath } from "@lichtblick/suite-base/components/MessagePathSyntax/resolveEnumNames";
import {
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { PanelContextMenu } from "@lichtblick/suite-base/components/PanelContextMenu";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import { PANEL_TOOLBAR_MIN_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import Stack from "@lichtblick/suite-base/components/Stack";
import TimeBasedChartTooltipContent from "@lichtblick/suite-base/components/TimeBasedChart/TimeBasedChartTooltipContent";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { DeltaMarkerBars } from "@lichtblick/suite-base/panels/Plot/DeltaMarkerBars";
import { VerticalBars } from "@lichtblick/suite-base/panels/Plot/VerticalBars";
import useDeltaMeasureMode from "@lichtblick/suite-base/panels/Plot/hooks/useDeltaMeasureMode";
import usePanning from "@lichtblick/suite-base/panels/Plot/hooks/usePanning";
import usePlotInteractionHandlers from "@lichtblick/suite-base/panels/Plot/hooks/usePlotInteractionHandlers";
import { PLOT_SHORTCUTS } from "@lichtblick/suite-base/panels/Plot/shortcuts";
import {
  PixelRect,
  PlotProps,
  TooltipStateSetter,
  ZoomMode,
} from "@lichtblick/suite-base/panels/Plot/types";
import { getPlotMode } from "@lichtblick/suite-base/panels/Plot/utils/config";
import { MeasureModeToolbarButton } from "@lichtblick/suite-base/panels/shared/MeasureModeToolbarButton";
import { createMeasureModeEscapeHandler } from "@lichtblick/suite-base/panels/shared/measureModeEscapeHandler";
import useAppendOnlyKey from "@lichtblick/suite-base/panels/shared/useAppendOnlyKey";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

import { BoxZoomOverlay } from "./BoxZoomOverlay";
import { useStyles } from "./Plot.style";
import { PlotCoordinator } from "./PlotCoordinator";
import { PlotLegend } from "./PlotLegend";
import { RangeStatsTable, useRangeStats } from "./RangeStats";
import useGlobalSync from "./hooks/useGlobalSync";
import usePlotDataHandling from "./hooks/usePlotDataHandling";
import usePlotPanelSettings from "./hooks/usePlotPanelSettings";
import useRenderer from "./hooks/useRenderer";
import useSubscriptions from "./hooks/useSubscriptions";

/** The user's axis label, or the fallback when there is none */
const labelOr = (label: string | undefined, fallback: string): string =>
  label != undefined && label !== "" ? label : fallback;

const Plot = (props: PlotProps): React.JSX.Element => {
  const { saveConfig, config } = props;
  const {
    paths: series,
    showLegend,
    xAxisVal: xAxisMode,
    legendDisplay,
    sidebarDimension,
  } = config;

  const { classes, cx } = useStyles();
  const theme = useTheme();
  const { t } = useTranslation("plot");

  const { setMessagePathDropConfig } = usePanelContext();
  const draggingRef = useRef(false);

  // When true the user can reset the plot back to the original view
  const [canReset, setCanReset] = useState(false);

  const [activeTooltip, setActiveTooltip] = useState<TooltipStateSetter>();
  const [boxZoomActive, setBoxZoomActive] = useState(false);

  const [subscriberId] = useState(() => randomUUID());
  const [canvasDiv, setCanvasDiv] = useState<HTMLDivElement | null>(null);
  const [coordinator, setCoordinator] = useState<PlotCoordinator | undefined>(undefined);
  const shouldSync = config.isSynced;
  const plotMode = getPlotMode(config);
  // A spectrum or histogram names its axes unless the user did
  const coordinatorConfig = useMemo(
    () =>
      plotMode === "time"
        ? config
        : {
            ...config,
            xAxisLabel: labelOr(config.xAxisLabel, t(plotMode === "fft" ? "frequencyHz" : "value")),
            yAxisLabel: labelOr(config.yAxisLabel, t(plotMode === "fft" ? "amplitude" : "count")),
          },
    [config, plotMode, t],
  );
  const renderer = useRenderer(canvasDiv, theme);
  const { globalVariables } = useGlobalVariables();
  const { topics, datatypes } = PanelAPI.useDataSourceInfo();
  const resolveEnumNames = useMemo(() => {
    const structures = messagePathStructures(datatypes);
    const enumValues = enumValuesByDatatypeAndField(datatypes);
    const schemaNames = new Map(topics.map((topic) => [topic.name, topic.schemaName]));
    return (path: MessagePath) =>
      resolveEnumNamesInPath(path, structures, enumValues, schemaNames.get(path.topicName));
  }, [datatypes, topics]);
  const getMessagePipelineState = useMessagePipelineGetter();
  const subscribeMessagePipeline = useMessagePipelineSubscribe();
  const subscribeMessageRange = useSubscribeMessageRange();

  const {
    onMouseMove,
    onMouseOut,
    onResetView,
    onWheel,
    onClick,
    onClickPath,
    focusedPath,
    keyDownHandlers,
    keyUpHandlers,
    getPanelContextMenuItems,
    isHovered,
  } = usePlotInteractionHandlers({
    config,
    coordinator,
    draggingRef,
    setActiveTooltip,
    renderer,
    shouldSync,
    subscriberId,
  });

  usePlotPanelSettings(config, saveConfig, focusedPath);
  useSubscriptions(config, subscriberId);
  useGlobalSync(coordinator, setCanReset, { shouldSync }, subscriberId);
  usePanning(canvasDiv, coordinator, draggingRef);
  const { colorsByDatasetIndex, labelsByDatasetIndex, datasetsBuilder } = usePlotDataHandling(
    config,
    globalVariables,
  );

  const seriesValues = useMemo(
    () =>
      config.paths.map(
        ({ value, enabled, timestampMethod, timestampPath }) =>
          `${value}|${enabled}|${timestampMethod}|${timestampPath ?? ""}`,
      ),
    [config.paths],
  );
  const stableSeriesKey = useAppendOnlyKey(seriesValues);
  const deltaMeasureModeResetKey = `${xAxisMode}|${plotMode}|${config.xAxisPath?.value ?? ""}|${stableSeriesKey}`;
  const deltaMeasureMode = useDeltaMeasureMode({
    coordinator,
    renderer,
    draggingRef,
    resetKey: deltaMeasureModeResetKey,
  });
  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (deltaMeasureMode.active) {
        deltaMeasureMode.handleCanvasClick(event);
        return;
      }
      onClick(event);
    },
    [deltaMeasureMode, onClick],
  );
  const isHoveringSelectablePoint = deltaMeasureMode.active && activeTooltip != undefined;
  // Range statistics are over time; markers on a spectrum or histogram are not times
  const rangeStats = useRangeStats(
    plotMode === "time" ? coordinator : undefined,
    deltaMeasureMode.markerA,
    deltaMeasureMode.markerB,
  );

  const toggleLegend = useCallback(() => {
    saveConfig({ showLegend: !showLegend });
  }, [saveConfig, showLegend]);

  const toggleBoxZoom = useCallback(() => {
    setBoxZoomActive((active) => !active);
  }, []);
  const handleBoxZoom = useCallback(
    (rect: PixelRect, mode: ZoomMode) => {
      void coordinator?.zoomToPixelRect(rect, mode);
    },
    [coordinator],
  );

  const mergedKeyDownHandlers = useMemo(() => {
    const measureEscape = createMeasureModeEscapeHandler(deltaMeasureMode);
    return shortcutKeyHandlers(PLOT_SHORTCUTS, {
      ...keyDownHandlers,
      // Toggle the zoom tool of the hovered plot
      "plot.boxZoom": () => {
        if (!isHovered()) {
          return false;
        }
        toggleBoxZoom();
        return true;
      },
      "plot.cancel": () => {
        if (boxZoomActive) {
          setBoxZoomActive(false);
          return true;
        }
        return measureEscape();
      },
    });
  }, [boxZoomActive, deltaMeasureMode, isHovered, keyDownHandlers, toggleBoxZoom]);

  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus(paths) {
        if (paths.some((path) => !path.isLeaf)) {
          return { canDrop: false };
        }
        return { canDrop: true, effect: "add" };
      },
      handleDrop(paths) {
        saveConfig((prevConfig) => ({
          ...prevConfig,
          paths: [
            ...prevConfig.paths,
            ...paths.map((path) => ({
              value: path.path,
              enabled: true,
              timestampMethod: "receiveTime" as const,
            })),
          ],
        }));
      },
    });
  }, [saveConfig, setMessagePathDropConfig]);

  useEffect(() => {
    coordinator?.handleConfig(
      coordinatorConfig,
      theme.palette.mode,
      globalVariables,
      resolveEnumNames,
    );

    // When config changes (e.g., series reordering) and the player is paused,
    // we need to re-process the current player state to update the rendered data
    if (coordinator) {
      coordinator.handlePlayerState(getMessagePipelineState().playerState);
    }
  }, [
    coordinator,
    coordinatorConfig,
    globalVariables,
    resolveEnumNames,
    theme.palette.mode,
    getMessagePipelineState,
  ]);

  // This effect must come after the one above it so the coordinator gets the latest config before
  // the latest player state and can properly initialize if the player state already contains the
  // data for display.
  useEffect(() => {
    if (!coordinator) {
      return;
    }

    const unsub = subscribeMessagePipeline((state) => {
      coordinator.handlePlayerState(state.playerState);
    });

    // Subscribing only gets us _new_ updates, so we feed the latest state into the chart
    coordinator.handlePlayerState(getMessagePipelineState().playerState);
    return unsub;
  }, [coordinator, getMessagePipelineState, subscribeMessagePipeline]);

  useEffect(() => {
    if (coordinator) {
      coordinator.setShouldSync({ shouldSync });
    }
  }, [coordinator, shouldSync]);

  useEffect(() => {
    if (!renderer || !canvasDiv) {
      return;
    }

    const contentRect = canvasDiv.getBoundingClientRect();

    const plotCoordinator = new PlotCoordinator(renderer, datasetsBuilder, subscribeMessageRange);
    setCoordinator(plotCoordinator);

    plotCoordinator.setSize({
      width: contentRect.width,
      height: contentRect.height,
    });

    const isCanvasTarget = (entry: Immutable<ResizeObserverEntry>) => entry.target === canvasDiv;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = _.findLast(entries, isCanvasTarget);
      if (entry != undefined) {
        plotCoordinator.setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(canvasDiv);

    return () => {
      resizeObserver.disconnect();
      plotCoordinator.destroy();
    };
  }, [canvasDiv, datasetsBuilder, renderer, subscribeMessageRange]);

  const numSeries = config.paths.length;
  const tooltipContent = useMemo(() => {
    return activeTooltip ? (
      <TimeBasedChartTooltipContent
        content={activeTooltip.data}
        header={activeTooltip.header}
        multiDataset={numSeries > 1}
        colorsByConfigIndex={colorsByDatasetIndex}
        labelsByConfigIndex={labelsByDatasetIndex}
      />
    ) : undefined;
  }, [activeTooltip, colorsByDatasetIndex, labelsByDatasetIndex, numSeries]);

  const hoveredValuesBySeriesIndex = useMemo(() => {
    if (!config.showPlotValuesInLegend || !activeTooltip?.data) {
      return;
    }

    const values = new Array(config.paths.length).fill(undefined);
    for (const item of activeTooltip.data) {
      values[item.configIndex] ??= item.value;
    }

    return values;
  }, [activeTooltip, config.paths.length, config.showPlotValuesInLegend]);

  return (
    <Stack
      flex="auto"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      position="relative"
    >
      <MeasureModeToolbarButton
        active={deltaMeasureMode.active}
        onToggle={deltaMeasureMode.toggleActive}
        title={t("measureMode")}
        testId="plot-measure-mode-toggle"
      >
        {canReset && (
          <ToolbarIconButton
            title={`${t("resetView")} (double-click)`}
            aria-label={t("resetView")}
            onClick={onResetView}
            data-testid="plot-reset-view-button"
          >
            <ArrowCounterclockwise20Regular />
          </ToolbarIconButton>
        )}
        {legendDisplay !== "none" && (
          <ToolbarIconButton
            title={t("legend")}
            aria-label={t("legend")}
            aria-pressed={showLegend}
            color={showLegend ? "primary" : "default"}
            onClick={toggleLegend}
            data-testid="plot-legend-toggle"
          >
            <TextBulletListLtr20Regular />
          </ToolbarIconButton>
        )}
        <ToolbarIconButton
          title={t("zoomTool")}
          aria-label={t("zoomTool")}
          aria-pressed={boxZoomActive}
          color={boxZoomActive ? "primary" : "default"}
          onClick={toggleBoxZoom}
          data-testid="plot-box-zoom-toggle"
        >
          <ZoomIn20Regular />
        </ToolbarIconButton>
      </MeasureModeToolbarButton>
      <Stack
        direction={legendDisplay === "top" ? "column" : "row"}
        flex="auto"
        fullWidth
        style={{ height: `calc(100% - ${PANEL_TOOLBAR_MIN_HEIGHT}px)` }}
        position="relative"
      >
        {/* Pass stable values here for properties when not showing values so that the legend memoization remains stable. */}
        {legendDisplay !== "none" && showLegend && (
          <PlotLegend
            coordinator={coordinator}
            legendDisplay={legendDisplay}
            onClickPath={onClickPath}
            paths={series}
            saveConfig={saveConfig}
            sidebarDimension={sidebarDimension}
            showValues={config.showPlotValuesInLegend}
            hoveredValuesBySeriesIndex={hoveredValuesBySeriesIndex}
          />
        )}
        <Tooltip
          arrow={false}
          classes={{ tooltip: classes.tooltip }}
          open={tooltipContent != undefined}
          placement="right"
          title={tooltipContent ?? <></>}
          disableInteractive
          followCursor
          slots={{ transition: Fade }}
          slotProps={{ transition: { timeout: 0 } }}
        >
          <div className={classes.verticalBarWrapper} data-testid="vertical-bar-wrapper">
            <div
              className={cx(
                classes.canvasDiv,
                isHoveringSelectablePoint && classes.canvasDivPointer,
              )}
              ref={setCanvasDiv}
              onWheel={onWheel}
              onMouseMove={onMouseMove}
              onMouseOut={onMouseOut}
              onClick={handleCanvasClick}
              onDoubleClick={onResetView}
            />
            <VerticalBars
              coordinator={coordinator}
              hoverComponentId={subscriberId}
              xAxisIsPlaybackTime={xAxisMode === "timestamp" && plotMode === "time"}
            />
            <DeltaMarkerBars
              coordinator={coordinator}
              active={deltaMeasureMode.active}
              markerA={deltaMeasureMode.markerA}
              markerB={deltaMeasureMode.markerB}
              colorsByDatasetIndex={colorsByDatasetIndex}
              deltaRowLabel={t("delta")}
              xColumnLabel={
                plotMode === "fft"
                  ? t("frequencyHz")
                  : plotMode === "histogram"
                    ? t("value")
                    : xAxisMode === "timestamp"
                      ? t("timestamp")
                      : t("xAxis")
              }
              yColumnLabel={t("yAxis")}
              markerALabel={t("markerA")}
              markerBLabel={t("markerB")}
              onRemoveMarkerA={deltaMeasureMode.removeMarkerA}
              onRemoveMarkerB={deltaMeasureMode.removeMarkerB}
            >
              {rangeStats && rangeStats.length > 0 && (
                <RangeStatsTable
                  stats={rangeStats}
                  labelsByConfigIndex={labelsByDatasetIndex}
                  colorsByConfigIndex={colorsByDatasetIndex}
                />
              )}
            </DeltaMarkerBars>
            {boxZoomActive && (
              <BoxZoomOverlay
                onZoom={handleBoxZoom}
                onWheel={onWheel}
                onDoubleClick={onResetView}
              />
            )}
          </div>
        </Tooltip>
        <PanelContextMenu getItems={getPanelContextMenuItems} />
      </Stack>
      <KeyListener global keyDownHandlers={mergedKeyDownHandlers} keyUpHandlers={keyUpHandlers} />
    </Stack>
  );
};

export default Plot;
