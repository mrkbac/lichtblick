// SPDX-License-Identifier: MPL-2.0

import type {
  FromWorkerMessage,
  ToWorkerMessage,
} from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/types";

import type { IPN, IPNWebSocket } from "./ipnTypes";

// Bound frames queued on a busy/background tab. Pausing the iterator lets the tailnet's
// receive buffer apply TCP backpressure without discarding camera frames or control messages.
const BATCH_BYTES = 1024 * 1024;
const BATCH_FRAMES = 64;

export function attachStream(
  node: Pick<IPN, "websocket">,
  port: MessagePort,
  abort: AbortController,
  onEnd: () => void,
): void {
  let socket: IPNWebSocket | undefined;
  let drained: PromiseWithResolvers<void> | undefined;
  const resume = () => {
    drained?.resolve();
  };
  abort.signal.addEventListener("abort", resume);
  const post = (event: FromWorkerMessage, transfer: Transferable[] = []) => {
    port.postMessage(event, transfer);
  };
  async function open(url: string, protocols?: string | string[]) {
    try {
      socket = await node.websocket({ url, protocols, signal: abort.signal });
      abort.signal.throwIfAborted();
      post({ type: "open", protocol: socket.protocol });
      let bytes = 0;
      let frames = 0;
      for await (const frame of socket.messages) {
        abort.signal.throwIfAborted();
        bytes += typeof frame === "string" ? frame.length * 2 : frame.byteLength;
        const acknowledge = ++frames >= BATCH_FRAMES || bytes >= BATCH_BYTES;
        if (typeof frame === "string") {
          post({ type: "message", data: frame, acknowledge });
        } else {
          const data =
            frame.buffer instanceof ArrayBuffer &&
            frame.byteOffset === 0 &&
            frame.byteLength === frame.buffer.byteLength
              ? frame.buffer
              : frame.slice().buffer;
          post({ type: "message", data, acknowledge }, [data]);
        }
        if (acknowledge) {
          drained = Promise.withResolvers<void>();
          await drained.promise;
          abort.signal.throwIfAborted();
          drained = undefined;
          bytes = 0;
          frames = 0;
        }
      }
      post({ type: "close", data: await socket.closed });
    } catch (error) {
      if (!abort.signal.aborted) {
        post({ type: "error", error: error instanceof Error ? error : new Error(String(error)) });
        abort.abort();
      }
      post({ type: "close", data: { code: 1006, reason: "Tailscale connection closed" } });
    } finally {
      abort.signal.removeEventListener("abort", resume);
      onEnd();
      port.close();
    }
  }
  port.onmessage = ({ data: msg }: MessageEvent<ToWorkerMessage>) => {
    if (msg.type === "open") {
      void open(msg.data.wsUrl, msg.data.protocols);
    } else if (msg.type === "close") {
      abort.abort();
    } else if (msg.type === "drained") {
      resume();
    } else {
      const value = msg.data;
      const err = socket?.send(
        ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : value,
      );
      if (err) {
        abort.abort(err);
      }
    }
  };
}
