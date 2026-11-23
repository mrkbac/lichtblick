// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as Comlink from "@foxglove/comlink";
import type { Mock, Mocked } from "vitest";

import { MessageEvent } from "@lichtblick/suite";
import RosTimeBuilder from "@lichtblick/suite-base/testing/builders/RosTimeBuilder";

import { ComlinkTransferIteratorCursor } from "./ComlinkTransferIteratorCursor";
import type { IMessageCursor, IteratorResult } from "./IIterableSource";
import { PackedBatch, unpackBatch } from "./packedBatch";

vi.mock("@foxglove/comlink", () => ({
  transfer: vi.fn((value, transferables) => ({ value, transferables })),
}));

describe("ComlinkTransferIteratorCursor", () => {
  let mockCursor: Mocked<IMessageCursor<Uint8Array>>;

  beforeEach(() => {
    mockCursor = {
      nextBatch: vi.fn(),
      readUntil: vi.fn(),
      end: vi.fn(),
    };
    (Comlink.transfer as Mock).mockClear();
  });

  it("packs nextBatch() and transfers the message buffers", async () => {
    const buf1 = new Uint8Array([10]).buffer;
    const buf2 = new Uint8Array([20]).buffer;
    const msgEvent = (buffer: ArrayBuffer): MessageEvent<Uint8Array> => ({
      topic: "/a",
      schemaName: "S",
      receiveTime: { sec: 1, nsec: 2 },
      message: new Uint8Array(buffer),
      sizeInBytes: 1,
    });
    const batch: IteratorResult<Uint8Array>[] = [
      { type: "message-event", msgEvent: msgEvent(buf1) },
      { type: "message-event", msgEvent: msgEvent(buf2) },
      { type: "alert", connectionId: 2, alert: { message: "Notice", severity: "warn" } },
    ];
    mockCursor.nextBatch.mockResolvedValueOnce(batch);

    const cursor = new ComlinkTransferIteratorCursor(mockCursor);
    const result = (await cursor.nextBatch(100)) as unknown as {
      value: PackedBatch<Uint8Array>;
      transferables: Transferable[];
    };

    expect(result.transferables.slice(0, 2)).toEqual([buf1, buf2]);
    expect(unpackBatch(result.value)).toEqual(
      batch.map((r) =>
        r.type === "message-event"
          ? { ...r, msgEvent: { ...r.msgEvent, publishTime: undefined } }
          : r,
      ),
    );
  });

  it("packs readUntil() and transfers the message buffers", async () => {
    const time = RosTimeBuilder.time();
    const buffer = new Uint8Array([1]).buffer;
    mockCursor.readUntil.mockResolvedValueOnce([
      {
        type: "message-event",
        msgEvent: {
          topic: "/a",
          schemaName: "S",
          receiveTime: time,
          message: new Uint8Array(buffer),
          sizeInBytes: 1,
        },
      },
    ]);

    const cursor = new ComlinkTransferIteratorCursor(mockCursor);
    const result = (await cursor.readUntil(time)) as unknown as { transferables: Transferable[] };

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockCursor.readUntil as Mock).toHaveBeenCalledWith(time);
    expect(result.transferables[0]).toBe(buffer);
  });

  it("returns undefined when the cursor is done", async () => {
    mockCursor.nextBatch.mockResolvedValueOnce(undefined);
    const cursor = new ComlinkTransferIteratorCursor(mockCursor);
    await expect(cursor.nextBatch(100)).resolves.toBeUndefined();
  });

  it("delegates end()", async () => {
    const cursor = new ComlinkTransferIteratorCursor(mockCursor);
    await cursor.end();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockCursor.end).toHaveBeenCalled();
  });
});
