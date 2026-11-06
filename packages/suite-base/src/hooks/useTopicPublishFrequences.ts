// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { subtract as subtractTimes, Time } from "@foxglove/rostime";
import { useEffect, useMemo, useState } from "react";

import { Immutable } from "@lichtblick/suite";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { isRecordingSource } from "@lichtblick/suite-base/players/constants";
import { TopicStats } from "@lichtblick/suite-base/players/types";
import { LiveTopicRates } from "@lichtblick/suite-base/util/LiveTopicRates";
import { calculateStaticItemFrequency } from "@lichtblick/suite-base/util/calculateStaticItemFrequency";

const EMPTY_TOPIC_STATS = new Map<string, TopicStats>();

/** How often live rates are re-evaluated when no messages arrive, so a stopped publisher drops to 0. */
const LIVE_TICK_MS = 500;

const selectCurrentTime = ({ playerState }: MessagePipelineContext) =>
  playerState.activeData?.currentTime;
const selectHasCurrentTime = (ctx: MessagePipelineContext) => selectCurrentTime(ctx) != undefined;
const selectStartTime = ({ playerState }: MessagePipelineContext) =>
  playerState.activeData?.startTime;
const selectEndTime = ({ playerState }: MessagePipelineContext) => playerState.activeData?.endTime;
const selectTopicStats = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.topicStats ?? EMPTY_TOPIC_STATS;
const selectPlayerCapabilities = (ctx: MessagePipelineContext) => ctx.playerState.capabilities;
const selectPlayerId = (ctx: MessagePipelineContext) => ctx.playerState.playerId;

type FrequenciesByTopic = Record<string, undefined | number>;
const EMPTY_FREQUENCIES: FrequenciesByTopic = {};

/**
 * Publish frequency per topic. Recordings use all messages. Live sources use a sliding window of
 * recent messages, and report 0 when a topic's publisher has gone quiet (see LiveTopicRates).
 */
export function useTopicPublishFrequencies(): Immutable<FrequenciesByTopic> {
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const topicStats = useMessagePipeline(selectTopicStats);
  const playerCapabilities = useMessagePipeline(selectPlayerCapabilities);
  const duration = useMemo(
    () => (endTime && startTime ? subtractTimes(endTime, startTime) : { sec: 0, nsec: 0 }),
    [endTime, startTime],
  );

  const playerId = useMessagePipeline(selectPlayerId);
  // Start over for a new player, so its rates don't build on the previous player's samples
  const liveRates = useMemo(() => {
    void playerId;
    return new LiveTopicRates();
  }, [playerId]);

  const playerIsStaticSource = useMemo(
    () => isRecordingSource(playerCapabilities),
    [playerCapabilities],
  );
  // Live rates must fall even when nothing arrives, so re-evaluate them periodically
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (playerIsStaticSource) {
      return;
    }
    const id = setInterval(() => {
      setTick((value) => value + 1);
    }, LIVE_TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [playerIsStaticSource]);
  // Static frequencies don't depend on the playhead, so only live sources update every tick.
  const playerCurrentTime = useMessagePipeline<Time | boolean | undefined>(
    playerIsStaticSource ? selectHasCurrentTime : selectCurrentTime,
  );

  const frequencies = useMemo(() => {
    void tick; // re-evaluates live rates while no messages arrive
    if (playerCurrentTime == undefined || playerCurrentTime === false) {
      return EMPTY_FREQUENCIES;
    }
    if (!playerIsStaticSource) {
      const result: FrequenciesByTopic = {};
      for (const [topic, rate] of liveRates.update(Date.now(), topicStats)) {
        result[topic] = rate.hz;
      }
      return result;
    }

    const result: FrequenciesByTopic = {};
    for (const [topic, stat] of topicStats) {
      // For a static source we calculate frequency across all messages.
      result[topic] = calculateStaticItemFrequency(
        stat.numMessages,
        stat.firstMessageTime,
        stat.lastMessageTime,
        duration,
      );
    }

    return result;
  }, [playerCurrentTime, duration, playerIsStaticSource, topicStats, tick, liveRates]);

  return frequencies;
}
