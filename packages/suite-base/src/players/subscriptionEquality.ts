// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import type { Immutable } from "@lichtblick/suite";
import type { SubscribePayload, TopicSelection } from "@lichtblick/suite-base/players/types";

/** The subscription without unset keys and with its fields in order, to compare by meaning. */
function normalize(subscription: SubscribePayload): Partial<SubscribePayload> {
  const { fields, ...rest } = _.omitBy(subscription, _.isUndefined) as SubscribePayload;
  return fields == undefined ? rest : { ...rest, fields: _.sortBy(_.uniq(fields)) };
}

/**
 * Whether two topic selections ask for the same data. Keys set to `undefined` and the order of
 * fields don't matter, so re-merged subscriptions don't look like a change.
 */
export function sameTopicSelection(a: TopicSelection, b: TopicSelection): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [topic, subscription] of a) {
    const other = b.get(topic);
    if (other == undefined || !_.isEqual(normalize(subscription), normalize(other))) {
      return false;
    }
  }
  return true;
}

/** Whether messages loaded with `loaded` hold everything `wanted` asks for. */
export function subscriptionCovers(
  loaded: Immutable<SubscribePayload> | undefined,
  wanted: Immutable<SubscribePayload>,
): boolean {
  if (loaded == undefined || loaded.topic !== wanted.topic) {
    return false;
  }
  // Whole messages hold every field; sliced ones only the fields they were loaded with.
  const loadedFields = loaded.fields;
  return (
    loadedFields == undefined ||
    (wanted.fields?.every((field) => loadedFields.includes(field)) ?? false)
  );
}
