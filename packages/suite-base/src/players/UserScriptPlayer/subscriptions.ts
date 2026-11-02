// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "@lichtblick/suite";
import { mergeSubscriptions } from "@lichtblick/suite-base/components/MessagePipeline/subscriptions";
import { SubscribePayload } from "@lichtblick/suite-base/players/types";

// A mapping from the subscription to the input topics needed to satisfy
// that request.
type SubscriberInputs = [SubscribePayload, readonly string[] | undefined];

/**
 * Calculates a mapping from topic name to a SubscribePayload containing the
 * minimum `preloadType` necessary to fulfill that request.
 */
export function getPreloadTypes(
  subscriptions: SubscribePayload[],
): Record<string, SubscribePayload> {
  // Consolidate subscriptions to the same topic down to a single payload and ignore `fields`
  const result: Record<string, SubscribePayload> = {};
  for (const { topic, preloadType } of subscriptions) {
    // If at least one preloadType is explicitly "full", we need "full", but default to "partial"
    result[topic] = {
      topic,
      preloadType:
        preloadType === "full" || result[topic]?.preloadType === "full" ? "full" : "partial",
    };
  }
  return result;
}

/**
 * Rewrites the provided array of subscriptions to omit subscriptions to
 * virtual topics and subscribe only to the inputs to those topics, then
 * deduplicates.
 */
export function remapVirtualSubscriptions(
  subscriptions: SubscribePayload[],
  inputsByOutputTopic: Map<string, readonly string[]>,
): Immutable<SubscribePayload[]> {
  // Pair all subscriptions with their user script input topics (if any)
  const payloadInputsPairs = subscriptions
    .map((v): SubscriberInputs => [v, inputsByOutputTopic.get(v.topic)])
    .filter(([, topics]) => topics?.length !== 0);

  return mergeSubscriptions(
    payloadInputsPairs.flatMap(([subscription, topics]): SubscribePayload[] => {
      const preloadType = subscription.preloadType ?? "partial";

      // Leave the subscription unmodified if it is not a user script topic
      if (topics == undefined) {
        return [subscription];
      }

      // Subscribe to all fields for all topics used by this user script
      // because we can't know what fields the user script actually uses
      // (for now)
      return topics.map((v) => ({
        topic: v,
        preloadType,
      }));
    }),
  );
}
