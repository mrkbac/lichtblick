// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec } from "@lichtblick/rostime";
import { MessageEvent } from "@lichtblick/suite";
import { BlockCache } from "@lichtblick/suite-base/players/types";

import {
  ThumbnailCache,
  findCachedMessage,
  previewableTopics,
  requestThumbnail,
  resolvePreviewTopic,
  timeBucket,
} from "./scrubPreview";

const bitmap = () => ({ close: jest.fn(), width: 1, height: 1 }) as unknown as ImageBitmap;
const closeOf = (b: ImageBitmap) => (b as unknown as { close: jest.Mock }).close;

const msg = (topic: string, seconds: number): MessageEvent => ({
  topic,
  schemaName: "sensor_msgs/Image",
  receiveTime: fromSec(seconds),
  message: {},
  sizeInBytes: 0,
});

describe("previewableTopics / resolvePreviewTopic", () => {
  const topics = previewableTopics([
    { name: "/z/cam", schemaName: "foxglove.CompressedImage" },
    { name: "/a/cam", schemaName: "sensor_msgs/msg/Image" },
    { name: "/tf", schemaName: "tf2_msgs/TFMessage" },
    { name: "/video", schemaName: "foxglove.CompressedVideo" },
  ]);

  it("keeps raw and compressed image topics, sorted by name", () => {
    expect(topics).toEqual(["/a/cam", "/z/cam"]);
  });

  it("defaults to the first topic, honours a valid choice, and supports off", () => {
    expect(resolvePreviewTopic(undefined, topics)).toBe("/a/cam");
    expect(resolvePreviewTopic("/z/cam", topics)).toBe("/z/cam");
    expect(resolvePreviewTopic("/missing", topics)).toBe("/a/cam");
    expect(resolvePreviewTopic("", topics)).toBeUndefined();
    expect(resolvePreviewTopic(undefined, [])).toBeUndefined();
  });
});

describe("timeBucket", () => {
  const start = { sec: 10, nsec: 0 };
  const end = { sec: 20, nsec: 0 };

  it("maps times to clamped buckets", () => {
    expect(timeBucket(start, start, end, 10)).toBe(0);
    expect(timeBucket({ sec: 15, nsec: 0 }, start, end, 10)).toBe(5);
    expect(timeBucket({ sec: 15, nsec: 999_999_999 }, start, end, 10)).toBe(5);
    expect(timeBucket(end, start, end, 10)).toBe(9);
    expect(timeBucket({ sec: 5, nsec: 0 }, start, end, 10)).toBe(0);
    expect(timeBucket(start, start, start, 10)).toBe(0);
  });
});

describe("findCachedMessage", () => {
  const end = { sec: 4, nsec: 0 };
  const cache: BlockCache = {
    startTime: { sec: 0, nsec: 0 },
    blocks: [
      { messagesByTopic: { "/cam": [msg("/cam", 0.5)] }, sizeInBytes: 0 },
      { messagesByTopic: { "/cam": [] }, sizeInBytes: 0 },
      { messagesByTopic: { "/cam": [msg("/cam", 2.2), msg("/cam", 2.8)] }, sizeInBytes: 0 },
      undefined,
    ],
  };

  it("returns the latest message at or before the time", () => {
    expect(
      findCachedMessage(cache, end, "/cam", { sec: 2, nsec: 500_000_000 })?.receiveTime,
    ).toEqual(fromSec(2.2));
  });

  it("walks back through earlier blocks", () => {
    expect(
      findCachedMessage(cache, end, "/cam", { sec: 1, nsec: 500_000_000 })?.receiveTime,
    ).toEqual(fromSec(0.5));
  });

  it("gives up when the needed block or topic isn't loaded", () => {
    expect(findCachedMessage(cache, end, "/cam", { sec: 3, nsec: 500_000_000 })).toBeUndefined();
    expect(findCachedMessage(cache, end, "/other", { sec: 2, nsec: 0 })).toBeUndefined();
    expect(findCachedMessage(undefined, end, "/cam", { sec: 2, nsec: 0 })).toBeUndefined();
  });
});

describe("ThumbnailCache", () => {
  it("evicts the least recently used entry and closes its bitmap", () => {
    const cache = new ThumbnailCache(2);
    const [a, b, c] = [bitmap(), bitmap(), bitmap()];
    cache.set(1, a);
    cache.set(2, b);
    cache.get(1); // 1 is now most recent
    cache.set(3, c);
    expect(cache.has(2)).toBe(false);
    expect(closeOf(b)).toHaveBeenCalled();
    expect(cache.get(1)).toBe(a);
    expect(closeOf(a)).not.toHaveBeenCalled();
  });

  it("caches misses and closes everything on clear", () => {
    const cache = new ThumbnailCache(2);
    const a = bitmap();
    cache.set(1, undefined);
    cache.set(2, a);
    expect(cache.has(1)).toBe(true);
    cache.clear();
    expect(cache.has(1)).toBe(false);
    expect(closeOf(a)).toHaveBeenCalled();
  });
});

describe("requestThumbnail", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("answers from cache synchronously without loading", () => {
    const cache = new ThumbnailCache();
    const a = bitmap();
    cache.set(1, a);
    const load = jest.fn();
    const onResult = jest.fn();
    requestThumbnail({ key: 1, cache, delayMs: 50, load, onResult });
    expect(onResult).toHaveBeenCalledWith(a);
    expect(load).not.toHaveBeenCalled();
  });

  it("debounces, then caches and reports the result", async () => {
    const cache = new ThumbnailCache();
    const a = bitmap();
    const load = jest.fn().mockResolvedValue(a);
    const onResult = jest.fn();
    requestThumbnail({ key: 1, cache, delayMs: 50, load, onResult });
    expect(load).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(50);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(a);
    expect(cache.get(1)).toBe(a);
  });

  it("cancelling before the debounce skips the load", async () => {
    const load = jest.fn();
    const cancel = requestThumbnail({
      key: 1,
      cache: new ThumbnailCache(),
      delayMs: 50,
      load,
      onResult: jest.fn(),
    });
    cancel();
    await jest.advanceTimersByTimeAsync(100);
    expect(load).not.toHaveBeenCalled();
  });

  it("cancelling an in-flight load aborts it and drops the stale bitmap", async () => {
    const cache = new ThumbnailCache();
    const a = bitmap();
    let signal: AbortSignal | undefined;
    let resolve: (b: ImageBitmap) => void = () => {};
    const load = jest.fn(async (s: AbortSignal) => {
      signal = s;
      return await new Promise<ImageBitmap>((r) => {
        resolve = r;
      });
    });
    const onResult = jest.fn();
    const cancel = requestThumbnail({ key: 1, cache, delayMs: 0, load, onResult });
    await jest.advanceTimersByTimeAsync(0);
    cancel();
    expect(signal?.aborted).toBe(true);
    resolve(a);
    await jest.advanceTimersByTimeAsync(0);
    expect(onResult).not.toHaveBeenCalled();
    expect(closeOf(a)).toHaveBeenCalled();
    expect(cache.has(1)).toBe(false);
  });

  it("remembers failures as misses", async () => {
    const cache = new ThumbnailCache();
    const onResult = jest.fn();
    requestThumbnail({
      key: 1,
      cache,
      delayMs: 0,
      load: async () => await Promise.reject(new Error("bad image")),
      onResult,
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(undefined);
    expect(cache.has(1)).toBe(true);
  });
});
