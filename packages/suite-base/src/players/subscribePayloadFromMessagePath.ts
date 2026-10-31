// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseMessagePath } from "@lichtblick/message-path";

import { SubscriptionPreloadType, SubscribePayload } from "./types";

/**
 * Builds a SubscribePayload from a message path, requesting a specific field of the message if the
 * message path resolves to a field name.
 */
export function subscribePayloadFromMessagePath(
  path: string,
  preloadType?: SubscriptionPreloadType,
  samplingRequest?: SubscribePayload["samplingRequest"],
): undefined | SubscribePayload {
  const parsedPath = parseMessagePath(path);

  if (!parsedPath) {
    return undefined;
  }

  // A modifier before the first field (e.g. `/topic.@product(width, height)`) reads arbitrary
  // fields, so it needs the whole message.
  const firstFieldOrModifier = parsedPath.messagePath.find(
    (element) => element.type === "name" || element.type === "modifier",
  );
  const firstField = firstFieldOrModifier?.type === "name" ? firstFieldOrModifier : undefined;

  if (!firstField) {
    const payload: SubscribePayload = {
      topic: parsedPath.topicName,
      preloadType: preloadType ?? "partial",
    };
    if (samplingRequest) {
      payload.samplingRequest = samplingRequest;
    }
    return payload;
  }

  const payload: SubscribePayload = {
    topic: parsedPath.topicName,
    preloadType: preloadType ?? "partial",
    fields: [firstField.name],
  };
  if (samplingRequest) {
    payload.samplingRequest = samplingRequest;
  }
  return payload;
}
