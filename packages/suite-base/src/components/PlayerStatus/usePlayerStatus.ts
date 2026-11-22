// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useCallback } from "react";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { PlayerAlert, PlayerPresence } from "@lichtblick/suite-base/players/types";

/**
 * What the data source is doing, from the user's point of view:
 * - none: no data source is open
 * - connecting / opening: a live connection or a recording is starting
 * - loading: the first data is still on its way (e.g. a remote file's first read)
 * - reconnecting: a live connection dropped or never came up; the player retries on its own
 * - failed: the data source could not be opened
 * - live / ready: data is flowing (live connection) or the recording is open
 */
export type PlayerStatusKind =
  | "none"
  | "connecting"
  | "opening"
  | "loading"
  | "reconnecting"
  | "failed"
  | "live"
  | "ready";

export type PlayerStatus = {
  kind: PlayerStatusKind;
  /** Short source name: a file name, or the host and port of a connection. */
  name?: string;
  /** The first error alert, which explains a failed or reconnecting source. */
  error?: PlayerAlert;
  /** False until the source has a current time: still loading, or never connected. */
  hasData: boolean;
};

const selectPresence = (ctx: MessagePipelineContext) => ctx.playerState.presence;
const selectName = (ctx: MessagePipelineContext) => ctx.playerState.name;
const selectIsLive = (ctx: MessagePipelineContext) => ctx.seekPlayback == undefined;
const selectHasData = (ctx: MessagePipelineContext) => ctx.playerState.activeData != undefined;
const selectError = (ctx: MessagePipelineContext) =>
  ctx.playerState.alerts?.find((alert) => alert.severity === "error");

/** "https://host/dir/run%201.mcap" → "run 1.mcap", "ws://robot:8765" → "robot:8765". */
export function shortSourceName(playerName: string | undefined): string | undefined {
  const firstLine = playerName?.split("\n")[0];
  if (firstLine == undefined) {
    return undefined;
  }
  try {
    const url = new URL(firstLine);
    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment != undefined ? decodeURIComponent(lastSegment) : url.host || firstLine;
  } catch {
    return firstLine;
  }
}

export function usePlayerStatus(): PlayerStatus {
  const presence = useMessagePipeline(selectPresence);
  const fullName = useMessagePipeline(selectName);
  const isLive = useMessagePipeline(selectIsLive);
  const hasData = useMessagePipeline(selectHasData);
  const error = useMessagePipeline(selectError);

  const name = shortSourceName(fullName);
  switch (presence) {
    case PlayerPresence.NOT_PRESENT:
      return { kind: "none", hasData };
    case PlayerPresence.INITIALIZING:
      return { kind: isLive ? "connecting" : "opening", name, hasData };
    case PlayerPresence.RECONNECTING:
      return { kind: "reconnecting", name, error, hasData };
    case PlayerPresence.ERROR:
      return { kind: "failed", name, error, hasData };
    case PlayerPresence.BUFFERING:
    case PlayerPresence.PRESENT:
      // A recording has no current time until its first read is done
      if (!isLive && !hasData) {
        return { kind: "loading", name, hasData };
      }
      break;
  }
  return { kind: isLive ? "live" : "ready", name, error, hasData };
}

/** Reopens the current data source; undefined when there is none to reopen. */
export function useRetrySource(): (() => void) | undefined {
  const { recentSources, selectRecent } = usePlayerSelection();
  const currentId = recentSources.find((source) => source.current === true)?.id;
  const retry = useCallback(() => {
    if (currentId != undefined) {
      selectRecent(currentId);
    }
  }, [currentId, selectRecent]);
  return currentId != undefined ? retry : undefined;
}
