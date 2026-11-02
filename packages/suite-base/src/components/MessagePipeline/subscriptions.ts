// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as _ from "lodash-es";

import { Immutable } from "@lichtblick/suite";
import { applySamplingGuardToSubscription } from "@lichtblick/suite-base/players/samplingGuard";
import { InternalSubscribePayload, SubscribePayload } from "@lichtblick/suite-base/players/types";

/**
 * Create a deep equal memoized identify function. Used for stabilizing the subscription payloads we
 * send on to the player.
 *
 * Note that this has unlimited cache size so it should be managed by some containing scope.
 */
export function makeSubscriptionMemoizer(): (val: SubscribePayload) => SubscribePayload {
  // ponytail: linear scan over every distinct payload seen; fine for the handful of subscriptions per panel
  const seen: SubscribePayload[] = [];
  return (val) => {
    const existing = seen.find((item) => _.isEqual(item, val));
    if (existing) {
      return existing;
    }
    seen.push(val);
    return val;
  };
}

/**
 * Merge two SubscribePayloads, using either all of the fields or the union of
 * the specific fields requested.
 *
 * Sampling note:
 * - We keep sampling only when both payloads request the same sampling mode.
 * - Authorization is OR'ed so one trusted subscriber can authorize sampling for the merged output.
 */
function mergeSubscription(
  a: Immutable<InternalSubscribePayload>,
  b: Immutable<InternalSubscribePayload>,
): Immutable<InternalSubscribePayload> {
  const isAllFields = a.fields == undefined || b.fields == undefined;
  const fields = [
    ...new Set(
      [a, b]
        .flatMap((payload) => payload.fields ?? [])
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    ),
  ];

  const sameSamplingMode =
    a.samplingRequest?.mode != undefined && a.samplingRequest.mode === b.samplingRequest?.mode;
  const samplingRequest = sameSamplingMode ? a.samplingRequest : undefined;
  const samplingAuthorized =
    sameSamplingMode && (a.samplingAuthorized === true || b.samplingAuthorized === true)
      ? true
      : undefined;

  return {
    ...a,
    fields: fields.length > 0 && !isAllFields ? fields : undefined,
    samplingRequest,
    samplingAuthorized,
  };
}

/**
 * Merge subscriptions that subscribe to the same topic, paying attention to
 * the fields they need. This ignores `preloadType`.
 */
function denormalizeSubscriptions(
  subscriptions: Immutable<InternalSubscribePayload[]>,
): Immutable<InternalSubscribePayload[]> {
  const byTopic = Object.groupBy(subscriptions, (v) => v.topic);
  return (
    Object.values(byTopic)
      // Filter out any set of payloads that contains _only_ empty `fields`
      .filter((payloads) => !payloads!.every((v) => v.fields?.length === 0))
      // Now reduce them down to a single payload for each topic
      .map((payloads) => applySamplingGuardToSubscription(payloads!.reduce(mergeSubscription)))
  );
}

/**
 * Merges individual topic subscriptions into a set of subscriptions to send on to the player.
 *
 * If any client requests a "whole" subscription to a topic then all fields will be fetched for that
 * topic. If various clients request different slices of a topic then we request the union of all
 * requested slices.
 */
export function mergeSubscriptions(
  subscriptions: Immutable<InternalSubscribePayload[]>,
): Immutable<InternalSubscribePayload[]> {
  const expanded = subscriptions.flatMap((v): Immutable<InternalSubscribePayload>[] =>
    // a "full" subscription to all fields implies a "partial" subscription to those fields, too
    v.preloadType === "full" ? [v, { ...v, preloadType: "partial" }] : [v],
  );
  const full = expanded.filter((v) => v.preloadType === "full");
  const partial = expanded.filter((v) => v.preloadType !== "full");
  return [...denormalizeSubscriptions(full), ...denormalizeSubscriptions(partial)];
}
