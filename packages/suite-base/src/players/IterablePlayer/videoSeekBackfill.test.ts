/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare } from "@foxglove/rostime";

import { H265 } from "@lichtblick/den/video";
import { MessageEvent } from "@lichtblick/suite";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";

import { IteratorResult, MessageIteratorArgs } from "./IIterableSource";
import {
  MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES,
  expandVideoSeekBackfill,
  needsGopBackfill,
  messageKey,
  readVideoGopForSeekTarget,
} from "./videoSeekBackfill";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("needsGopBackfill", () => {
  it("rejects messages with the wrong schema name", () => {
    // Given
    const message = MessageEventBuilder.messageEvent({
      topic: "video",
      schemaName: "something.else",
      receiveTime: { sec: 0, nsec: 0 },
      message: { format: "h265", data: new Uint8Array([0x01]) },
      sizeInBytes: 1,
    });

    // When
    const result = needsGopBackfill(message);

    // Then
    expect(result).toBe(false);
  });

  it("accepts inter-frame-dependent video codecs (H.264 and H.265, including the 'hevc' alias)", () => {
    // H.264 belongs here too: a seek that lands on a P-frame is not decodable without the
    // preceding GOP, so backfill is required at the player/source boundary even though the
    // renderable doesn't serialize its decoder submissions for H.264 during normal playback.
    // Given
    const h264 = MessageEventBuilder.messageEvent({
      topic: "video",
      schemaName: "foxglove.CompressedVideo",
      receiveTime: { sec: 0, nsec: 0 },
      message: { format: "h264", data: new Uint8Array([0x01]) },
      sizeInBytes: 1,
    });
    const h265 = MessageEventBuilder.messageEvent({
      topic: "video",
      schemaName: "foxglove.CompressedVideo",
      receiveTime: { sec: 0, nsec: 0 },
      message: { format: "h265", data: new Uint8Array([0x01]) },
      sizeInBytes: 1,
    });
    const hevc = MessageEventBuilder.messageEvent({
      topic: "video",
      schemaName: "foxglove.CompressedVideo",
      receiveTime: { sec: 0, nsec: 0 },
      message: { format: "hevc", data: new Uint8Array([0x02]) },
      sizeInBytes: 1,
    });

    // When
    const h264Result = needsGopBackfill(h264);
    const h265Result = needsGopBackfill(h265);
    const hevcResult = needsGopBackfill(hevc);

    // Then
    expect(h264Result).toBe(true);
    expect(h265Result).toBe(true);
    expect(hevcResult).toBe(true);
  });

  it("rejects unrecognized codecs and non-Uint8Array payloads", () => {
    // Given
    const mjpeg = MessageEventBuilder.messageEvent({
      topic: "video",
      schemaName: "foxglove.CompressedVideo",
      receiveTime: { sec: 0, nsec: 0 },
      message: { format: "mjpeg", data: new Uint8Array() },
      sizeInBytes: 1,
    });
    const invalidData = MessageEventBuilder.messageEvent({
      topic: "video",
      schemaName: "foxglove.CompressedVideo",
      receiveTime: { sec: 0, nsec: 0 },
      message: { format: "h265", data: "nope" },
      sizeInBytes: 1,
    });

    // When
    const mjpegResult = needsGopBackfill(mjpeg);
    const invalidDataResult = needsGopBackfill(invalidData);

    // Then
    expect(mjpegResult).toBe(false);
    expect(invalidDataResult).toBe(false);
  });
});

describe("messageKey", () => {
  it("encodes topic and receive time", () => {
    // Given
    const message = MessageEventBuilder.messageEvent({
      topic: "/cam",
      schemaName: "foxglove.CompressedVideo",
      receiveTime: { sec: 5, nsec: 123 },
      message: { format: "h265", data: new Uint8Array([0x01]) },
      sizeInBytes: 1,
    });

    // When
    const key = messageKey(message);

    // Then
    expect(key).toBe("/cam:5:123");
  });
});

function frame(nsec: number, byte: number, format = "h265", sec = 0): MessageEvent {
  return MessageEventBuilder.messageEvent({
    topic: "video",
    schemaName: "foxglove.CompressedVideo",
    receiveTime: { sec, nsec },
    message: { format, data: new Uint8Array([byte]) },
    sizeInBytes: 1,
  });
}

/** A source over `messages` (in receive time order) that records its reads */
function fakeSource(messages: MessageEvent[]) {
  const reads: MessageIteratorArgs[] = [];
  return {
    reads,
    async *messageIterator(
      args: MessageIteratorArgs,
    ): AsyncIterableIterator<Readonly<IteratorResult>> {
      reads.push(args);
      for (const msgEvent of messages) {
        if (
          args.topics.has(msgEvent.topic) &&
          (args.start == undefined || compare(msgEvent.receiveTime, args.start) >= 0) &&
          (args.end == undefined || compare(msgEvent.receiveTime, args.end) <= 0)
        ) {
          yield { type: "message-event", msgEvent };
        }
      }
    },
  };
}

/** Keyframes are the frames whose data byte is 0xff */
function mockKeyframes(): void {
  vi.spyOn(H265, "IsKeyframe").mockImplementation((data: Uint8Array) => data[0] === 0xff);
}

describe("readVideoGopForSeekTarget", () => {
  it("returns the GOP from the closest preceding keyframe to the target in one read", async () => {
    const older = frame(5, 0xff);
    const keyframe = frame(10, 0xff);
    const delta = frame(20, 0x02);
    const target = frame(30, 0x01);
    const after = frame(40, 0x03);
    const source = fakeSource([older, keyframe, delta, target, after]);
    mockKeyframes();

    const result = await readVideoGopForSeekTarget(target, source, () => undefined);

    expect(result).toEqual([keyframe, delta, target]);
    expect(source.reads).toHaveLength(1);
    expect(source.reads[0]?.end).toEqual(target.receiveTime);
  });

  it("reads further back in growing windows until it finds a keyframe", async () => {
    const keyframe = frame(0, 0xff, "h265", 10);
    const deltas = [11, 13, 16].map((sec) => frame(0, 0x02, "h265", sec));
    const target = frame(0, 0x01, "h265", 17);
    const source = fakeSource([keyframe, ...deltas, target]);
    mockKeyframes();

    const result = await readVideoGopForSeekTarget(target, source, () => undefined);

    expect(result).toEqual([keyframe, ...deltas, target]);
    // 2s, then 4s further back, then 8s: (15, 17], (11, 15], (3, 11]
    expect(source.reads).toHaveLength(3);
    // No frame is read twice
    expect(source.reads[1]?.end).toEqual({ sec: 15, nsec: 0 });
  });

  it("returns empty when there is no keyframe before the target", async () => {
    const target = frame(30, 0x01);
    const source = fakeSource([frame(10, 0x02), target]);
    mockKeyframes();

    expect(await readVideoGopForSeekTarget(target, source, () => undefined)).toEqual([]);
  });

  it("returns empty when the topic carries a message that does not need GOP backfill", async () => {
    const target = frame(30, 0x01);
    const other = { ...frame(20, 0x02), schemaName: "other" };
    const source = fakeSource([frame(10, 0xff), other, target]);
    mockKeyframes();

    expect(await readVideoGopForSeekTarget(target, source, () => undefined)).toEqual([]);
  });

  it("returns empty when the GOP is longer than MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES", async () => {
    const deltas = Array.from({ length: MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES + 5 }, (_, i) =>
      frame(i + 1, 0x02, "h265", 1),
    );
    const target = deltas.at(-1)!;
    const source = fakeSource([frame(0, 0xff, "h265", 1), ...deltas]);
    mockKeyframes();

    expect(await readVideoGopForSeekTarget(target, source, () => undefined)).toEqual([]);
  });

  it("keeps a long run of frames when a keyframe follows it", async () => {
    const run = Array.from({ length: MAX_SEEK_BACKFILL_VIDEO_GOP_MESSAGES + 5 }, (_, i) =>
      frame(i + 1, 0x02),
    );
    const keyframe = frame(1e6, 0xff);
    const target = frame(2e6, 0x01);
    const source = fakeSource([...run, keyframe, target]);
    mockKeyframes();

    expect(await readVideoGopForSeekTarget(target, source, () => undefined)).toEqual([
      keyframe,
      target,
    ]);
  });

  it("stops when the seek is aborted", async () => {
    const target = frame(30, 0x01);
    const source = fakeSource([frame(10, 0xff), target]);
    mockKeyframes();
    const controller = new AbortController();
    controller.abort();

    expect(await readVideoGopForSeekTarget(target, source, () => controller.signal)).toEqual([]);
  });
});

describe("expandVideoSeekBackfill", () => {
  it("passes through unrecognized formats and keyframes unchanged", async () => {
    const otherFormat = frame(1, 0x01, "mjpeg");
    const keyframe = frame(2, 0xff);
    const source = fakeSource([]);
    mockKeyframes();

    const result = await expandVideoSeekBackfill([otherFormat, keyframe], source, () => undefined);

    expect(result).toEqual([otherFormat, keyframe]);
    expect(source.reads).toHaveLength(0);
  });

  it("expands a P frame with its preceding GOP and dedupes by message key", async () => {
    const keyframe = frame(10, 0xff);
    const delta = frame(20, 0x02);
    const target = frame(30, 0x01);
    const source = fakeSource([keyframe, delta, target]);
    mockKeyframes();

    const result = await expandVideoSeekBackfill([target], source, () => undefined);

    expect(result).toEqual([keyframe, delta, target]);
  });

  it("returns sorted output when expansion mixes new and original messages", async () => {
    const other = { ...frame(40, 0x01, "mjpeg"), topic: "other" };
    const keyframe = frame(5, 0xff);
    const target = frame(30, 0x01);
    const source = fakeSource([keyframe, target]);
    mockKeyframes();

    const result = await expandVideoSeekBackfill([other, target], source, () => undefined);

    expect(result.map((m) => m.receiveTime.nsec)).toEqual([5, 30, 40]);
  });
});
