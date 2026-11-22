// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { FromWorkerMessage } from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/types";
import { BasicBuilder } from "@lichtblick/test-builders";

import WorkerSocketAdapter from "./WorkerSocketAdapter";

describe("WorkerSocketAdapter", () => {
  let workerMock: any;
  const wsUrl = "wss://example.com";

  beforeEach(() => {
    workerMock = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: undefined as ((event: MessageEvent) => void) | undefined,
    };

    global.Worker = vi.fn(function () {
      return workerMock;
    });

    new WorkerSocketAdapter(wsUrl);
  });

  it("WorkerSocketAdapter should close a WebSocket connection", () => {
    workerMock.onmessage?.({ data: { type: "close", data: {} } } as MessageEvent);

    expect(workerMock.terminate).toHaveBeenCalled();
  });

  it("WorkerSocketAdapter should send a message", () => {
    const socket = new WorkerSocketAdapter(wsUrl);
    const message = BasicBuilder.string();

    socket.send(message);

    expect(workerMock.postMessage).toHaveBeenCalledWith({
      type: "data",
      data: message,
    });
  });

  it("WorkerSocketAdapter should handle an error", () => {
    workerMock.onmessage?.({
      data: { type: "error", error: "Something went wrong" },
    } as MessageEvent);

    expect(workerMock.postMessage).toHaveBeenCalledWith({
      type: "open",
      data: { wsUrl, protocols: undefined },
    });
  });

  it("WorkerSocketAdapter should hand each message of a batch to onmessage, in order", () => {
    const socket = new WorkerSocketAdapter(wsUrl);
    const received: unknown[] = [];
    socket.onmessage = (event) => received.push(event);
    const first = new ArrayBuffer(4);
    const second = BasicBuilder.string();

    workerMock.onmessage?.({
      data: { type: "messages", data: [first, second] },
    });

    expect(received).toEqual([{ data: first }, { data: second }]);
  });

  it("WorkerSocketAdapter should keep delivering a batch after a frame's handler throws", () => {
    const socket = new WorkerSocketAdapter(wsUrl);
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const error = new Error("bad frame");
    const received: unknown[] = [];
    socket.onmessage = (event) => {
      received.push(event);
      if (received.length === 1) {
        throw error;
      }
    };

    workerMock.onmessage?.({ data: { type: "messages", data: ["a", "b", "c"] } });

    expect(received).toEqual([{ data: "a" }, { data: "b" }, { data: "c" }]);
    expect(reportError).toHaveBeenCalledWith(error);
    vi.unstubAllGlobals();
  });

  it("WorkerSocketAdapter should stop delivering a batch once the socket closed", () => {
    const socket = new WorkerSocketAdapter(wsUrl);
    const received: unknown[] = [];
    socket.onmessage = (event) => {
      received.push(event);
      workerMock.onmessage?.({ data: { type: "close", data: {} } } as MessageEvent);
    };

    workerMock.onmessage?.({ data: { type: "messages", data: ["a", "b"] } });

    expect(received).toEqual([{ data: "a" }]);
  });

  it.each([
    [
      {
        data: { type: "open", protocol: BasicBuilder.string() },
      } as MessageEvent<FromWorkerMessage>,
    ],
    [
      {
        data: { type: "messages", data: [BasicBuilder.string()] },
      } as MessageEvent<FromWorkerMessage>,
    ],
    [{ data: { type: "close", data: undefined } } as MessageEvent<FromWorkerMessage>],
  ])("WorkerSocketAdapter should handle '%s' event", (event) => {
    workerMock.onmessage?.(event);
    expect(workerMock.postMessage).toHaveBeenCalledWith({
      type: "open",
      data: { wsUrl, protocols: undefined },
    });
  });
});
