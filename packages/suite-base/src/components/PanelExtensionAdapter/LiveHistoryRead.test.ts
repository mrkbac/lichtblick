// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";

import { LiveHistoryRead, takeLive } from "./LiveHistoryRead";

const at = (...secs: number[]): MessageEvent[] =>
  secs.map((sec) => ({
    topic: "t",
    schemaName: "s",
    receiveTime: { sec, nsec: 0 },
    message: sec,
    sizeInBytes: 0,
  }));
const secs = (messages: readonly MessageEvent[]) => messages.map((m) => m.receiveTime.sec);

describe("LiveHistoryRead", () => {
  it("uses every message once: the history, then frames after it, then live frames", () => {
    const read = new LiveHistoryRead();
    // The history was taken up to 5; frames 4 and 5 were delivered before the panel rendered them,
    // 6 and 7 arrive while the history is read
    read.read(at(1, 2, 3));
    const early = read.live(at(4, 5));
    read.read(at(4, 5));
    const during = read.live(at(6, 7));
    const after = read.end();
    const later = read.live(at(8));
    const used = [1, 2, 3, 4, 5, ...secs(early), ...secs(during), ...secs(after), ...secs(later)];
    expect(used).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("passes every waiting frame on when the history was empty", () => {
    const read = new LiveHistoryRead();
    expect(read.live(at(1, 2))).toEqual([]);
    expect(secs(read.end())).toEqual([1, 2]);
  });

  it("holds back only the frames of topics whose history is being read", () => {
    const read = new LiveHistoryRead();
    const other = { ...at(3)[0]!, topic: "other" };
    expect(takeLive([...at(3), other], new Map([["t", read]]))).toEqual([other]);
    expect(secs(read.end())).toEqual([3]);
  });
});
