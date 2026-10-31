// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { MessagePath, MessagePathName } from "@lichtblick/message-path";
import type { Immutable } from "@lichtblick/suite";
import type {
  SubscribePayload,
  SubscriptionPreloadType,
} from "@lichtblick/suite-base/players/types";

export function pathToSubscribePayload(
  path: Immutable<MessagePath>,
  preloadType: SubscriptionPreloadType,
): SubscribePayload | undefined {
  const { messagePath: parts, topicName: topic } = path;

  const firstFieldOrModifier = parts.find(
    (part) => part.type === "name" || part.type === "modifier",
  );

  if (firstFieldOrModifier?.type === "modifier") {
    // A modifier before the first field (e.g. `/topic.@product(width, height)`) reads arbitrary
    // fields, so it needs the whole message.
    return { topic, preloadType };
  }

  const firstField: Immutable<MessagePathName> | undefined = firstFieldOrModifier;
  if (firstField == undefined || firstField.name.length === 0) {
    return undefined;
  }

  // Always subscribe to the header so it is available for header stamp mode
  const fields = new Set(["header", firstField.name]);

  for (const part of parts) {
    // We want to take _all_ of the filters that start the path, since these can
    // be chained
    if (part.type !== "filter") {
      break;
    }

    const { path: filterPath } = part;
    const field = filterPath[0];
    if (field == undefined) {
      continue;
    }

    fields.add(field);
  }

  return {
    topic,
    preloadType,
    fields: Array.from(fields),
  };
}
