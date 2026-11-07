// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapWriter, TempBuffer } from "@mcap/core";

import {
  evictLiveRecordings,
  isEmptyMcap,
  liveMachine,
  liveRecordingLockName,
  liveRecordingName,
  liveSourceUrl,
  parseLiveRecordingName,
} from "./liveRecordings";

/** Magic, then an (empty) chunk record header: what isEmptyMcap needs to see data. */
const WITH_CHUNK = new Uint8Array([
  0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a, 0x06, 0, 0, 0, 0, 0, 0, 0, 0,
]).buffer;

/** An in-memory directory of files with the given sizes. */
function fakeDirectory(sizes: Record<string, number>) {
  const files = new Map(Object.entries(sizes));
  const directory = {
    async *entries() {
      for (const [name, size] of [...files]) {
        yield [
          name,
          {
            kind: "file",
            getFile: async () => ({ size, lastModified: 0, arrayBuffer: async () => WITH_CHUNK }),
          },
        ] as const;
      }
    },
    removeEntry: async (name: string) => {
      files.delete(name);
    },
  };
  return { files, directory };
}

describe("evictLiveRecordings", () => {
  let held: string[];
  let files: Map<string, number>;

  beforeEach(() => {
    held = [];
    const fake = fakeDirectory({
      "live-2026-01-01T00-00-00.mcap": 400,
      "live-2026-01-02T00-00-00.mcap": 300,
      "live-2026-01-03T00-00-00.mcap": 200,
      "notes.txt": 10_000,
    });
    files = fake.files;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        getDirectory: async () => ({ getDirectoryHandle: async () => fake.directory }),
      },
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        query: async () => ({ held: held.map((name) => ({ name })) }),
        request: async (
          name: string,
          _options: unknown,
          callback: (lock: { name: string } | null) => Promise<unknown>,
        ) => await callback(held.includes(name) ? null : { name }),
      },
    });
  });

  it("deletes the oldest recordings until they fit, ignoring other files", async () => {
    await evictLiveRecordings(600);
    expect([...files.keys()]).toEqual([
      "live-2026-01-02T00-00-00.mcap",
      "live-2026-01-03T00-00-00.mcap",
      "notes.txt",
    ]);
  });

  it("never deletes a recording that is being written", async () => {
    held = [liveRecordingLockName("live-2026-01-01T00-00-00.mcap")];
    await evictLiveRecordings(100);
    expect([...files.keys()]).toEqual(["live-2026-01-01T00-00-00.mcap", "notes.txt"]);
  });
});

describe("liveRecordingName", () => {
  const start = new Date("2026-11-07T10:30:00.123Z");

  it("sorts by start time and is a valid file name", () => {
    expect(liveRecordingName(start, undefined, "ab12")).toBe(
      "live-2026-11-07T10-30-00-123-ab12.mcap",
    );
  });

  it("names the machine and reads it back", () => {
    const name = liveRecordingName(start, liveMachine("ws://robot.local:8765/x"), "ab12");
    expect(name).toBe("live-2026-11-07T10-30-00-123-ab12@robot.local_8765.mcap");
    expect(parseLiveRecordingName(name)).toEqual({ start, machine: "robot.local:8765" });
  });

  it("reads names without a machine", () => {
    expect(parseLiveRecordingName("live-2026-11-07T10-30-00-123-ab12.mcap")).toEqual({
      start,
      machine: undefined,
    });
    expect(parseLiveRecordingName("other.mcap")).toEqual({});
  });
});

describe("liveSourceUrl", () => {
  it("drops user info, query and fragment, which may carry credentials", () => {
    expect(liveSourceUrl("ws://user:secret@robot.local:8765/x?token=abc#y")).toBe(
      "ws://robot.local:8765/x",
    );
    expect(liveSourceUrl("not a url")).toBe("");
    expect(liveMachine("/bridge?token=secret")).toBe("");
  });
});

describe("isEmptyMcap", () => {
  async function mcap(messages: number, finished = messages > 0): Promise<Blob> {
    const buffer = new TempBuffer();
    const writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: "", library: "test" });
    if (messages > 0) {
      const schemaId = await writer.registerSchema({
        name: "S",
        encoding: "",
        data: new Uint8Array(),
      });
      const channelId = await writer.registerChannel({
        topic: "/a",
        schemaId,
        messageEncoding: "json",
        metadata: new Map(),
      });
      for (let i = 0; i < messages; i++) {
        await writer.addMessage({
          channelId,
          sequence: i,
          logTime: 0n,
          publishTime: 0n,
          data: new Uint8Array(),
        });
      }
    }
    if (finished) {
      await writer.end();
    }
    return new Blob([buffer.get().slice()]);
  }

  it("is true for a recording cut off before any message", async () => {
    await expect(isEmptyMcap(await mcap(0))).resolves.toBe(true);
  });

  it("keeps files whose records don't add up, or that aren't MCAP", async () => {
    const header = new Uint8Array(await (await mcap(0)).arrayBuffer());
    const cutOff = header.slice(0, header.length - 1);
    await expect(isEmptyMcap(new Blob([cutOff]))).resolves.toBe(false);
    await expect(isEmptyMcap(new Blob([new Uint8Array(20)]))).resolves.toBe(false);
  });

  it("is true for a finished recording without messages", async () => {
    await expect(isEmptyMcap(await mcap(0, true))).resolves.toBe(true);
  });

  it("keeps files without a header first, or with only the magic", async () => {
    const header = new Uint8Array(await (await mcap(0)).arrayBuffer());
    const noHeader = header.slice();
    noHeader[8] = 0x04; // a channel record where the header belongs
    await expect(isEmptyMcap(new Blob([noHeader]))).resolves.toBe(false);
    await expect(isEmptyMcap(new Blob([header.slice(0, 8)]))).resolves.toBe(false);
  });

  it("is false once a message was written", async () => {
    await expect(isEmptyMcap(await mcap(1))).resolves.toBe(false);
  });
});
