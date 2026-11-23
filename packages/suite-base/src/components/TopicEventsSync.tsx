// SPDX-License-Identifier: MPL-2.0

import { compare, subtract, Time, toNanoSec, toSec } from "@foxglove/rostime";
import type { Event as FoxgloveEvent } from "@foxglove/schemas";
import { useEffect, useMemo, useState } from "react";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import {
  selectEndTime,
  selectSortedTopics,
  selectStartTime,
} from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { useSubscribeMessageRange } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import {
  DataSourceEvent,
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@lichtblick/suite-base/context/EventsContext";
import { addFoxgloveSchema } from "@lichtblick/suite-base/util/foxgloveSchemas";

export const EVENT_SCHEMAS = addFoxgloveSchema(new Set<string>(), "foxglove.Event");

const selectSetEvents = (store: EventsStore) => store.setEvents;
const selectSetEventsSupported = (store: EventsStore) => store.setEventsSupported;

type PartialEvent = Partial<Omit<FoxgloveEvent, "metadata">> & {
  metadata?: ({ key?: string; value?: string } | undefined)[];
};

/** A `foxglove.Event` message as an event of the events store. `id` is unique per message. */
export function toDataSourceEvent(
  message: PartialEvent,
  id: string,
  topic: string,
): DataSourceEvent | undefined {
  const { start_time: startTime, end_time: endTime = startTime } = message;
  if (startTime == undefined || endTime == undefined) {
    return undefined;
  }
  const metadata: Record<string, string> = { topic };
  for (const entry of message.metadata ?? []) {
    if (entry?.key != undefined) {
      metadata[entry.key] = entry.value ?? "";
    }
  }
  return {
    id,
    startTime,
    endTime,
    durationNanos: String(toNanoSec(endTime) - toNanoSec(startTime)),
    metadata,
  };
}

/** Places events on a timeline from `start` to `end`. */
export function positionEvents(
  events: readonly DataSourceEvent[],
  start: Time,
  end: Time,
): TimelinePositionedEvent[] {
  const duration = toSec(subtract(end, start));
  const position = (time: Time) => (duration > 0 ? toSec(subtract(time, start)) / duration : 0);
  return [...events]
    .sort((a, b) => compare(a.startTime, b.startTime))
    .map((event) => ({
      event,
      startPosition: position(event.startTime),
      endPosition: position(event.endTime),
      secondsSinceStart: toSec(subtract(event.startTime, start)),
    }));
}

/**
 * Loads `foxglove.Event` messages from the recording into the events store, so they show on the
 * timeline and in the Events sidebar.
 */
export function TopicEventsSync(): null {
  const topics = useMessagePipeline(selectSortedTopics);
  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const subscribeMessageRange = useSubscribeMessageRange();
  const setEvents = useEvents(selectSetEvents);
  const setEventsSupported = useEvents(selectSetEventsSupported);

  const eventTopicsKey = topics
    .filter((topic) => topic.schemaName != undefined && EVENT_SCHEMAS.has(topic.schemaName))
    .map((topic) => topic.name)
    .join("\n");
  const [eventsByTopic, setEventsByTopic] = useState<ReadonlyMap<string, DataSourceEvent[]>>(
    new Map(),
  );

  useEffect(() => {
    setEventsByTopic(new Map());
    const eventTopics = eventTopicsKey === "" ? [] : eventTopicsKey.split("\n");
    const unsubscribes = eventTopics.map((topic) =>
      subscribeMessageRange({
        topic,
        onNewRangeIterator: async (iterator) => {
          const events: DataSourceEvent[] = [];
          for await (const batch of iterator) {
            for (const messageEvent of batch) {
              const event = toDataSourceEvent(
                messageEvent.message as PartialEvent,
                `${topic}#${events.length}`,
                topic,
              );
              if (event) {
                events.push(event);
              }
            }
            setEventsByTopic((prev) => new Map(prev).set(topic, [...events]));
          }
        },
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [eventTopicsKey, subscribeMessageRange]);

  const positioned = useMemo(
    () =>
      startTime && endTime
        ? positionEvents([...eventsByTopic.values()].flat(), startTime, endTime)
        : [],
    [endTime, eventsByTopic, startTime],
  );

  useEffect(() => {
    setEventsSupported(eventTopicsKey !== "");
    setEvents({ loading: false, value: positioned });
  }, [eventTopicsKey, positioned, setEvents, setEventsSupported]);

  return null;
}
