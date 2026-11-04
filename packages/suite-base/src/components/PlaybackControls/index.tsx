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

import {
  ArrowRepeatAll20Regular,
  Cut20Filled,
  Cut20Regular,
  ArrowRepeatAllOff20Regular,
  Info20Regular,
  Next20Filled,
  Next20Regular,
  Pause20Filled,
  Pause20Regular,
  Play20Filled,
  Play20Regular,
  Previous20Filled,
  Previous20Regular,
} from "@fluentui/react-icons";
import { Time, compare, fromNanoSec, toNanoSec } from "@foxglove/rostime";
import { Tooltip } from "@mui/material";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DataSourceInfoView } from "@lichtblick/suite-base/components/DataSourceInfoView";
import { ExportRecordingDialog } from "@lichtblick/suite-base/components/ExportRecordingDialog/ExportRecordingDialog";
import { useExportableFile } from "@lichtblick/suite-base/components/ExportRecordingDialog/exportRecording";
import {
  clampTimeToCut,
  useTrimStore,
} from "@lichtblick/suite-base/components/ExportRecordingDialog/trimStore";
import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import SyncInstanceToggle from "@lichtblick/suite-base/components/PlaybackControls/SwitchSyncInstances/SyncInstanceToggle";
import { useStyles } from "@lichtblick/suite-base/components/PlaybackControls/index.style";
import { useDirectionalSeek } from "@lichtblick/suite-base/components/PlaybackControls/useDirectionalSeek";
import PlaybackSpeedControls from "@lichtblick/suite-base/components/PlaybackSpeedControls";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  WorkspaceContextStore,
  useWorkspaceStore,
} from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { Player, PlayerPresence } from "@lichtblick/suite-base/players/types";
import BroadcastManager from "@lichtblick/suite-base/util/broadcast/BroadcastManager";

import PlaybackTimeDisplay from "./PlaybackTimeDisplay";
import { RepeatAdapter } from "./RepeatAdapter";
import Scrubber from "./Scrubber";
import { TrimBar, useTrimKeyHandlers } from "./TrimRange";

const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectPlaybackRepeat = (store: WorkspaceContextStore) => store.playbackControls.repeat;

type PlaybackControlsProps = Readonly<{
  play: NonNullable<Player["startPlayback"]>;
  pause: NonNullable<Player["pausePlayback"]>;
  seek: NonNullable<Player["seekPlayback"]>;
  playUntil?: Player["playUntil"];
  isPlaying: boolean;
  getTimeInfo: () => { startTime?: Time; endTime?: Time; currentTime?: Time };
}>;

export default function PlaybackControls({
  play,
  pause,
  seek,
  playUntil,
  isPlaying,
  getTimeInfo,
}: PlaybackControlsProps): React.JSX.Element {
  const presence = useMessagePipeline(selectPresence);
  const { t } = useTranslation("exportRecording");

  const { classes, cx } = useStyles();
  const repeat = useWorkspaceStore(selectPlaybackRepeat);
  const exportableFile = useExportableFile();
  const cutActive = useTrimStore((state) => state.start != undefined);
  const editingCut = useTrimStore((state) => state.editing);
  const startEditingCut = useTrimStore((state) => state.startEditing);
  const stopEditingCut = useTrimStore((state) => state.stopEditing);
  const clearCut = useTrimStore((state) => state.clear);
  const exportOpen = useTrimStore((state) => state.exportOpen);
  const closeExport = useTrimStore((state) => state.closeExport);
  const trimKeyHandlers = useTrimKeyHandlers();

  // A cut belongs to the file it was made on.
  useEffect(() => {
    clearCut();
  }, [exportableFile, clearCut]);

  // While a cut is set, seeking outside it lands on its nearest edge.
  const seekInCut = useCallback(
    (time: Time) => {
      seek(clampTimeToCut(time));
    },
    [seek],
  );
  const playUntilInCut = useMemo(
    () =>
      playUntil
        ? (time: Time) => {
            playUntil(clampTimeToCut(time));
          }
        : undefined,
    [playUntil],
  );
  /** Start and end of what can be played: the cut, or the whole recording. */
  const getPlayableRange = useCallback((): { start?: Time; end?: Time; current?: Time } => {
    const { startTime, endTime, currentTime } = getTimeInfo();
    const cut = useTrimStore.getState();
    return {
      start: cut.start != undefined ? fromNanoSec(cut.start) : startTime,
      end: cut.end != undefined ? fromNanoSec(cut.end) : endTime,
      current: currentTime,
    };
  }, [getTimeInfo]);

  const toggleCutEditing = useCallback(() => {
    if (editingCut) {
      stopEditingCut();
      return;
    }
    const { startTime, endTime } = getTimeInfo();
    if (startTime && endTime) {
      startEditingCut(toNanoSec(startTime), toNanoSec(endTime));
    }
  }, [editingCut, getTimeInfo, startEditingCut, stopEditingCut]);

  const {
    playbackControlActions: { setRepeat },
  } = useWorkspaceActions();

  const toggleRepeat = useCallback(() => {
    setRepeat((old) => !old);
  }, [setRepeat]);

  const togglePlayPause = useCallback(() => {
    const { start, end, current } = getPlayableRange();

    if (isPlaying) {
      pause();

      BroadcastManager.getInstance().postMessage({
        type: "pause",
        time: current!,
      });
    } else {
      // if we are at the end, we need to go back to start
      if (current && end && start && compare(current, end) >= 0) {
        seek(start);
      }
      play();

      BroadcastManager.getInstance().postMessage({
        type: "play",
        time: current!,
      });
    }
  }, [isPlaying, pause, getPlayableRange, play, seek]);

  const { seekForwardAction, seekBackwardAction } = useDirectionalSeek({
    seek: seekInCut,
    getTimeInfo,
    playUntil: playUntilInCut,
  });

  const keyDownHandlers = useMemo(
    () => ({
      " ": togglePlayPause,
      ArrowLeft: (ev: KeyboardEvent) => {
        seekBackwardAction(ev);
      },
      ArrowRight: (ev: KeyboardEvent) => {
        seekForwardAction(ev);
      },
      Home: () => {
        const { start } = getPlayableRange();
        if (start) {
          seek(start);
        }
      },
      End: () => {
        const { end } = getPlayableRange();
        if (end) {
          seek(end);
        }
      },
      ...trimKeyHandlers,
    }),
    [
      getPlayableRange,
      seek,
      seekBackwardAction,
      seekForwardAction,
      togglePlayPause,
      trimKeyHandlers,
    ],
  );

  const disableControls = presence === PlayerPresence.ERROR;

  return (
    <>
      <RepeatAdapter play={play} pause={pause} seek={seek} repeatEnabled={repeat} />
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      <div className={classes.root}>
        <div className={classes.scrubberWrapper}>
          <Scrubber onSeek={seekInCut} />
        </div>
        {exportableFile && <TrimBar />}
        <Stack direction="row" alignItems="center" flex={1} gap={1}>
          <Stack direction="row" alignItems="center" flex={1} gap={0.5}>
            <Tooltip
              // A desired workflow is the ability to copy data source info text (start, end, duration)
              // from the tooltip. However, there's a UX quirk where the tooltip will close if the user
              // clicks on the <HoverableIconButton> and then goes to copy text from the tooltip.
              //
              // Disabling the focus listener fixes this quirk and the tooltip behaves as expected.
              // https://mui.com/material-ui/api/tooltip/#prop-disableFocusListener
              disableFocusListener
              classes={{ popper: classes.popper }}
              title={
                <Stack paddingY={0.75}>
                  <DataSourceInfoView disableSource />
                </Stack>
              }
            >
              <HoverableIconButton
                className={cx(classes.dataSourceInfoButton, {
                  [classes.disabled]: disableControls,
                })}
                size="small"
                icon={<Info20Regular />}
              />
            </Tooltip>
            {exportableFile && (
              <HoverableIconButton
                size="small"
                title={editingCut ? t("hideCutHandles") : t("cutRecording")}
                color={cutActive ? "primary" : "inherit"}
                icon={editingCut ? <Cut20Filled /> : <Cut20Regular />}
                activeIcon={<Cut20Filled />}
                onClick={toggleCutEditing}
                data-testid="trim-button"
              />
            )}
            <PlaybackTimeDisplay onSeek={seekInCut} onPause={pause} />
          </Stack>
          <Stack direction="row" alignItems="center" gap={1}>
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              title="Seek backward"
              icon={<Previous20Regular />}
              activeIcon={<Previous20Filled />}
              onClick={() => {
                seekBackwardAction();
              }}
              data-testid="seek-backward-button"
            />
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              title={isPlaying ? "Pause" : "Play"}
              onClick={togglePlayPause}
              icon={isPlaying ? <Pause20Regular /> : <Play20Regular />}
              activeIcon={isPlaying ? <Pause20Filled /> : <Play20Filled />}
              data-testid="play-button"
            />
            <HoverableIconButton
              disabled={disableControls}
              size="small"
              title="Seek forward"
              icon={<Next20Regular />}
              activeIcon={<Next20Filled />}
              onClick={() => {
                seekForwardAction();
              }}
              data-testid="seek-forward-button"
            />
          </Stack>
          <Stack direction="row" flex={1} alignItems="center" justifyContent="flex-end" gap={0.5}>
            <SyncInstanceToggle />
            <HoverableIconButton
              size="small"
              title="Loop playback"
              color={repeat ? "primary" : "inherit"}
              onClick={toggleRepeat}
              icon={repeat ? <ArrowRepeatAll20Regular /> : <ArrowRepeatAllOff20Regular />}
            />
            <PlaybackSpeedControls />
          </Stack>
        </Stack>
        {exportOpen && exportableFile && (
          <ExportRecordingDialog file={exportableFile} onClose={closeExport} />
        )}
      </div>
    </>
  );
}
