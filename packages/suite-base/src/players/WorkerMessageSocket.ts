// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { IWebSocket } from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/protocol/protocol";

import { ToWorkerMessage, FromWorkerMessage } from "./FoxgloveWebSocketPlayer/types";

export default class WorkerMessageSocket implements IWebSocket {
  #worker: Worker | MessagePort;
  #onClosed?: () => void;
  #connectionClosed: boolean = false;
  public binaryType: string = "";
  public protocol: string = "";
  public onerror: ((event: unknown) => void) | undefined = undefined;
  public onopen: ((event: unknown) => void) | undefined = undefined;
  public onclose: ((event: unknown) => void) | undefined = undefined;
  public onmessage: ((event: unknown) => void) | undefined = undefined;

  public constructor(
    endpoint: Worker | MessagePort,
    wsUrl: string,
    protocols?: string[] | string,
    onClosed?: () => void,
  ) {
    this.#worker = endpoint;
    this.#onClosed = onClosed;
    this.#sendToWorker({ type: "open", data: { wsUrl, protocols } });

    if ("onerror" in this.#worker) {
      this.#worker.onerror = (ev) => {
        this.onerror?.(ev);
        this.#finish({ code: 1006, reason: "Connection worker failed" });
      };
    }

    this.#worker.onmessage = (event: MessageEvent<FromWorkerMessage>) => {
      if (event.data.type !== "messages" && this.#connectionClosed) {
        return;
      }
      switch (event.data.type) {
        case "open":
          this.protocol = event.data.protocol;
          if (this.onopen) {
            this.onopen(event.data);
          }
          break;
        case "close":
          this.#finish(event.data.data);
          break;
        case "error":
          if (this.onerror) {
            this.onerror(event.data);
          }
          break;
        case "messages":
          for (const data of event.data.data) {
            if (this.#connectionClosed) {
              break;
            }
            // Each frame used to be its own task: a throw for one frame is reported like an
            // uncaught error and doesn't drop the frames after it
            try {
              this.onmessage?.({ data });
            } catch (error) {
              reportError(error);
            }
          }
          break;
        case "message":
          try {
            this.onmessage?.(event.data);
          } finally {
            if (event.data.acknowledge === true) {
              this.#worker.postMessage({
                type: "drained",
                data: undefined,
              } satisfies ToWorkerMessage);
            }
          }
          break;
      }
    };
  }

  /** The transport owner can end the stream even when its worker can no longer post events. */
  public fail(reason: string): void {
    this.#finish({ code: 1006, reason, retryable: false });
  }

  #finish(event: unknown): void {
    if (this.#connectionClosed) {
      return;
    }
    this.#connectionClosed = true;
    if ("terminate" in this.#worker) {
      this.#worker.terminate();
    } else {
      this.#worker.close();
    }
    this.#onClosed?.();
    this.onclose?.(event);
  }

  public close(): void {
    if (!this.#connectionClosed) {
      this.#sendToWorker({
        type: "close",
        data: undefined,
      });
    }
  }

  public send(data: string | ArrayBuffer | ArrayBufferView): void {
    this.#sendToWorker({ type: "data", data });
  }

  #sendToWorker(msg: ToWorkerMessage): void {
    if (this.#connectionClosed) {
      throw Error("Can't send message over closed websocket connection");
    }
    this.#worker.postMessage(msg);
  }
}
