// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://viewer.example/"}
 */

import { PlayerState } from "@lichtblick/suite-base/players/types";

import FoxgloveWebSocketPlayer from "./index";

class MockWebSocket {
  public static lastInstance: MockWebSocket | undefined;
  public binaryType = "";
  public protocol = "";
  public onerror?: (event: unknown) => void;
  public onopen?: (event: unknown) => void;
  public onclose?: (event: unknown) => void;
  public onmessage?: (event: unknown) => void;
  public close = vi.fn();
  public send = vi.fn();

  public constructor() {
    MockWebSocket.lastInstance = this;
  }
}

describe("FoxgloveWebSocketPlayer from an https page", () => {
  afterEach(() => {
    delete (global as { WebSocket?: unknown }).WebSocket;
  });

  it("shows the blocked-ws:// guide for an error without payload (Safari)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    (global as { WebSocket?: unknown }).WebSocket = MockWebSocket;
    const states: PlayerState[] = [];
    const player = new FoxgloveWebSocketPlayer({
      url: "ws://robot.example:8765",
      sourceId: "foxglove-websocket",
    });
    player.setListener(async (state) => {
      states.push(state);
    });
    const ws = MockWebSocket.lastInstance!;
    // FoxgloveClient turns this into Error("WebSocket error")
    ws.onerror?.({});
    ws.onclose?.({ code: 1006, reason: "", wasClean: false });
    await Promise.resolve();
    player.close();

    expect(states.at(-1)?.alerts?.[0]?.guide).toEqual({
      type: "wsMixedContent",
      url: "ws://robot.example:8765",
    });
    consoleError.mockRestore(); // the socket and player log the failure
  });
});
