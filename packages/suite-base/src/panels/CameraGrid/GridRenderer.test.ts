// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable, MessageEvent } from "@lichtblick/suite";

import { enqueueVideoFrame } from "./GridRenderer";

const KEY = new Uint8Array([0, 0, 0, 1, 0x65, 0x88, 0x84, 0x21]); // H.264 IDR
const DELTA = new Uint8Array([0, 0, 0, 1, 0x61, 0x88, 0x84, 0x21]);

function frame(data: Uint8Array): Immutable<MessageEvent> {
  return {
    topic: "/video",
    schemaName: "foxglove.CompressedVideo",
    receiveTime: { sec: 0, nsec: 0 },
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
});
