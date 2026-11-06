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
  it("keeps delta frames and drops everything before a keyframe", () => {
    const queue: Immutable<MessageEvent>[] = [];
    const [d1, d2, key, d3] = [frame(DELTA), frame(DELTA), frame(KEY), frame(DELTA)];
    enqueueVideoFrame(queue, d1);
    enqueueVideoFrame(queue, d2);
    expect(queue).toEqual([d1, d2]);
    enqueueVideoFrame(queue, key);
    enqueueVideoFrame(queue, d3);
    expect(queue).toEqual([key, d3]);
  });
});
