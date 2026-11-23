// SPDX-License-Identifier: MPL-2.0

import { compare, type Time } from "@foxglove/rostime";

import { type McapIndexedReader } from "@lichtblick/mcap-core";
import { parseChannel } from "@lichtblick/mcap-support";
import { addFoxgloveSchema } from "@lichtblick/suite-base/util/foxgloveSchemas";

import { CatalogSummary } from "./types";

const EVENT_SCHEMAS = addFoxgloveSchema(new Set<string>(), "foxglove.Event");
const MAX_EVENTS = 1000;

function isTime(value: Time | undefined): value is Time {
  return (
    value != undefined &&
    Number.isSafeInteger(value.sec) &&
    Number.isInteger(value.nsec) &&
    value.nsec >= 0 &&
    value.nsec < 1e9
  );
}

export async function readCatalogEvents(
  reader: McapIndexedReader,
): Promise<Pick<CatalogSummary, "events" | "eventsTruncated">> {
  const decoders = new Map<number, ReturnType<typeof parseChannel>["deserialize"]>();
  const topics = new Set<string>();
  for (const channel of reader.channelsById.values()) {
    const schema = reader.schemasById.get(channel.schemaId);
    if (schema && EVENT_SCHEMAS.has(schema.name)) {
      decoders.set(
        channel.id,
        parseChannel({ messageEncoding: channel.messageEncoding, schema }).deserialize,
      );
      topics.add(channel.topic);
    }
  }
  if (topics.size === 0) {
    return {};
  }

  const events: NonNullable<CatalogSummary["events"]> = [];
  let inspected = 0;
  for await (const message of reader.readMessages({ topics: [...topics] })) {
    const decode = decoders.get(message.channelId);
    if (!decode) {
      continue;
    }
    if (inspected++ >= MAX_EVENTS) {
      return { events, eventsTruncated: true };
    }
    const decoded = decode(message.data) as
      | {
          start_time?: Time;
          end_time?: Time;
          metadata?: ({ key?: string; value?: string } | undefined)[];
        }
      | undefined;
    if (!isTime(decoded?.start_time)) {
      continue;
    }
    const name = Array.isArray(decoded.metadata)
      ? decoded.metadata.find(
          (entry) => entry?.key === "name" && typeof entry.value === "string" && entry.value !== "",
        )?.value
      : undefined;
    events.push({
      name: name ?? reader.channelsById.get(message.channelId)!.topic,
      start: decoded.start_time,
      end:
        isTime(decoded.end_time) && compare(decoded.end_time, decoded.start_time) >= 0
          ? decoded.end_time
          : undefined,
    });
  }
  return { events };
}
