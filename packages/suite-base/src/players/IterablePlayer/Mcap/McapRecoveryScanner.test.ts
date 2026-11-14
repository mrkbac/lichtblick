// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader, McapTypes, McapWriter, TempBuffer } from "@mcap/core";

import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import PlayerBuilder from "@lichtblick/suite-base/testing/builders/PlayerBuilder";

import { BlobReadable } from "./BlobReadable";
import { McapIndexedIterableSource, RecoverReader } from "./McapIndexedIterableSource";
import { McapIterableSource } from "./McapIterableSource";
import { McapRecoveryScanner } from "./McapRecoveryScanner";

const TOPIC = "/example";
const MESSAGE_COUNT = 5;
// opcode + length + channel id + sequence + log time + publish time
const MESSAGE_HEADER_BYTES = 1 + 8 + 2 + 4 + 8 + 8;
const LOG_TIME_OFFSET_IN_MESSAGE = 1 + 8 + 2 + 4;

function payload(i: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ v: i }));
}

/** One message per chunk at 1s, 2s, …; `finish: false` leaves it as if the recorder was killed */
async function makeMcap({ finish }: { finish: boolean }): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer, chunkSize: 1 });
  await writer.start({ library: "test", profile: "" });
  const schemaId = await writer.registerSchema({
    name: "example_schema",
    encoding: "jsonschema",
    data: new TextEncoder().encode(JSON.stringify({ type: "object" })),
  });
  const channelId = await writer.registerChannel({
    schemaId,
    topic: TOPIC,
    messageEncoding: "json",
    metadata: new Map(),
  });
  await writer.addMetadata({ name: "example", metadata: new Map([["k", "v"]]) });
  for (let i = 1; i <= MESSAGE_COUNT; i++) {
    await writer.addMessage({
      channelId,
      sequence: i,
      logTime: BigInt(i) * 1_000_000_000n,
      publishTime: BigInt(i) * 1_000_000_000n,
      data: payload(i),
    });
  }
  if (finish) {
    await writer.end();
  }
  return buffer.get().slice();
}

async function chunkIndexes(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<readonly McapTypes.ChunkIndex[]> {
  const reader = await McapIndexedReader.Initialize({ readable: readableOf(bytes) });
  return reader.chunkIndexes;
}

function readableOf(bytes: Uint8Array<ArrayBuffer>): McapTypes.IReadable {
  return new BlobReadable(new Blob([bytes]));
}

/** A finished file cut off inside its last chunk */
async function truncatedInLastChunk(): Promise<Uint8Array<ArrayBuffer>> {
  const full = await makeMcap({ finish: true });
  const indexes = await chunkIndexes(full);
  const last = indexes[indexes.length - 1]!;
  return full.slice(0, Number(last.chunkStartOffset + last.chunkLength) - 3);
}

/** Offset of the log time of the (only) message in the `n`th chunk */
async function logTimeOffsetInChunk(bytes: Uint8Array<ArrayBuffer>, n: number): Promise<number> {
  const chunk = (await chunkIndexes(bytes))[n]!;
  const messageLength = MESSAGE_HEADER_BYTES + payload(n + 1).byteLength;
  return (
    Number(chunk.chunkStartOffset + chunk.chunkLength) - messageLength + LOG_TIME_OFFSET_IN_MESSAGE
  );
}

async function scan(bytes: Uint8Array<ArrayBuffer>): Promise<McapRecoveryScanner> {
  const scanner = new McapRecoveryScanner(await loadDecompressHandlers());
  await scanner.scan(readableOf(bytes));
  return scanner;
}

async function readValues(readable: McapTypes.IReadable): Promise<number[]> {
  const reader = await McapIndexedReader.Initialize({ readable });
  const values: number[] = [];
  for await (const message of reader.readMessages()) {
    values.push((JSON.parse(new TextDecoder().decode(message.data)) as { v: number }).v);
  }
  return values;
}

async function openSource(bytes: Uint8Array<ArrayBuffer>) {
  const source = new McapIterableSource({
    type: "file",
    file: new Blob([bytes]),
  });
  const init = await source.initialize();
  const results = [];
  for await (const result of source.messageIterator({
    topics: new Map([[TOPIC, PlayerBuilder.subscribePayload({ topic: TOPIC })]]),
  })) {
    results.push(result);
  }
  const values = results.flatMap((result) =>
    result.type === "message-event"
      ? [JSON.parse(new TextDecoder().decode(result.msgEvent.message)).v as number]
      : [],
  );
  const iteratorAlerts = results.flatMap((result) =>
    result.type === "alert" ? [result.alert] : [],
  );
  return { init, values, iteratorAlerts, source };
}

describe("McapRecoveryScanner", () => {
  it("recovers every record of a recording that was killed before writing its footer", async () => {
    // Given
    const bytes = await makeMcap({ finish: false });

    // When
    const scanner = await scan(bytes);

    // Then
    expect(scanner.messageCount).toBe(BigInt(MESSAGE_COUNT));
    expect(scanner.recoveredChunkCount()).toBe(MESSAGE_COUNT);
    expect(scanner.complete).toBe(false);
    expect(scanner.unreadableBytes).toBe(0n);
    expect(scanner.hasLosses()).toBe(false);
    expect(scanner.toAlert()).toMatchObject({ severity: "warn", message: /not closed properly/ });
  });

  it("serves the rebuilt index to McapIndexedReader, including metadata", async () => {
    // Given
    const bytes = await makeMcap({ finish: false });
    const scanner = await scan(bytes);

    // When
    const readable = scanner.toReadable(readableOf(bytes));
    const reader = await McapIndexedReader.Initialize({ readable });
    const metadata = [];
    for await (const record of reader.readMetadata()) {
      metadata.push(record.name);
    }

    // Then
    expect(await readValues(readable)).toEqual([1, 2, 3, 4, 5]);
    expect([...reader.channelsById.values()].map((c) => c.topic)).toEqual([TOPIC]);
    expect(reader.statistics?.messageCount).toBe(BigInt(MESSAGE_COUNT));
    expect(metadata).toEqual(["example"]);
  });

  it("drops a truncated last chunk and reports the lost bytes", async () => {
    // Given
    const bytes = await truncatedInLastChunk();

    // When
    const scanner = await scan(bytes);

    // Then
    expect(scanner.messageCount).toBe(BigInt(MESSAGE_COUNT - 1));
    expect(scanner.unreadableBytes).toBeGreaterThan(0n);
    expect(await readValues(scanner.toReadable(readableOf(bytes)))).toEqual([1, 2, 3, 4]);
    expect(scanner.toAlert()).toMatchObject({ severity: "warn", message: /damaged/ });
  });

  it("skips a chunk with a bad CRC and keeps the chunks after it", async () => {
    // Given
    const bytes = await makeMcap({ finish: true });
    bytes[await logTimeOffsetInChunk(bytes, 1)]! ^= 0xff;

    // When
    const scanner = await scan(bytes);

    // Then
    expect(scanner.corruptRecords).toBe(1);
    expect(await readValues(scanner.toReadable(readableOf(bytes)))).toEqual([1, 3, 4, 5]);
    expect(scanner.toAlert().tip).toMatch(/1 corrupt record/);
  });

  it("stops at garbage after the last valid record", async () => {
    // Given
    const valid = await makeMcap({ finish: false });
    const bytes = new Uint8Array([...valid, ...new Uint8Array(100).fill(0x42)]);

    // When
    const scanner = await scan(bytes);

    // Then
    expect(scanner.offset).toBe(BigInt(valid.byteLength));
    expect(scanner.unreadableBytes).toBe(100n);
    expect(await readValues(scanner.toReadable(readableOf(bytes)))).toEqual([1, 2, 3, 4, 5]);
  });

  it("resumes from where the previous scan stopped as the file grows", async () => {
    // Given
    const full = await makeMcap({ finish: false });
    const scanner = new McapRecoveryScanner(await loadDecompressHandlers());
    await scanner.scan(readableOf(full.slice(0, Math.floor(full.byteLength / 2))));
    const firstPass = scanner.messageCount;

    // When
    await scanner.scan(readableOf(full));

    // Then
    expect(firstPass).toBeLessThan(BigInt(MESSAGE_COUNT));
    expect(scanner.messageCount).toBe(BigInt(MESSAGE_COUNT));
    expect(await readValues(scanner.toReadable(readableOf(full)))).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads no further than a short step needs", async () => {
    // Given a file read in short steps
    const bytes = await makeMcap({ finish: false });
    const readable = readableOf(bytes);
    let readBytes = 0n;
    const counting: McapTypes.IReadable = {
      size: async () => await readable.size(),
      read: async (offset, length) => {
        readBytes += length;
        return await readable.read(offset, length);
      },
    };
    const scanner = new McapRecoveryScanner(await loadDecompressHandlers());

    // When it is scanned 64 bytes at a time
    while (await scanner.scan(counting, 64n)) {
      // keep stepping
    }

    // Then every byte is read about once, not a whole read window per step
    expect(scanner.messageCount).toBe(BigInt(MESSAGE_COUNT));
    expect(readBytes).toBeLessThan(2n * BigInt(bytes.byteLength));
  });

  it("refuses files that are not MCAP", async () => {
    // Given
    const scanner = new McapRecoveryScanner(await loadDecompressHandlers());

    // When / Then
    await expect(scanner.scan(readableOf(new Uint8Array(64).fill(1)))).rejects.toThrow(/magic/);
  });
});

describe("McapIterableSource recovery", () => {
  it("opens a footer-less file through the rebuilt index and says so", async () => {
    // Given
    const bytes = await makeMcap({ finish: false });

    // When
    const { init, values } = await openSource(bytes);

    // Then
    expect(values).toEqual([1, 2, 3, 4, 5]);
    expect(init.topicStats.get(TOPIC)?.numMessages).toBe(MESSAGE_COUNT);
    expect(init.alerts[0]).toMatchObject({ severity: "warn", message: /not closed properly/ });
  });

  it("opens a file cut off in the middle of a chunk", async () => {
    // Given
    const bytes = await truncatedInLastChunk();

    // When
    const { init, values } = await openSource(bytes);

    // Then
    expect(values).toEqual([1, 2, 3, 4]);
    expect(init.alerts[0]?.tip).toMatch(/could not be read/);
  });

  it("recovers mid-read from a corrupt chunk in a file whose summary is intact", async () => {
    // Given a finished file whose summary still lists the corrupt chunk
    const bytes = await makeMcap({ finish: true });
    bytes[await logTimeOffsetInChunk(bytes, 2)]! ^= 0xff;

    // When
    const { init, values, iteratorAlerts } = await openSource(bytes);

    // Then
    expect(init.alerts).toEqual([]);
    expect(values).toEqual([1, 2, 4, 5]);
    expect(iteratorAlerts).toEqual([
      expect.objectContaining({ severity: "warn", message: expect.stringMatching(/damaged/) }),
    ]);
  });

  it("keeps the healthy path free of scans", async () => {
    // Given
    const bytes = await makeMcap({ finish: true });

    // When
    const { init, values } = await openSource(bytes);

    // Then
    expect(values).toEqual([1, 2, 3, 4, 5]);
    expect(init.alerts).toEqual([]);
  });
});

describe("McapIndexedIterableSource read errors", () => {
  const subscription = new Map([[TOPIC, PlayerBuilder.subscribePayload({ topic: TOPIC })]]);

  async function indexedReader(): Promise<McapIndexedReader> {
    return await McapIndexedReader.Initialize({
      readable: readableOf(await makeMcap({ finish: true })),
    });
  }

  /** Makes the reader's next `count` reads throw after their first message */
  function failReads(reader: McapIndexedReader, count: number): void {
    const readMessages = reader.readMessages.bind(reader);
    let failures = count;
    vi.spyOn(reader, "readMessages").mockImplementation(async function* (args) {
      const fail = failures-- > 0;
      for await (const message of readMessages(args)) {
        yield message;
        if (fail) {
          throw new Error("read failed");
        }
      }
    });
  }

  async function collect(source: McapIndexedIterableSource): Promise<number[]> {
    await source.initialize();
    const values: number[] = [];
    for await (const result of source.messageIterator({ topics: subscription })) {
      if (result.type === "message-event") {
        values.push(
          (JSON.parse(new TextDecoder().decode(result.msgEvent.message)) as { v: number }).v,
        );
      }
    }
    return values;
  }

  it("retries a failed read once without rebuilding the index", async () => {
    // Given a read that fails once, like a dropped connection
    const reader = await indexedReader();
    failReads(reader, 1);
    const recover = vi.fn<RecoverReader>();

    // When
    const values = await collect(new McapIndexedIterableSource(reader, { recover }));

    // Then every message arrives once and no scan ran
    expect(values).toEqual([1, 2, 3, 4, 5]);
    expect(recover).not.toHaveBeenCalled();
  });

  it("surfaces the error when the recovered reader fails too, instead of retrying forever", async () => {
    // Given a reader and a recovered reader that both always fail
    const reader = await indexedReader();
    failReads(reader, Infinity);
    const recovered = await indexedReader();
    failReads(recovered, Infinity);
    const recover = vi.fn<RecoverReader>().mockResolvedValue({
      reader: recovered,
      alert: undefined,
    });

    // When / Then
    await expect(collect(new McapIndexedIterableSource(reader, { recover }))).rejects.toThrow(
      "read failed",
    );
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
