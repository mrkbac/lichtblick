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

import { ChevronLeft20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { add as addTimes, fromSec } from "@foxglove/rostime";
import { Typography, alpha, useTheme } from "@mui/material";
import { AnnotationOptions } from "chartjs-plugin-annotation";
import * as _ from "lodash-es";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { parseMessagePath } from "@lichtblick/message-path";
import { OnClickArg as OnChartClickArgs } from "@lichtblick/suite-base/components/Chart";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import useMessagesByPath from "@lichtblick/suite-base/components/MessagePathSyntax/useMessagesByPath";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import TimeBasedChart from "@lichtblick/suite-base/components/TimeBasedChart";
import { PathLegend } from "@lichtblick/suite-base/panels/StateTransitions/PathLegend";
import { useStateTransitionsStyles } from "@lichtblick/suite-base/panels/StateTransitions/StateTransitions.style";
import { parseCondition } from "@lichtblick/suite-base/panels/StateTransitions/condition";
import {
  EMPTY_ITEMS_BY_PATH,
  EMPTY_PATHS,
  EMPTY_TOPICS,
  STATE_TRANSITION_PLUGINS,
} from "@lichtblick/suite-base/panels/StateTransitions/constants";
import useChartScalesAndBounds from "@lichtblick/suite-base/panels/StateTransitions/hooks/useChartScalesAndBounds";
import { useDecodedMessageRange } from "@lichtblick/suite-base/panels/StateTransitions/hooks/useDecodedMessageRange";
import useMessagePathDropConfig from "@lichtblick/suite-base/panels/StateTransitions/hooks/useMessagePathDropConfig";
import { usePanelSettings } from "@lichtblick/suite-base/panels/StateTransitions/hooks/usePanelSettings";
import useStateTransitionsData from "@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsData";
import useStateTransitionsDeltaMode from "@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsDeltaMode";
import useStateTransitionsTime from "@lichtblick/suite-base/panels/StateTransitions/hooks/useStateTransitionsTime";
import { STATE_TRANSITIONS_SHORTCUTS } from "@lichtblick/suite-base/panels/StateTransitions/shortcuts";
import { DeltaOverlay } from "@lichtblick/suite-base/panels/shared/DeltaOverlay";
import { MeasureModeToolbarButton } from "@lichtblick/suite-base/panels/shared/MeasureModeToolbarButton";
import { computeDeltaDisplay } from "@lichtblick/suite-base/panels/shared/deltaMarkers";
import { createMeasureModeEscapeHandler } from "@lichtblick/suite-base/panels/shared/measureModeEscapeHandler";
import useAppendOnlyKey from "@lichtblick/suite-base/panels/shared/useAppendOnlyKey";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { StateTransitionConfig, StateTransitionPanelProps } from "./types";

const MATCH_EPSILON = 1e-6;

const selectPlayerPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;

function StateTransitions(props: StateTransitionPanelProps) {
  const { config, saveConfig } = props;
  const { paths } = config;
  const { classes } = useStateTransitionsStyles();
  const theme = useTheme();
  const { t } = useTranslation("stateTransitions");
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const isPlayerPresent =
    playerPresence === PlayerPresence.PRESENT || playerPresence === PlayerPresence.BUFFERING;

  const [focusedPath, setFocusedPath] = useState<undefined | string[]>(undefined);

  useMessagePathDropConfig(saveConfig);

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

  const decodedMessages = useDecodedMessageRange(
    isPlayerPresent ? topics : EMPTY_TOPICS,
    isPlayerPresent ? pathStrings : EMPTY_PATHS,
  );

  // When range data is active, skip useMessagesByPath subscriptions entirely
  // to avoid wasteful current-frame processing and decoding.
  const hasRangeData = useMemo(
    () =>
      decodedMessages.some((block) =>
        pathStrings.some((pathStr) => (block[pathStr]?.length ?? 0) > 0),
      ),
    [decodedMessages, pathStrings],
  );

  const itemsByPath = useMessagesByPath(hasRangeData ? EMPTY_PATHS : pathStrings);

  const { height, heightPerTopic } = useMemo(() => {
    const onlyTopicsHeight = paths.length * 64;
    const xAxisHeight = 30;
    return {
      height: Math.max(80, onlyTopicsHeight + xAxisHeight),
      heightPerTopic: paths.length === 0 ? 0 : onlyTopicsHeight / paths.length,
    };
  }, [paths.length]);

  const newItemsByPath = hasRangeData ? EMPTY_ITEMS_BY_PATH : itemsByPath;

  const showPoints = config.showPoints === true;

  const { pathState, data, minY, matchStarts } = useStateTransitionsData(
    paths,
    startTime,
    newItemsByPath,
    decodedMessages,
    showPoints,
  );

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
  const matchesSoFar = useMemo(
    () => matchStarts.filter((x) => x <= now + MATCH_EPSILON).length,
    [now, matchStarts],
  );
  const previousMatch = _.findLast(matchStarts, (x) => x < now - MATCH_EPSILON);
  const nextMatch = matchStarts.find((x) => x > now + MATCH_EPSILON);

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

  const keyDownHandlers = useMemo(
    () =>
      shortcutKeyHandlers(STATE_TRANSITIONS_SHORTCUTS, {
        "stateTransitions.exitMeasure": createMeasureModeEscapeHandler(deltaMode),
        // ponytail: global listener, so every panel with a condition seeks on N; scope it to the
        // focused panel if several condition panels get confusing.
        ...(hasCondition && {
          "stateTransitions.next": seekToNextMatch,
          "stateTransitions.previous": seekToPreviousMatch,
        }),
      }),
    [deltaMode, hasCondition, seekToNextMatch, seekToPreviousMatch],
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

  usePanelSettings(config, saveConfig, pathState, focusedPath);

  return (
    <Stack flexGrow={1} overflow="hidden" style={{ zIndex: 0 }}>
      <MeasureModeToolbarButton
        active={deltaMode.active}
        onToggle={deltaMode.toggleActive}
        title={t("measureMode")}
        testId="state-transitions-measure-mode-toggle"
      >
        {hasCondition && (
          <>
            <ToolbarIconButton
              title={t("previousMatch")}
              aria-label={t("previousMatch")}
              onClick={seekToPreviousMatch}
              disabled={previousMatch == undefined}
              data-testid="state-transitions-previous-match"
            >
              <ChevronLeft20Regular />
            </ToolbarIconButton>
            <Typography
              variant="caption"
              data-testid="state-transitions-match-count"
              color="textSecondary"
            >
              {matchesSoFar}/{matchStarts.length}
            </Typography>
            <ToolbarIconButton
              title={t("nextMatch")}
              aria-label={t("nextMatch")}
              onClick={seekToNextMatch}
              disabled={nextMatch == undefined}
              data-testid="state-transitions-next-match"
            >
              <ChevronRight20Regular />
            </ToolbarIconButton>
          </>
        )}
      </MeasureModeToolbarButton>
      <Stack fullWidth fullHeight flex="auto" overflowX="hidden" overflowY="auto">
        <div className={classes.chartWrapper} ref={sizeRef}>
          <TimeBasedChart
            zoom
            isSynced={config.isSynced}
            showXAxisLabels
            width={width ?? 0}
            height={height}
            data={data}
            dataBounds={databounds}
            resetButtonPaddingBottom={2}
            type="scatter"
            xAxes={xScale}
            xAxisIsPlaybackTime
            yAxes={yScale}
            plugins={STATE_TRANSITION_PLUGINS}
            annotations={annotations}
            interactionMode="lastX"
            onClick={onClick}
            currentTime={currentTimeSinceStart}
          />
          <PathLegend
            paths={paths}
            heightPerTopic={heightPerTopic}
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
      <KeyListener global keyDownHandlers={keyDownHandlers} />
    </Stack>
  );
}

const defaultConfig: StateTransitionConfig = {
  paths: [],
  isSynced: true,
};

export default Panel(
  Object.assign(StateTransitions, {
    panelType: "StateTransitions",
    defaultConfig,
  }),
);
