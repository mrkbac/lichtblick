// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable, MessageEvent } from "@lichtblick/suite";

import { GridRenderer, MAX_QUEUED_VIDEO_FRAMES, enqueueVideoFrame } from "./GridRenderer";

const KEY = new Uint8Array([0, 0, 0, 1, 0x65, 0x88, 0x84, 0x21]); // H.264 IDR
const DELTA = new Uint8Array([0, 0, 0, 1, 0x61, 0x88, 0x84, 0x21]);

let nextSec = 0;
/** Each frame gets its own receive time, so equal-looking frames stay distinguishable. */
function frame(data: Uint8Array): Immutable<MessageEvent> {
  return {
    topic: "/video",
    schemaName: "foxglove.CompressedVideo",
    receiveTime: { sec: nextSec++, nsec: 0 },
    sizeInBytes: data.byteLength,
    message: { format: "h264", data },
  };
}

describe("enqueueVideoFrame", () => {
  it("keeps every delta frame so the decoder's reference chain stays intact", () => {
    // Given an empty queue
    const queue: Immutable<MessageEvent>[] = [];
    const [d1, d2] = [frame(DELTA), frame(DELTA)];

    // When delta frames arrive
    enqueueVideoFrame(queue, d1);
    enqueueVideoFrame(queue, d2);

    // Then all of them are queued in order
    expect(queue).toEqual([d1, d2]);
  });

  it("drops a full queue instead of growing without bound", () => {
    // Given a decoder that fell far behind on a stream without new keyframes
    const queue: Immutable<MessageEvent>[] = [frame(KEY)];
    for (let i = 1; i < MAX_QUEUED_VIDEO_FRAMES; i++) {
      expect(enqueueVideoFrame(queue, frame(DELTA))).toBe(true);
    }

    // When one more delta frame arrives
    const kept = enqueueVideoFrame(queue, frame(DELTA));

    // Then the backlog is dropped and decoding has to restart at the next keyframe
    expect(kept).toBe(false);
    expect(queue).toEqual([]);
  });

  it("drops everything queued before a keyframe", () => {
    // Given a queue with pending delta frames
    const queue = [frame(DELTA), frame(DELTA)];
    const [key, d3] = [frame(KEY), frame(DELTA)];

    // When a keyframe and another delta frame arrive
    enqueueVideoFrame(queue, key);
    enqueueVideoFrame(queue, d3);

    // Then decoding restarts at the keyframe
    expect(queue).toEqual([key, d3]);
  });

  it("queues a keyframe on an empty queue", () => {
    // Given an empty queue
    const queue: Immutable<MessageEvent>[] = [];
    const key = frame(KEY);

    // When a keyframe arrives
    enqueueVideoFrame(queue, key);

    // Then it is the only queued frame
    expect(queue).toEqual([key]);
  });

  it("detects keyframes in JSON-decoded messages whose data is a number array", () => {
    // Given a queue with a pending delta frame
    const queue = [frame(DELTA)];
    const key = { ...frame(KEY), message: { format: "h264", data: Array.from(KEY) } };

    // When a keyframe with array data arrives
    enqueueVideoFrame(queue, key);

    // Then the older frame is dropped
    expect(queue).toEqual([key]);
  });
});

describe("GridRenderer annotations", () => {
  it("skips a malformed annotation message without failing the frame", () => {
    // Given a tile drawing annotations from one topic
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = new GridRenderer(() => {}, "");
    renderer.setTopics(["/image"], new Map([["/image", ["/annotations"]]]));
    const malformed: Immutable<MessageEvent> = {
      topic: "/annotations",
      schemaName: "foxglove.ImageAnnotations",
      receiveTime: { sec: 0, nsec: 0 },
      sizeInBytes: 0,
      message: { circles: [null] },
    };

    // When a message that can't be normalized arrives, twice
    renderer.setFrame([malformed]);
    renderer.setFrame([malformed]);

    // Then the frame completes and the topic is reported once
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
