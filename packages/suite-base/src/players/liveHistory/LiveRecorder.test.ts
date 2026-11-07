// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LiveRecorder } from "./LiveRecorder";
import { liveHistorySettings } from "./liveHistorySettings";
import { evictLiveRecordings } from "./liveRecordings";

const calls: string[] = [];
let fileSize = 0;
const remote = {
  start: vi.fn(async (name: string) => {
    calls.push(`start ${name.startsWith("live-") ? "file" : name}`);
  }),
  addChannel: vi.fn(async (key: number) => {
    calls.push(`channel ${key}`);
  }),
  append: vi.fn(async (messages: unknown[]) => {
    calls.push(`append ${messages.length}`);
    return fileSize;
  }),
  stop: vi.fn(async () => {
    calls.push("stop");
  }),
  releaseProxy: () => {},
};

vi.mock("@foxglove/comlink", () => ({
  wrap: () => remote,
  releaseProxy: "releaseProxy",
}));
vi.mock("./liveRecordings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./liveRecordings")>()),
  evictLiveRecordings: vi.fn(async () => {}),
  moveLiveRecordingsToFolder: vi.fn(async () => {}),
}));

const MIB = 1024 * 1024;
const channel = {
  topic: "/a",
  messageEncoding: "json",
  schema: { name: "S", encoding: "jsonschema", data: new Uint8Array() },
};
const flush = async () => {
  await vi.advanceTimersByTimeAsync(600);
};

describe("LiveRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    fileSize = 0;
    vi.mocked(evictLiveRecordings).mockClear();
    (globalThis as { Worker?: unknown }).Worker = class {
      public terminate() {}
    };
    liveHistorySettings.getState().setDiskMiB(1024);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a new file once the current one passes half the budget", async () => {
    remote.start.mockClear();
    const recorder = new LiveRecorder({
      profile: "",
      source: { url: "ws://user:secret@robot.local:8765/x?token=t#f", serverName: "bridge" },
      onError: () => {},
    });
    recorder.record(channel, { sec: 1, nsec: 0 }, new Uint8Array(1));
    fileSize = 513 * MIB;
    await flush();
    fileSize = 1; // the new file
    recorder.record(channel, { sec: 2, nsec: 0 }, new Uint8Array(1));
    await flush();
    await recorder.stop();

    expect(calls).toEqual([
      "start file",
      "channel 0",
      "append 1",
      "stop",
      "start file",
      // channels are registered again in the new file
      "channel 0",
      "append 1",
      "stop",
    ]);
    // Both files name the machine and carry the source without credentials.
    expect(remote.start.mock.calls).toEqual([
      [
        expect.stringMatching(/@robot\.local_8765\.mcap$/),
        "",
        { url: "ws://robot.local:8765/x", serverName: "bridge" },
      ],
      [
        expect.stringMatching(/@robot\.local_8765\.mcap$/),
        "",
        { url: "ws://robot.local:8765/x", serverName: "bridge" },
      ],
    ]);
  });

  it("keeps recordings when recording is turned off", async () => {
    const recorder = new LiveRecorder({
      profile: "",
      source: { url: "ws://localhost:8765" },
      onError: () => {},
    });
    recorder.record(channel, { sec: 1, nsec: 0 }, new Uint8Array(1));
    await flush();
    vi.mocked(evictLiveRecordings).mockClear();
    liveHistorySettings.getState().setDiskMiB(0);
    await recorder.stop();
    expect(evictLiveRecordings).not.toHaveBeenCalled();
  });

  it("counts the file being written toward the budget when evicting", async () => {
    const recorder = new LiveRecorder({
      profile: "",
      source: { url: "ws://localhost:8765" },
      onError: () => {},
    });
    recorder.record(channel, { sec: 1, nsec: 0 }, new Uint8Array(1));
    fileSize = 100 * MIB;
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(evictLiveRecordings).toHaveBeenLastCalledWith(924 * MIB);
    await recorder.stop();
  });
});
