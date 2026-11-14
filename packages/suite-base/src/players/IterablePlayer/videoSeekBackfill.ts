// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { compare, fromNanoSec, toNanoSec } from "@foxglove/rostime";

import {
  canonicalVideoCodec,
  isVideoKeyframe,
  videoCodecNeedsSeekBackfill,
} from "@lichtblick/den/video";
import { MessageEvent } from "@lichtblick/suite";
import { COMPRESSED_VIDEO_DATATYPES } from "@lichtblick/suite-base/util/foxgloveSchemas";

import { IDeserializedIterableSource } from "./IIterableSource";

export const MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES = 2000;

/** How far back the GOP search reads first; each further read goes twice as far back */
export const INITIAL_GOP_WINDOW_NS = 2_000_000_000n;

type CompressedVideoLike = {
  data?: Uint8Array;
  format?: string;
};

/** Reads the GOP; an unbuffered source, so the reads don't disturb playback */
export type GopSource = Pick<IDeserializedIterableSource, "messageIterator">;

/**
 * Returns true for a `foxglove.CompressedVideo` message whose codec can only be decoded by
 * replaying the full GOP (the keyframe and every frame after it). H.264 and H.265 both qualify:
 * a seek that lands on a P/B-frame is not decodable without the preceding keyframe and every
 * intervening delta frame, regardless of whether the renderable serializes its decoder
 * submissions at playback time. The codec decision is delegated to
 * {@link videoCodecNeedsSeekBackfill} so this stays codec-agnostic.
 */
export function needsGopBackfill(message: MessageEvent): boolean {
  if (!COMPRESSED_VIDEO_DATATYPES.has(message.schemaName)) {
    return false;
  }
  const video = message.message as CompressedVideoLike;
  return (
    video.data instanceof Uint8Array &&
    videoCodecNeedsSeekBackfill(canonicalVideoCodec(video.format ?? ""))
  );
}

/**
 * Identity used to merge the fetched GOP back into the backfill set, deduplicating the seek-target
 * frame that legitimately appears in both. Keyed on topic + receive time: within a single video
 * topic, compressed-video frames are emitted at strictly increasing, distinct receive times, so two
 * entries sharing this key are necessarily the same logical frame. (A genuine topic + exact-time
 * collision with differing content would imply a malformed stream and is not a case we support.)
 */
export function messageKey(message: MessageEvent): string {
  return `${message.topic}:${message.receiveTime.sec}:${message.receiveTime.nsec}`;
}

function isKeyframe(message: MessageEvent): boolean {
  const { data, format } = message.message as CompressedVideoLike;
  return data != undefined && isVideoKeyframe(format ?? "", data);
}

/**
 * Finds the closest keyframe at or before `targetMessage` and returns the GOP from it up to the
 * target, in receive-time order (keyframe first). Reads forward over a window before the target,
 * doubling the window back in time until a keyframe turns up: one read for a typical GOP instead
 * of one backfill round trip per frame.
 *
 * Returns an empty array if the GOP would exceed MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES, if there is
 * no keyframe before the target, if the topic carries a message that does not need GOP backfill,
 * or if the seek was aborted.
 */
export async function readVideoGopForSeekTarget(
  targetMessage: MessageEvent,
  source: GopSource,
  getAbortSignal: () => AbortSignal | undefined,
): Promise<MessageEvent[]> {
  const topics = new Map([[targetMessage.topic, { topic: targetMessage.topic }]]);
  // Frames after the current window up to the target, oldest first; none is a keyframe
  let later: MessageEvent[] = [];
  let endNs = toNanoSec(targetMessage.receiveTime);
  let windowNs = INITIAL_GOP_WINDOW_NS;

  for (;;) {
    if (getAbortSignal()?.aborted === true) {
      return [];
    }
    const startNs = endNs >= windowNs ? endNs - windowNs + 1n : 0n;
    // Frames since the window's last keyframe (or its start), dropped once too many for a GOP
    let frames: MessageEvent[] = [];
    let startsWithKeyframe = false;
    let tooLong = false;
    for await (const result of source.messageIterator({
      topics,
      start: fromNanoSec(startNs),
      end: fromNanoSec(endNs),
      consumptionType: "full",
    })) {
      if (getAbortSignal()?.aborted === true) {
        return [];
      }
      if (result.type !== "message-event") {
        continue;
      }
      const frame = result.msgEvent;
      if (!needsGopBackfill(frame)) {
        return [];
      }
      if (isKeyframe(frame)) {
        frames = [frame];
        startsWithKeyframe = true;
        tooLong = false;
      } else if (!tooLong) {
        frames.push(frame);
        if (frames.length + later.length > MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES) {
          frames = [];
          tooLong = true;
        }
      }
    }

    if (tooLong) {
      return [];
    }
    if (frames.length + later.length > MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES) {
      return [];
    }
    if (startsWithKeyframe) {
      return frames.concat(later);
    }
    later = frames.concat(later);
    if (startNs === 0n) {
      return [];
    }
    endNs = startNs - 1n;
    windowNs *= 2n;
  }
}

/**
 * For each non-keyframe in `messages` that belongs to a codec needing GOP replay, fetch the
 * preceding GOP from the source so the decoder can replay from the most recent keyframe. Messages
 * that do not need backfill (other schemas, keyframes, codecs decodable from the latest frame) are
 * passed through unchanged. Output is sorted by receive time.
 */
export async function expandVideoSeekBackfill(
  messages: MessageEvent[],
  source: GopSource,
  getAbortSignal: () => AbortSignal | undefined,
): Promise<MessageEvent[]> {
  const expandedMessages = new Map(messages.map((message) => [messageKey(message), message]));

  for (const message of messages) {
    if (!needsGopBackfill(message)) {
      continue;
    }
    if (isKeyframe(message)) {
      continue;
    }

    const gopMessages = await readVideoGopForSeekTarget(message, source, getAbortSignal);
    for (const gopMessage of gopMessages) {
      expandedMessages.set(messageKey(gopMessage), gopMessage);
    }
  }

  return Array.from(expandedMessages.values()).sort((a, b) =>
    compare(a.receiveTime, b.receiveTime),
  );
}
