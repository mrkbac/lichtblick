// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { evictLiveRecordings, liveRecordingLockName, liveRecordingName } from "./liveRecordings";

/** An in-memory directory of files with the given sizes. */
function fakeDirectory(sizes: Record<string, number>) {
  const files = new Map(Object.entries(sizes));
  const directory = {
    async *entries() {
      for (const [name, size] of [...files]) {
        yield [name, { kind: "file", getFile: async () => ({ size, lastModified: 0 }) }] as const;
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
      value: { query: async () => ({ held: held.map((name) => ({ name })) }) },
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
  it("sorts by start time and is a valid file name", () => {
    expect(liveRecordingName(new Date("2026-11-07T10:30:00.123Z"), "ab12")).toBe(
      "live-2026-11-07T10-30-00-123-ab12.mcap",
    );
  });
});
