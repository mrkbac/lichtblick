// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { McapIndexedReader, TempBuffer } from "@mcap/core";
import type { Mock } from "vitest";

import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { liveHistorySettings } from "@lichtblick/suite-base/players/liveHistory/liveHistorySettings";
import { PlayerState } from "@lichtblick/suite-base/players/types";

import FoxgloveWebSocketPlayer from "./index";

const recorder = vi.hoisted(() => ({ enabled: false, failNext: 0, record: vi.fn() }));
vi.mock("@lichtblick/suite-base/players/liveHistory/LiveRecorder", () => ({
  LiveRecorder: class {
    public record = recorder.record;
    public constructor() {
      if (recorder.failNext > 0) {
        recorder.failNext--;
        throw new Error("Workers are blocked");
      }
    }
    public async stop() {}
  },
}));
vi.mock("@lichtblick/suite-base/players/liveHistory/liveRecordings", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@lichtblick/suite-base/players/liveHistory/liveRecordings")
  >()),
  supportsLiveRecording: () => recorder.enabled,
}));

class MockWebSocket {
  public static lastInstance: MockWebSocket | undefined;
  public binaryType = "";
  public protocol = "foxglove.sdk.v1";
  public onerror?: (event: unknown) => void;
  public onopen?: (event: unknown) => void;
  public onclose?: (event: unknown) => void;
  public onmessage?: (event: unknown) => void;
  public close = vi.fn();
  public send = vi.fn();

  public constructor() {
    MockWebSocket.lastInstance = this;
  }

  public receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const SEC = 1_000_000_000n;
const SCHEMA = JSON.stringify({
  type: "object",
  properties: { v: { type: "number" } },
});

function timeMessage(sec: number): ArrayBuffer {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, 0x02);
  view.setBigUint64(1, BigInt(sec * 1000) * (SEC / 1000n), true);
  return buffer;
}

function dataMessage(subscriptionId: number, payload: unknown): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const buffer = new ArrayBuffer(13 + json.byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, 0x01);
  view.setUint32(1, subscriptionId, true);
  view.setBigUint64(5, 0n, true);
  new Uint8Array(buffer, 13).set(json);
  return buffer;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("FoxgloveWebSocketPlayer live history", () => {
  let player: FoxgloveWebSocketPlayer;
  let ws: MockWebSocket;
  let states: PlayerState[];

  const last = () => states.at(-1)!.activeData!;
  const values = (from: number) =>
    states
      .slice(from)
      .flatMap((s) => s.activeData?.messages ?? [])
      .map((m) => (m.message as { v: number }).v);

  async function tick(sec: number, value?: number, subscriptionId = 0) {
    ws.receive(timeMessage(sec));
    if (value != undefined) {
      ws.receive(dataMessage(subscriptionId, { v: value }));
    }
    await flush();
  }

  function connect() {
    ws.onopen?.({});
    ws.receive(
      JSON.stringify({
        op: "serverInfo",
        name: "test",
        capabilities: ["time"],
      }),
    );
    ws.receive(
      JSON.stringify({
        op: "advertise",
        channels: [
          {
            id: 1,
            topic: "/a",
            encoding: "json",
            schemaName: "S",
            schema: SCHEMA,
          },
        ],
      }),
    );
  }

  beforeEach(async () => {
    liveHistorySettings.getState().setWindowSec(30);
    (global as { WebSocket?: unknown }).WebSocket = MockWebSocket;
    states = [];
    player = new FoxgloveWebSocketPlayer({
      url: "ws://localhost:8765",
      sourceId: "foxglove-websocket",
    });
    player.setListener(async (state) => {
      states.push(state);
    });
    ws = MockWebSocket.lastInstance!;
    connect();
    player.setSubscriptions([{ topic: "/a" }]);
    for (let t = 10; t <= 12; t++) {
      await tick(t, t);
    }
  });

  afterEach(() => {
    player.close();
    vi.useRealTimers();
    delete (global as { WebSocket?: unknown }).WebSocket;
  });

  it.each([0, 256, 100_000])("round-trips %i byte parameter values", async (length) => {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
    const encoded = Buffer.from(bytes).toString("base64");
    player.setParameter("binary", bytes);
    expect(ws.send).toHaveBeenLastCalledWith(
      expect.stringContaining(
        JSON.stringify({ name: "binary", value: encoded, type: "byte_array" })!,
      ),
    );
    ws.receive(
      JSON.stringify({
        op: "parameterValues",
        parameters: [{ name: "received_binary", type: "byte_array", value: encoded }],
      }),
    );
    await flush();
    expect(last().parameters?.get("received_binary")).toEqual(bytes);
  });

  it.each([" /x==\n", "/x", "/x=="])("decodes legacy loose Base64 %j", async (encoded) => {
    ws.receive(
      JSON.stringify({
        op: "parameterValues",
        parameters: [{ name: "binary", type: "byte_array", value: encoded }],
      }),
    );
    await flush();
    expect(last().parameters?.get("binary")).toEqual(new Uint8Array([255]));
  });

  it.each(["A", "AA=", "AA===", "AA!A", "_w=="])("rejects malformed Base64 %j", (encoded) => {
    expect(() => {
      ws.receive(
        JSON.stringify({
          op: "parameterValues",
          parameters: [{ name: "binary", type: "byte_array", value: encoded }],
        }),
      );
    }).toThrow();
    expect(last().parameters?.has("binary")).toBe(false);
  });

  it("is live by default and exposes the buffered range", () => {
    expect(states.at(-1)!.capabilities).toEqual(
      expect.arrayContaining([
        PLAYER_CAPABILITIES.playbackControl,
        PLAYER_CAPABILITIES.liveHistory,
      ]),
    );
    expect(last().startTime).toEqual({ sec: 10, nsec: 0 });
    expect(last().endTime).toEqual({ sec: 12, nsec: 0 });
    expect(last().currentTime).toEqual({ sec: 12, nsec: 0 });
    expect(values(0)).toEqual([10, 11, 12]);
  });

  it("freezes on pause while reception continues", async () => {
    player.pausePlayback();
    await flush();
    const from = states.length;
    await tick(13, 13);
    expect(values(from)).toEqual([]);
    expect(last().currentTime).toEqual({ sec: 12, nsec: 0 });
    expect(last().endTime).toEqual({ sec: 13, nsec: 0 });
    expect(last().isPlaying).toBe(false);
  });

  it("seeks into the history with the state at that time", async () => {
    player.pausePlayback();
    const seeks = last().lastSeekTime;
    const from = states.length;
    player.seekPlayback({ sec: 11, nsec: 500 });
    await flush();
    expect(last().currentTime).toEqual({ sec: 11, nsec: 500 });
    expect(last().lastSeekTime).toBe(seeks + 1);
    expect(values(from)).toEqual([11]);
  });

  it("reports session and history stats", () => {
    expect(last().liveStats).toEqual(
      expect.objectContaining({ historyMessages: 3, connectedAtMs: expect.any(Number) }),
    );
  });

  it("saves the history as MCAP with the received bytes", async () => {
    const file = new TempBuffer();
    await player.exportLiveHistory(file);
    const reader = await McapIndexedReader.Initialize({ readable: file });
    const channel = [...reader.channelsById.values()][0]!;
    expect(channel).toEqual(expect.objectContaining({ topic: "/a", messageEncoding: "json" }));
    expect(reader.schemasById.get(channel.schemaId)).toEqual(
      expect.objectContaining({ name: "S", encoding: "jsonschema" }),
    );
    const decoder = new TextDecoder();
    const saved = [];
    for await (const msg of reader.readMessages()) {
      saved.push([Number(msg.logTime / SEC), JSON.parse(decoder.decode(msg.data)).v]);
    }
    expect(saved).toEqual([
      [10, 10],
      [11, 11],
      [12, 12],
    ]);
  });

  it("clamps seeks to the buffered range", async () => {
    player.pausePlayback();
    player.seekPlayback({ sec: 1, nsec: 0 });
    await flush();
    expect(last().currentTime).toEqual({ sec: 10, nsec: 0 });
  });

  it("goes live again when playing from the newest data", async () => {
    player.pausePlayback();
    await tick(13, 13);
    player.seekPlayback(last().endTime);
    player.startPlayback();
    await flush();
    const from = states.length;
    await tick(14, 14);
    expect(values(from)).toEqual([14]);
    expect(last().currentTime).toEqual({ sec: 14, nsec: 0 });
    expect(last().isPlaying).toBe(true);
  });

  it("hands panels the messages that arrived while back in time when going live", async () => {
    player.pausePlayback();
    player.seekPlayback({ sec: 10, nsec: 0 });
    await tick(13, 13);
    await tick(14, 14);
    await flush();
    const from = states.length;
    player.seekPlayback(last().endTime);
    player.startPlayback();
    await flush();
    expect(values(from)).toEqual([13, 14]);
  });

  it("keeps arrival order of same-time messages caught up after a pause", async () => {
    player.pausePlayback();
    player.seekPlayback({ sec: 10, nsec: 0 });
    ws.receive(timeMessage(13));
    ws.receive(dataMessage(0, { v: 1 }));
    ws.receive(dataMessage(0, { v: 2 }));
    await flush();
    const from = states.length;
    player.seekPlayback(last().endTime);
    player.startPlayback();
    await flush();
    expect(values(from)).toEqual([1, 2]);
  });

  it("plays through the history and catches up to live", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    player.pausePlayback();
    player.seekPlayback({ sec: 10, nsec: 0 });
    await flush();
    const from = states.length;
    player.startPlayback();
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(values(from)).toEqual([11]);
    expect(last().currentTime.sec).toBe(11);

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(values(from)).toEqual([11, 12]);
    expect(last().currentTime).toEqual(last().endTime); // live

    await tick(13, 13);
    expect(values(from)).toEqual([11, 12, 13]);
  });

  it("clears the history when the server clock resets", async () => {
    player.pausePlayback();
    await tick(2, 2);
    expect(last().startTime).toEqual({ sec: 2, nsec: 0 });
    expect(last().isPlaying).toBe(false);
    const from = states.length;
    player.seekPlayback({ sec: 0, nsec: 0 });
    await flush();
    expect(values(from)).toEqual([2]);
  });

  it("warns when the paused position has expired", async () => {
    liveHistorySettings.getState().setWindowSec(1);
    player.pausePlayback();
    player.seekPlayback({ sec: 11, nsec: 0 });
    await tick(20, 20);
    expect(states.at(-1)!.alerts?.map((a) => a.message)).toContain(
      "Paused position is no longer in the history",
    );
    expect(last().startTime).toEqual({ sec: 19, nsec: 0 });
    (console.warn as Mock).mockClear();
  });

  it("keeps delivering messages if recording can't start, and retries on reconnect", async () => {
    recorder.enabled = true;
    recorder.failNext = 1;
    (global as { Worker?: unknown }).Worker = vi.fn();
    try {
      const from = states.length;
      await tick(13, 13);
      await tick(14, 14);
      expect(values(from)).toEqual([13, 14]);
      expect(last().topicStats.get("/a")?.numMessages).toBe(5);
      expect(states.at(-1)!.alerts?.map(({ message }) => message)).toContain(
        "Recording to browser storage stopped",
      );
      expect(recorder.record).not.toHaveBeenCalled();
      // the alert is also logged once
      expect((console.warn as Mock).mock.calls.length).toBe(1);
      (console.warn as Mock).mockClear();

      connect();
      await tick(50, 50, 1);
      expect(recorder.record).toHaveBeenCalledTimes(1);
    } finally {
      recorder.enabled = false;
      recorder.record.mockClear();
      delete (global as { Worker?: unknown }).Worker;
    }
  });

  it("clears the history on reconnect", async () => {
    connect();
    await tick(50, 50, 1);
    expect(last().startTime).toEqual({ sec: 50, nsec: 0 });
  });
});
