// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { ToWorkerMessage } from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/types";
import { BasicBuilder } from "@lichtblick/test-builders";

class MockWebSocket {
  public static readonly OPEN = 1;
  public static lastInstance: MockWebSocket | undefined;
  public readyState = 0;
  public binaryType = "";
  public protocol = "test-protocol";
  public onerror?: (event: unknown) => void;
  public onopen?: (event: unknown) => void;
  public onclose?: (event: unknown) => void;
  public onmessage?: (event: MessageEvent) => void;
  public close = vi.fn();
  public send = vi.fn();

  public constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    MockWebSocket.lastInstance = this;
    if (constructorShouldThrow) {
      throw constructorError;
    }
  }
}

let constructorShouldThrow = false;
let constructorError: unknown;
let postMessageMock: Mock;
let onmessage: (event: MessageEvent<ToWorkerMessage>) => void;
let workerModule: typeof import("./worker");

function dispatch(data: ToWorkerMessage): void {
  onmessage({ data } as MessageEvent<ToWorkerMessage>);
}

describe("FoxgloveWebSocketPlayer worker", () => {
  const wsUrl = BasicBuilder.string();
  beforeEach(async () => {
    vi.resetModules();

    MockWebSocket.lastInstance = undefined;
    constructorShouldThrow = false;
    constructorError = undefined;

    postMessageMock = vi.fn();
    (global as unknown as { self: unknown }).self = global;
    self.postMessage = postMessageMock;
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;

    workerModule = await import("./worker");
    onmessage = self.onmessage as unknown as (event: MessageEvent<ToWorkerMessage>) => void;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("open", () => {
    it("should create a WebSocket with the given url and protocols", () => {
      // Given
      const protocols = [BasicBuilder.string()];
      // When
      dispatch({ type: "open", data: { wsUrl, protocols } });
      // Then
      expect(MockWebSocket.lastInstance?.url).toBe(wsUrl);
      expect(MockWebSocket.lastInstance?.protocols).toEqual(protocols);
    });

    it("should set the binaryType to arraybuffer", () => {
      // When
      dispatch({ type: "open", data: { wsUrl } });
      // Then
      expect(MockWebSocket.lastInstance?.binaryType).toBe("arraybuffer");
    });

    it("should post an open message when the socket opens", () => {
      // Given
      dispatch({ type: "open", data: { wsUrl } });
      // When
      MockWebSocket.lastInstance?.onopen?.(undefined);
      // Then
      expect(postMessageMock).toHaveBeenCalledWith({
        type: "open",
        protocol: "test-protocol",
      });
    });

    it("should post an error message when the socket errors", () => {
      // Given
      dispatch({ type: "open", data: { wsUrl } });
      const error = new Error(BasicBuilder.string());
      // When
      MockWebSocket.lastInstance?.onerror?.({ error });
      // Then
      expect(postMessageMock).toHaveBeenCalledWith({ type: "error", error });
    });

    it("should post a close message when the socket closes", () => {
      // Given
      dispatch({ type: "open", data: { wsUrl } });
      const closeEvent = { code: 1000, reason: BasicBuilder.string(), wasClean: true };
      // When
      MockWebSocket.lastInstance?.onclose?.(closeEvent);
      // Then
      expect(postMessageMock).toHaveBeenCalledWith({ type: "close", data: closeEvent });
    });

    it("should post the messages received meanwhile in one batch, transferring buffers", () => {
      // Given
      vi.useFakeTimers();
      dispatch({ type: "open", data: { wsUrl } });
      const buffer = new ArrayBuffer(8);
      const text = BasicBuilder.string();
      // When
      MockWebSocket.lastInstance?.onmessage?.({ data: buffer } as MessageEvent);
      MockWebSocket.lastInstance?.onmessage?.({ data: text } as MessageEvent);
      // Then
      expect(postMessageMock).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(postMessageMock).toHaveBeenCalledTimes(1);
      expect(postMessageMock).toHaveBeenCalledWith({ type: "messages", data: [buffer, text] }, [
        buffer,
      ]);
      vi.useRealTimers();
    });

    it("should split a burst into several batches", () => {
      vi.useFakeTimers();
      dispatch({ type: "open", data: { wsUrl } });
      const count = workerModule.MAX_BATCH_MESSAGES * 2 + 1;
      for (let i = 0; i < count; i++) {
        MockWebSocket.lastInstance?.onmessage?.({ data: new ArrayBuffer(1) } as MessageEvent);
      }
      // Two full batches went out right away; the rest waits for the timer
      expect(postMessageMock).toHaveBeenCalledTimes(2);
      vi.runAllTimers();
      const sizes = postMessageMock.mock.calls.map(
        ([message]) => (message as { data: unknown[] }).data.length,
      );
      expect(sizes).toEqual([workerModule.MAX_BATCH_MESSAGES, workerModule.MAX_BATCH_MESSAGES, 1]);

      const big = new ArrayBuffer(workerModule.MAX_BATCH_BYTES);
      MockWebSocket.lastInstance?.onmessage?.({ data: big } as MessageEvent);
      expect(postMessageMock).toHaveBeenCalledTimes(4);
      vi.useRealTimers();
    });

    it("should post pending messages before a close, keeping their order", () => {
      // Given
      vi.useFakeTimers();
      dispatch({ type: "open", data: { wsUrl } });
      const buffer = new ArrayBuffer(8);
      const closeEvent = { code: 1000, reason: "", wasClean: true };
      // When
      MockWebSocket.lastInstance?.onmessage?.({ data: buffer } as MessageEvent);
      MockWebSocket.lastInstance?.onclose?.(closeEvent);
      vi.runAllTimers();
      // Then
      expect(postMessageMock.mock.calls).toEqual([
        [{ type: "messages", data: [buffer] }, [buffer]],
        [{ type: "close", data: closeEvent }],
      ]);
      vi.useRealTimers();
    });

    it("should post an error message when constructing the WebSocket throws", () => {
      // Given
      constructorShouldThrow = true;
      constructorError = new Error("Insecure WebSocket connection");
      // When
      dispatch({ type: "open", data: { wsUrl } });
      // Then
      expect(postMessageMock).toHaveBeenCalledWith({ type: "error", error: constructorError });
      expect(postMessageMock).toHaveBeenCalledWith({
        type: "close",
        data: { code: 1006, reason: "Insecure WebSocket connection", wasClean: false },
      });
    });
  });

  describe("close", () => {
    it("should close the active WebSocket", () => {
      // Given
      dispatch({ type: "open", data: { wsUrl } });
      const instance = MockWebSocket.lastInstance;
      // When
      dispatch({ type: "close", data: undefined });
      // Then
      expect(instance?.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("data", () => {
    it("should send data through the active WebSocket", () => {
      // Given
      dispatch({ type: "open", data: { wsUrl } });
      const instance = MockWebSocket.lastInstance!;
      instance.readyState = MockWebSocket.OPEN;
      const data = BasicBuilder.string();
      // When
      dispatch({ type: "data", data });
      // Then
      expect(instance.send).toHaveBeenCalledWith(data);
    });

    it("should drop data for a socket that isn't open", () => {
      dispatch({ type: "open", data: { wsUrl } });
      dispatch({ type: "data", data: BasicBuilder.string() });
      expect(MockWebSocket.lastInstance?.send).not.toHaveBeenCalled();
    });
  });
});
