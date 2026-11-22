// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessagePipelineContext } from "@lichtblick/suite-base/components/MessagePipeline/types";
import { Topic, TopicStats } from "@lichtblick/suite-base/players/types";

// Cache the derived map keyed on the `sortedTopics` array reference. The pipeline store only
// rebuilds `sortedTopics` (new reference) when the player's topics change, so the same map can be
// reused across pipeline updates. This keeps frequent callers (e.g. getTopicSchema during
// interactions) from rebuilding the map on every call.
const topicToSchemaNameMapCache = new WeakMap<
  readonly Topic[],
  Record<string, string | undefined>
>();

export const getTopicToSchemaNameMap = (
  state: MessagePipelineContext,
): Record<string, string | undefined> => {
  const { sortedTopics } = state;

  const cached = topicToSchemaNameMapCache.get(sortedTopics);
  if (cached) {
    return cached;
  }

  const result: Record<string, string | undefined> = {};

  for (const topic of sortedTopics) {
    result[topic.name] = topic.schemaName;
  }

  topicToSchemaNameMapCache.set(sortedTopics, result);
  return result;
};

// Shared selectors so panels and components don't each redefine the same one-liners
type Ctx = MessagePipelineContext;
type PlayerState = Ctx["playerState"];
type ActiveData = NonNullable<PlayerState["activeData"]>;
export const selectCurrentTime = (ctx: Ctx): ActiveData["currentTime"] | undefined =>
  ctx.playerState.activeData?.currentTime;
export const selectStartTime = (ctx: Ctx): ActiveData["startTime"] | undefined =>
  ctx.playerState.activeData?.startTime;
export const selectEndTime = (ctx: Ctx): ActiveData["endTime"] | undefined =>
  ctx.playerState.activeData?.endTime;
export const selectTopicStats = (ctx: Ctx): ActiveData["topicStats"] | undefined =>
  ctx.playerState.activeData?.topicStats;
// Single empty map so the selector result stays reference-equal while there is no data
const EMPTY_TOPIC_STATS = new Map<string, TopicStats>();
export const selectTopicStatsOrEmpty = (ctx: Ctx): ActiveData["topicStats"] =>
  ctx.playerState.activeData?.topicStats ?? EMPTY_TOPIC_STATS;
export const selectIsPlaying = (ctx: Ctx): boolean =>
  ctx.playerState.activeData?.isPlaying === true;
export const selectHasCurrentTime = (ctx: Ctx): boolean =>
  ctx.playerState.activeData?.currentTime != undefined;
export const selectRecordingFiles = (ctx: Ctx): ActiveData["recordingFiles"] | undefined =>
  ctx.playerState.activeData?.recordingFiles;
export const selectLastSeekTime = (ctx: Ctx): ActiveData["lastSeekTime"] | undefined =>
  ctx.playerState.activeData?.lastSeekTime;
export const selectPlayerPresence = (ctx: Ctx): PlayerState["presence"] => ctx.playerState.presence;
export const selectPlayerId = (ctx: Ctx): PlayerState["playerId"] => ctx.playerState.playerId;
export const selectPlayerName = (ctx: Ctx): PlayerState["name"] => ctx.playerState.name;
export const selectPlayerCapabilities = (ctx: Ctx): PlayerState["capabilities"] =>
  ctx.playerState.capabilities;
export const selectSeekPlayback = (ctx: Ctx): Ctx["seekPlayback"] => ctx.seekPlayback;
export const selectPausePlayback = (ctx: Ctx): Ctx["pausePlayback"] => ctx.pausePlayback;
export const selectStartPlayback = (ctx: Ctx): Ctx["startPlayback"] => ctx.startPlayback;
export const selectGetBatchIterator = (ctx: Ctx): Ctx["getBatchIterator"] => ctx.getBatchIterator;
export const selectGetMessageAtTime = (ctx: Ctx): Ctx["getMessageAtTime"] => ctx.getMessageAtTime;
export const selectInspectionIterator = (ctx: Ctx): Ctx["getInspectionIterator"] =>
  ctx.getInspectionIterator;
export const selectSortedTopics = (ctx: Ctx): Ctx["sortedTopics"] => ctx.sortedTopics;
