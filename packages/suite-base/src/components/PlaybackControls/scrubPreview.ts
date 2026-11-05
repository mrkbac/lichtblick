// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, subtract, Time, toSec } from "@foxglove/rostime";

import { Immutable, MessageEvent } from "@lichtblick/suite";
import { BlockCache } from "@lichtblick/suite-base/players/types";

import * as foxglove from "../../panels/ThreeDeeRender/foxglove";
import * as ros from "../../panels/ThreeDeeRender/ros";

export const RAW_IMAGE_SCHEMAS = new Set([...ros.IMAGE_DATATYPES, ...foxglove.RAW_IMAGE_DATATYPES]);
export const COMPRESSED_IMAGE_SCHEMAS = new Set([
  ...ros.COMPRESSED_IMAGE_DATATYPES,
  ...foxglove.COMPRESSED_IMAGE_DATATYPES,
]);

/** Display width of the thumbnail in CSS pixels. */
export const THUMBNAIL_WIDTH = 192;

/** Stored setting meaning "preview off" (an empty string reads back as unset). */
export const PREVIEW_TOPIC_OFF = "__off__";

/** Number of time buckets across the recording; hovers within one bucket share a thumbnail. */
export const BUCKET_COUNT = 500;

/** Topics the scrub preview can show, sorted by name. */
export function previewableTopics(
  topics: readonly { name: string; schemaName?: string }[],
): string[] {
  return topics
    .filter(
      ({ schemaName }) =>
        schemaName != undefined &&
        (RAW_IMAGE_SCHEMAS.has(schemaName) || COMPRESSED_IMAGE_SCHEMAS.has(schemaName)),
    )
    .map(({ name }) => name)
    .sort();
}

/**
 * Resolve the preview topic from the user's setting.
 * `undefined` setting = auto (first image topic), `PREVIEW_TOPIC_OFF` = off, otherwise that topic if present.
 */
export function resolvePreviewTopic(
  setting: string | undefined,
  imageTopics: readonly string[],
): string | undefined {
  if (setting === PREVIEW_TOPIC_OFF) {
    return undefined;
  }
  if (setting != undefined && imageTopics.includes(setting)) {
    return setting;
  }
  return imageTopics[0];
}

export function timeBucket(stamp: Time, start: Time, end: Time, count = BUCKET_COUNT): number {
  const duration = toSec(subtract(end, start));
  if (duration <= 0) {
    return 0;
  }
  const fraction = toSec(subtract(stamp, start)) / duration;
  return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
}

/**
 * Find the latest message on `topic` at or before `time` in the preloaded block cache.
 * Returns `undefined` when the cache can't answer (topic not fully loaded for the blocks needed),
 * in which case the caller should fall back to the player's backfill.
 */
export function findCachedMessage(
  cache: Immutable<BlockCache> | undefined,
  endTime: Time,
  topic: string,
  time: Time,
): Immutable<MessageEvent> | undefined {
  if (!cache || cache.blocks.length === 0) {
    return undefined;
  }
  let idx = timeBucket(time, cache.startTime, endTime, cache.blocks.length);
  for (; idx >= 0; idx--) {
    const block = cache.blocks[idx];
    const messages = block?.messagesByTopic[topic];
    if (!block || !messages || block.needTopics?.has(topic) === true) {
      return undefined;
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (compare(messages[i]!.receiveTime, time) <= 0) {
        return messages[i];
      }
    }
  }
  return undefined;
}

/** Bounded LRU of decoded thumbnails; evicted bitmaps are closed to free GPU/CPU memory. */
export class ThumbnailCache {
  #map = new Map<number, ImageBitmap | undefined>();

  public constructor(private readonly capacity = 100) {}

  public has(key: number): boolean {
    return this.#map.has(key);
  }

  public get(key: number): ImageBitmap | undefined {
    const value = this.#map.get(key);
    if (this.#map.has(key)) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  /** `undefined` caches a miss (no image at that time) so it isn't fetched again. */
  public set(key: number, value: ImageBitmap | undefined): void {
    const old = this.#map.get(key);
    if (old !== value) {
      old?.close();
    }
    this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.capacity) {
      const [oldestKey, oldest] = this.#map.entries().next().value!;
      oldest?.close();
      this.#map.delete(oldestKey);
    }
  }

  public clear(): void {
    for (const bitmap of this.#map.values()) {
      bitmap?.close();
    }
    this.#map.clear();
  }
}

/**
 * Show the thumbnail for `key`: from cache immediately, otherwise load it after `delayMs`
 * (debounce). Returns a cancel function that drops the pending timer and aborts the load, so only
 * the latest hover ever produces a result.
 */
export function requestThumbnail({
  key,
  cache,
  delayMs,
  load,
  onResult,
}: {
  key: number;
  cache: ThumbnailCache;
  delayMs: number;
  load: (signal: AbortSignal) => Promise<ImageBitmap | undefined>;
  onResult: (bitmap: ImageBitmap | undefined) => void;
}): () => void {
  if (cache.has(key)) {
    onResult(cache.get(key));
    return () => {};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    load(controller.signal).then(
      (bitmap) => {
        if (controller.signal.aborted) {
          bitmap?.close();
          return;
        }
        cache.set(key, bitmap);
        onResult(bitmap);
      },
      () => {
        // Undecodable or failed read: remember the miss unless we were just cancelled.
        if (!controller.signal.aborted) {
          cache.set(key, undefined);
          onResult(undefined);
        }
      },
    );
  }, delayMs);
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}
