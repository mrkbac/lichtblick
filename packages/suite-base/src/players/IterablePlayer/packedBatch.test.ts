// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { IteratorResult } from "./IIterableSource";
import { packBatch, unpackBatch } from "./packedBatch";

describe("packBatch", () => {
  it("round-trips a mixed batch in order through structured clone", () => {
    const shared = new ArrayBuffer(8);
    const batch: IteratorResult[] = [
      { type: "stamp", stamp: { sec: 1, nsec: 0 } },
      {
        type: "message-event",
        msgEvent: {
          topic: "/a",
          schemaName: "A",
          receiveTime: { sec: 1, nsec: 5 },
          publishTime: { sec: 1, nsec: 4 },
          message: new Uint8Array(shared, 0, 4),
          sizeInBytes: 4,
        },
      },
      {
        type: "message-event",
        msgEvent: {
          topic: "/a",
          schemaName: "A",
          receiveTime: { sec: 2, nsec: 0 },
          publishTime: undefined,
          message: new Uint8Array(shared, 4, 4),
          sizeInBytes: 4,
        },
      },
      // Same topic under another schema (e.g. merged files) keeps its own schema name
      {
        type: "message-event",
        msgEvent: {
          topic: "/a",
          schemaName: "B",
          receiveTime: { sec: 3, nsec: 0 },
          publishTime: { sec: 3, nsec: 0 },
          message: { decoded: true },
          sizeInBytes: 10,
        },
      },
      // Fields packing does not carry go through unchanged
      {
        type: "message-event",
        msgEvent: {
          topic: "/b",
          schemaName: "B",
          receiveTime: { sec: 4, nsec: 0 },
          message: { x: 1 },
          sizeInBytes: 1,
          topicConfig: { a: 1 },
        },
      },
      { type: "alert", connectionId: 1, alert: { severity: "warn", message: "w" } },
    ];
    const expected = structuredClone(batch);

    const { packed, transfer } = packBatch(batch);
    // The shared buffer is listed once, else postMessage throws
    expect(transfer.filter((t) => t === shared)).toHaveLength(1);
    const received = structuredClone(packed, { transfer });

    expect(shared.byteLength).toBe(0);
    expect(unpackBatch(received)).toEqual(expected);
  });

  it("packs an empty batch", () => {
    const { packed } = packBatch([]);
    expect(unpackBatch(packed)).toEqual([]);
  });
});
