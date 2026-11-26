// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { add as addTimes, fromSec } from "@foxglove/rostime";
import { Typography, alpha, useTheme } from "@mui/material";
import { AnnotationOptions } from "chartjs-plugin-annotation";
import * as _ from "lodash-es";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounce } from "use-debounce";

import { parseMessagePath } from "@lichtblick/message-path";
import { OnClickArg as OnChartClickArgs } from "@lichtblick/suite-base/components/Chart";
import {
  configuredFocus,
  useComparedPaths,
} from "@lichtblick/suite-base/components/Compare/comparedPaths";
import { PanelVisibleContext } from "@lichtblick/suite-base/components/DockPanelContext";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { usePathSampleHistory } from "@lichtblick/suite-base/components/MessagePathSyntax/usePathSampleHistory";
import {
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { selectPlayerPresence } from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import Panel from "@lichtblick/suite-base/components/Panel";
import { PanelIconButton } from "@lichtblick/suite-base/components/PanelButton";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import TimeBasedChart from "@lichtblick/suite-base/components/TimeBasedChart";
import { PathLegend } from "@lichtblick/suite-base/panels/StateTransitions/PathLegend";
import { useStateTransitionsStyles } from "@lichtblick/suite-base/panels/StateTransitions/StateTransitions.style";
import { parseCondition } from "@lichtblick/suite-base/panels/StateTransitions/condition";
import {
  EMPTY_ITEMS_BY_PATH,
  MAX_SAMPLES_PER_PATH,
  LIVE_REDRAW_MS,
  EMPTY_PATHS,
  EMPTY_TOPICS,
  STATE_TRANSITION_PLUGINS,
} from "@lichtblick/suite-base/panels/StateTransitions/constants";
import { PX_PER_Y_UNIT } from "@lichtblick/suite-base/panels/StateTransitions/hooks/constants";
import useChartScalesAndBounds from "@lichtblick/suite-base/panels/StateTransitions/hooks/useChartScalesAndBounds";
import { useDecodedMessageRange } from "@lichtblick/suite-base/panels/StateTransitions/hooks/useDecodedMessageRange";
import { usePanelSettings } from "@lichtblick/suite-base/panels/StateTransitions/hooks/usePanelSettings";
import useStateTransitionsData from "@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsData";
import useStateTransitionsDeltaMode from "@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsDeltaMode";
import useStateTransitionsTime from "@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsTime";
import { STATE_TRANSITIONS_SHORTCUTS } from "@lichtblick/suite-base/panels/StateTransitions/shortcuts";
import { DeltaOverlay } from "@lichtblick/suite-base/panels/shared/DeltaOverlay";
import { computeDeltaDisplay } from "@lichtblick/suite-base/panels/shared/deltaMarkers";
import { createMeasureModeEscapeHandler } from "@lichtblick/suite-base/panels/shared/measureModeEscapeHandler";
import { addPathsDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import useAppendOnlyKey from "@lichtblick/suite-base/panels/shared/useAppendOnlyKey";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { STATE_TRANSITIONS_BUTTONS } from "./buttons";
import { defaultConfig } from "./settings";
import { StateTransitionPanelProps } from "./types";

const MATCH_EPSILON = 1e-6;
const X_AXIS_HEIGHT_PX = 30;

// Compared recordings get a row each, named by their topic (`/a/…`, `/b/…`)
const sameStyle = () => ({});

/** Mounted StateTransitions panels that have a condition, for scoping the match shortcuts */
const conditionPanels = new Set<symbol>();

function StateTransitions(props: StateTransitionPanelProps) {
  const { config, saveConfig } = useComparedPaths(
    "StateTransitions",
    props.config,
    props.saveConfig,
    sameStyle,
  );
  const { paths } = config;
  const { classes } = useStateTransitionsStyles();
  const theme = useTheme();
  const { t } = useTranslation("stateTransitions");
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const isPlayerPresent =
    playerPresence === PlayerPresence.PRESENT || playerPresence === PlayerPresence.BUFFERING;

  const [focusedPath, setFocusedPath] = useState<undefined | string[]>(undefined);

  const { setMessagePathDropConfig } = usePanelContext();
  useEffect(() => {
    setMessagePathDropConfig(
      addPathsDrop((added) => {
        saveConfig((prevConfig) => ({ ...prevConfig, paths: [...prevConfig.paths, ...added] }));
      }),
    );
  }, [saveConfig, setMessagePathDropConfig]);

  const { startTime, currentTimeSinceStart, endTimeSinceStart } = useStateTransitionsTime();

  const { topics, pathStrings } = useMemo(() => {
    const newPathStrings = paths.map(({ value }) => value);
    const uniqueTopics = new Set<string>();

    for (const pathString of newPathStrings) {
      const parsed = parseMessagePath(pathString);
      if (parsed) {
        uniqueTopics.add(parsed.topicName);
      }
    }

    return {
      topics: [...uniqueTopics],
      pathStrings: newPathStrings,
    };
  }, [paths]);

  // Series with a condition need exact matches even once their samples are thinned.
  const changesPaths = useMemo(
    () => [
      ...new Set(paths.filter((path) => parseCondition(path.condition)).map((path) => path.value)),
    ],
    [paths],
  );

  const decodedMessages = useDecodedMessageRange(
    isPlayerPresent ? topics : EMPTY_TOPICS,
    isPlayerPresent ? pathStrings : EMPTY_PATHS,
    changesPaths,
  );

  // When range data is active, skip the live subscription entirely
  // to avoid wasteful current-frame processing and decoding.
  const hasRangeData = useMemo(
    () =>
      decodedMessages.some((block) =>
        pathStrings.some((pathStr) => (block[pathStr]?.size() ?? 0) > 0),
      ),
    [decodedMessages, pathStrings],
  );

  const itemsByPath = usePathSampleHistory(
    hasRangeData ? EMPTY_PATHS : pathStrings,
    MAX_SAMPLES_PER_PATH,
    changesPaths,
  );

  // Publish live chart updates at most every LIVE_REDRAW_MS instead of once per message.
  const [throttledItemsByPath] = useDebounce(itemsByPath, LIVE_REDRAW_MS, {
    maxWait: LIVE_REDRAW_MS,
  });
  const newItemsByPath = hasRangeData ? EMPTY_ITEMS_BY_PATH : throttledItemsByPath;

  const showPoints = config.showPoints === true;

  const { pathState, data, datasetPathIndexes, minY, rows, matchStarts, matchesApproximate } =
    useStateTransitionsData(
      paths,
      startTime,
      newItemsByPath,
      decodedMessages,
      showPoints,
      theme.palette.mode,
    );

  const rowsHeight = rows.reduce((sum, row) => sum + row.span, 0) * PX_PER_Y_UNIT;
  const height = Math.max(80, rowsHeight + X_AXIS_HEIGHT_PX);

  const { yScale, xScale, databounds, width, sizeRef } = useChartScalesAndBounds(
    minY,
    currentTimeSinceStart,
    endTimeSinceStart,
    config,
  );

  // Markers reference paths by index, so an existing one being edited/reordered/removed goes stale -
  // appending a brand new path shouldn't reset anything (see useAppendOnlyKey).
  const pathSignatures = useMemo(
    () =>
      paths.map(
        ({ color, value, condition, label, enabled, timestampMethod }) =>
          JSON.stringify([color, value, condition, label, enabled, timestampMethod]) ?? "",
      ),
    [paths],
  );
  const deltaModeResetKey = useAppendOnlyKey(pathSignatures);
  const deltaMode = useStateTransitionsDeltaMode({
    datasets: data.datasets,
    datasetPathIndexes,
    resetKey: deltaModeResetKey,
  });
  const { markerA, markerB } = deltaMode;

  const messagePipeline = useMessagePipelineGetter();

  const seekToSeconds = useCallback(
    (seconds: number) => {
      const {
        seekPlayback,
        playerState: { activeData: { startTime: start } = {} },
      } = messagePipeline();
      if (!seekPlayback || start == undefined) {
        return;
      }
      seekPlayback(addTimes(start, fromSec(seconds)));
    },
    [messagePipeline],
  );

  const hasCondition = paths.some((path) => parseCondition(path.condition) != undefined);
  // The epsilon absorbs float error after seeking to a match start.
  const now = currentTimeSinceStart ?? 0;
  const matchesSoFar = _.sortedLastIndex(matchStarts, now + MATCH_EPSILON);
  const previousMatch = matchStarts[_.sortedIndex(matchStarts, now - MATCH_EPSILON) - 1];
  const nextMatch = matchStarts[matchesSoFar];

  const seekToNextMatch = useCallback(() => {
    if (nextMatch != undefined) {
      seekToSeconds(nextMatch);
    }
  }, [nextMatch, seekToSeconds]);

  const seekToPreviousMatch = useCallback(() => {
    if (previousMatch != undefined) {
      seekToSeconds(previousMatch);
    }
  }, [previousMatch, seekToSeconds]);

  // With several condition panels open, N / Shift+N only seek in the hovered one
  const hovered = useRef(false);
  const panelKey = useRef(Symbol());
  useEffect(() => {
    if (!hasCondition) {
      return;
    }
    const key = panelKey.current;
    conditionPanels.add(key);
    return () => {
      conditionPanels.delete(key);
    };
  }, [hasCondition]);
  const ownsMatchKeys = useCallback(() => conditionPanels.size <= 1 || hovered.current, []);

  const panelVisible = useContext(PanelVisibleContext);
  const keyDownHandlers = useMemo(
    () =>
      shortcutKeyHandlers(STATE_TRANSITIONS_SHORTCUTS, {
        "stateTransitions.exitMeasure": createMeasureModeEscapeHandler(deltaMode),
        ...(hasCondition && {
          "stateTransitions.next": () => {
            if (!ownsMatchKeys()) {
              return false;
            }
            seekToNextMatch();
            return true;
          },
          "stateTransitions.previous": () => {
            if (!ownsMatchKeys()) {
              return false;
            }
            seekToPreviousMatch();
            return true;
          },
        }),
      }),
    [deltaMode, hasCondition, ownsMatchKeys, seekToNextMatch, seekToPreviousMatch],
  );

  const onClick = useCallback(
    ({ x: seekSeconds }: OnChartClickArgs) => {
      if (seekSeconds == undefined) {
        return;
      }

      if (deltaMode.active) {
        deltaMode.handleChartClick(seekSeconds);
        return;
      }

      seekToSeconds(seekSeconds);
    },
    [deltaMode, seekToSeconds],
  );

  const annotations = useMemo((): AnnotationOptions[] => {
    const markerAnnotation = (value: number, content: string): AnnotationOptions => ({
      type: "line",
      scaleID: "x",
      value,
      borderColor: alpha(theme.palette.error.main, 0.6),
      borderWidth: 2,
      borderDash: [6, 4],
      label: {
        display: true,
        content,
        position: "start",
        backgroundColor: alpha(theme.palette.error.main, 0.15),
        color: theme.palette.error.main,
        font: { size: 10 },
      },
    });

    return [
      ...(markerA ? [markerAnnotation(markerA.xValue, t("markerA"))] : []),
      ...(markerB ? [markerAnnotation(markerB.xValue, t("markerB"))] : []),
    ];
  }, [markerA, markerB, t, theme.palette.error.main]);

  const overlayData = useMemo(() => {
    if (!deltaMode.active) {
      return undefined;
    }

    const primaryA = markerA?.seriesValues[0];
    const primaryB = markerB?.seriesValues[0];
    const markerAColor = primaryA ? paths[primaryA.configIndex]?.color : undefined;
    const markerBColor = primaryB ? paths[primaryB.configIndex]?.color : undefined;

    return {
      xValueA: markerA?.xValue,
      xValueB: markerB?.xValue,
      yValueA: primaryA?.value,
      yValueB: primaryB?.value,
      markerAColor,
      markerBColor,
      delta: computeDeltaDisplay(markerA, markerB),
    };
  }, [deltaMode.active, markerA, markerB, paths]);

  // Settings edit the configured paths, not one per compared recording
  const configuredPathState = useMemo(
    () =>
      props.config.paths.map((path, index) => ({
        path,
        isArray: pathState.some(
          (state, expandedIndex) =>
            state.isArray &&
            configuredFocus(["paths", String(expandedIndex)], config.paths)?.[1] === String(index),
        ),
      })),
    [config.paths, pathState, props.config.paths],
  );
  usePanelSettings(
    props.config,
    props.saveConfig,
    configuredPathState,
    configuredFocus(focusedPath, config.paths),
  );

  return (
    <Stack
      flexGrow={1}
      overflow="hidden"
      style={{ zIndex: 0 }}
      onPointerEnter={() => {
        hovered.current = true;
      }}
      onPointerLeave={() => {
        hovered.current = false;
      }}
    >
      <PanelToolbar
        additionalIcons={
          <>
            {hasCondition && (
              <>
                <PanelIconButton
                  button={STATE_TRANSITIONS_BUTTONS.previousMatch}
                  onClick={seekToPreviousMatch}
                  disabled={previousMatch == undefined}
                  data-testid="state-transitions-previous-match"
                />
                <Typography
                  variant="caption"
                  data-testid="state-transitions-match-count"
                  color="textSecondary"
                  title={matchesApproximate ? t("matchesApproximate") : undefined}
                >
                  {matchesApproximate && "≈"}
                  {matchesSoFar}/{matchStarts.length}
                </Typography>
                <PanelIconButton
                  button={STATE_TRANSITIONS_BUTTONS.nextMatch}
                  onClick={seekToNextMatch}
                  disabled={nextMatch == undefined}
                  data-testid="state-transitions-next-match"
                />
              </>
            )}
            <PanelIconButton
              button={STATE_TRANSITIONS_BUTTONS.measure}
              aria-pressed={deltaMode.active}
              color={deltaMode.active ? "primary" : "default"}
              onClick={deltaMode.toggleActive}
              data-testid="state-transitions-measure-mode-toggle"
            />
          </>
        }
      />
      <Stack fullWidth fullHeight flex="auto" overflowX="hidden" overflowY="auto">
        <div className={classes.chartWrapper} ref={sizeRef}>
          <TimeBasedChart
            isSynced={config.isSynced}
            width={width ?? 0}
            height={height}
            data={data}
            dataBounds={databounds}
            resetButtonPaddingBottom={2}
            xAxes={xScale}
            yAxes={yScale}
            plugins={STATE_TRANSITION_PLUGINS}
            annotations={annotations}
            interactionMode="lastX"
            onClick={onClick}
            currentTime={currentTimeSinceStart}
          />
          <PathLegend
            paths={paths}
            rows={rows}
            setFocusedPath={setFocusedPath}
            saveConfig={saveConfig}
          />
          {overlayData && (
            <div className={classes.deltaOverlayWrapper} data-testid="delta-overlay-wrapper">
              <DeltaOverlay
                deltaRowLabel={t("delta")}
                xColumnLabel={t("labels.timestamp")}
                yColumnLabel={t("value")}
                markerALabel={t("markerA")}
                markerBLabel={t("markerB")}
                markerAColor={overlayData.markerAColor}
                markerBColor={overlayData.markerBColor}
                xValueA={overlayData.xValueA}
                xValueB={overlayData.xValueB}
                yValueA={overlayData.yValueA}
                yValueB={overlayData.yValueB}
                deltaX={overlayData.delta.deltaX}
                deltaY={overlayData.delta.deltaY}
                onRemoveMarkerA={deltaMode.removeMarkerA}
                onRemoveMarkerB={deltaMode.removeMarkerB}
              />
            </div>
          )}
        </div>
      </Stack>
      {/* A hidden panel may hold batched, outdated matches: only the visible one answers */}
      {panelVisible && <KeyListener global keyDownHandlers={keyDownHandlers} />}
    </Stack>
  );
}

export default Panel(
  Object.assign(StateTransitions, {
    panelType: "StateTransitions",
    defaultConfig,
  }),
);
