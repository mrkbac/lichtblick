// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, Time } from "@foxglove/rostime";

import Logger from "@lichtblick/log";
import { MessageEvent, Subscription } from "@lichtblick/suite";
import { CreateMessageRangeIteratorParams } from "@lichtblick/suite-base/components/PanelExtensionAdapter";

import { collateTopicSchemaConversions, convertMessage } from "./messageProcessing";

const log = Logger.getLogger(__filename);

// Target interval for batching messages: 16ms aligns with a 60Hz update rate.
export const BATCH_INTERVAL_MS = 16;

function latest(a: Time | undefined, b: Time | undefined): Time | undefined {
  return !a || (b && compare(b, a) > 0) ? b : a;
}

/**
 * Creates an async iterable that processes messages from a raw batch iterator,
 * applying conversions and batching as needed.
 */
export function createMessageRangeIterator(params: CreateMessageRangeIteratorParams): {
  iterable: AsyncIterable<MessageEvent[]>;
  cancel: () => void;
} {
  const {
    topic,
    convertTo,
    rawBatchIterator,
    sortedTopics,
    messageConverters,
    emitAlert,
    rethrowErrors = false,
    playheadFirst = false,
  } = params;

  // Create a cancellation token
  let cancelled = false;

  // Create a wrapper async iterable that converts IteratorResult to MessageEvent
  const messageEventIterable = {
    async *[Symbol.asyncIterator]() {
      // Outside the try, so messages read before an error can still be yielded
      const batchMessages: MessageEvent[] = [];
      try {
        // Create a fake subscription to get message converters for this topic
        // Include convertTo if specified to get proper conversion setup
        const subscription: Subscription = convertTo
          ? { topic, preload: true, convertTo }
          : { topic, preload: true };

        const collatedConversions = collateTopicSchemaConversions(
          [subscription],
          sortedTopics,
          messageConverters,
        );

        const { topicSchemaConverters, unconvertedSubscriptionTopics } = collatedConversions;

        let lastBatchTime = performance.now();
        // Playhead-first: the latest message of earlier batches, and the current batch's first and
        // latest message. A batch ends where history jumps back (an earlier window starts) or where
        // it goes on past what earlier batches had (a later window starts after an earlier one).
        let deliveredUntil: Time | undefined;
        let batchFirst: Time | undefined;
        let batchLast: Time | undefined;

        for await (const iterResult of rawBatchIterator) {
          // Check if cancelled before processing each iteration
          if (cancelled) {
            break;
          }

          // Only process "message-event" type results
          if (iterResult.type !== "message-event") {
            continue;
          }

          const msgEvent = iterResult.msgEvent;

          if (playheadFirst) {
            const time = msgEvent.receiveTime;
            if (
              batchFirst &&
              batchLast &&
              (compare(time, batchLast) < 0 ||
                (deliveredUntil != undefined &&
                  compare(batchFirst, deliveredUntil) < 0 &&
                  compare(time, deliveredUntil) >= 0))
            ) {
              deliveredUntil = latest(deliveredUntil, batchLast);
              batchFirst = undefined;
              if (batchMessages.length > 0) {
                yield batchMessages.splice(0);
                lastBatchTime = performance.now();
              }
            }
            batchFirst ??= time;
            batchLast = time;
          }

          // If the topic is not in unconvertedSubscriptionTopics, skip conversion
          if (unconvertedSubscriptionTopics.has(msgEvent.topic)) {
            batchMessages.push(msgEvent);
          }
          // Apply message conversion if converters exist
          if (topicSchemaConverters.size > 0) {
            convertMessage(msgEvent, topicSchemaConverters, batchMessages, undefined, {
              emitAlert,
            });
          }

          if (performance.now() - lastBatchTime > BATCH_INTERVAL_MS) {
            // Yield the batch if it has been more than 16ms since the last yield
            if (batchMessages.length > 0) {
              // splice hands the consumer its own array; clearing in place would empty it
              yield batchMessages.splice(0);
              lastBatchTime = performance.now();
              deliveredUntil = latest(deliveredUntil, batchLast);
              batchFirst = undefined;
            }
          }
        }

        // Yield any remaining messages if not cancelled
        if (!cancelled && batchMessages.length > 0) {
          yield batchMessages; // No copy needed - array will be garbage collected
        }
      } catch (err: unknown) {
        if (!cancelled) {
          log.error("Error in createMessageRangeIterator:", err);
          if (rethrowErrors) {
            if (batchMessages.length > 0) {
              yield batchMessages;
            }
            throw err;
          }
        }
      }
    },
  };

  // Return the iterable and a cancel function
  return {
    iterable: messageEventIterable,
    cancel: () => {
      cancelled = true;
      // Stops the read now, even while it waits for its next message
      rawBatchIterator.return?.().catch(() => {});
    },
  };
}
