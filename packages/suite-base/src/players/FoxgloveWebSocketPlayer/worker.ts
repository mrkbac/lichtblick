// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  FromWorkerMessage,
  ToWorkerMessage,
} from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/types";

let ws: WebSocket | undefined = undefined;

const post: (message: FromWorkerMessage, transfer: Transferable[]) => void = self.postMessage;

// Received messages go to the main thread in batches: one task there per batch instead of one per
// message. A batch is posted once the messages already queued here have been handled.
let batch: unknown[] = [];
let transfer: ArrayBuffer[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (batch.length > 0) {
    post({ type: "messages", data: batch }, transfer);
    batch = [];
    transfer = [];
  }
}

/** Posts everything received so far first, so the main thread sees events in order */
function send(message: FromWorkerMessage): void {
  flush();
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ToWorkerMessage>) => {
  const { type, data } = event.data;
  switch (type) {
    case "open":
      try {
        const socket = new WebSocket(data.wsUrl, data.protocols);
        ws = socket;
        ws.binaryType = "arraybuffer";
        ws.onerror = (wsEvent) => {
          send({
            type: "error",
            error: (wsEvent as unknown as { error: Error }).error,
          });
        };
        ws.onopen = (_event) => {
          send({
            type: "open",
            protocol: socket.protocol,
          });
        };
        ws.onclose = (wsEvent) => {
          const { code, reason, wasClean } = wsEvent;
          send({ type: "close", data: { code, reason, wasClean } });
        };
        ws.onmessage = (wsEvent: MessageEvent) => {
          batch.push(wsEvent.data);
          if (wsEvent.data instanceof ArrayBuffer) {
            transfer.push(wsEvent.data);
          }
          flushTimer ??= setTimeout(flush, 0);
        };
      } catch (err: unknown) {
        // try-catch is needed to catch `Mixed Content` errors in Chrome, where the client
        // attempts to load `ws://` from `https://`. (Safari would catch these in `ws.onerror`
        // but with `undefined` as an error.)
        send({
          type: "error",
          error: err ?? { message: "Insecure WebSocket connection" },
        });
        // No socket exists to emit a close, so report one: the player then shows the failure and
        // schedules its retry instead of waiting forever.
        send({
          type: "close",
          data: { code: 1006, reason: err instanceof Error ? err.message : "", wasClean: false },
        });
      }
      break;
    case "close":
      ws?.close();
      break;
    case "data":
      ws?.send(data as string | BufferSource);
      break;
  }
};
