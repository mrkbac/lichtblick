// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { IWebSocket } from "@foxglove/ws-protocol";

// Page half of the WebSocket proxy extension in chrome-extension/. Chrome blocks an https
// page from opening ws:// to a non-loopback host (mixed content); the extension can, so we
// hand it a MessagePort and run the socket's traffic over that port.

const OPEN_TYPE = "licht-ws-proxy:open";
const ATTACH_TIMEOUT_MS = 1000;
// Also sent by chrome-extension/content.js when the extension was reloaded or removed.
export const PROXY_MISSING_REASON = "WebSocket proxy extension unavailable";

type FromProxy =
  | { ev: "attached" }
  | { ev: "open"; protocol: string }
  | { ev: "message"; data?: ArrayBuffer; text?: string }
  | { ev: "error"; message: string }
  | { ev: "close"; code: number; reason: string; wasClean?: boolean };

type CloseEventLike = { code: number; reason: string; wasClean: boolean };

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

// Origins the extension's content script runs on (chrome-extension/manifest.json). Elsewhere
// keep the direct socket: Chrome may still allow it (e.g. local network access).
const PROXY_ORIGINS = new Set(["https://licht.marko.im"]);

/** True when this page can use the proxy and the browser would block the socket directly. */
export function needsExtensionProxy(
  url: string,
  pageOrigin: string | undefined = typeof window === "undefined"
    ? undefined
    : window.location.origin,
): boolean {
  if (pageOrigin == undefined || !PROXY_ORIGINS.has(pageOrigin)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "ws:" && !isLoopback(parsed.hostname);
}

export default class ExtensionProxySocket implements IWebSocket {
  public binaryType: string = "";
  public protocol: string = "";
  public onerror: ((event: unknown) => void) | undefined = undefined;
  public onopen: ((event: unknown) => void) | undefined = undefined;
  public onclose: ((event: unknown) => void) | undefined = undefined;
  public onmessage: ((event: unknown) => void) | undefined = undefined;

  #port: MessagePort;
  #closed = false;
  #attachTimeout: ReturnType<typeof setTimeout>;

  public constructor(url: string, protocols?: string[] | string) {
    const channel = new MessageChannel();
    this.#port = channel.port1;
    this.#port.onmessage = (event: MessageEvent<FromProxy>) => {
      this.#handle(event.data);
    };
    window.postMessage({ type: OPEN_TYPE, url, protocols }, window.location.origin, [
      channel.port2,
    ]);
    // No content script answered: the extension isn't installed or doesn't run on this origin.
    this.#attachTimeout = setTimeout(() => {
      this.#finish({ code: 1006, reason: PROXY_MISSING_REASON, wasClean: false });
    }, ATTACH_TIMEOUT_MS);
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    this.#port.postMessage({ cmd: "close" });
    // A native socket fires close asynchronously after close(); keep that contract.
    setTimeout(() => {
      this.#finish({ code: 1000, reason: "", wasClean: true });
    }, 0);
  }

  public send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.#closed) {
      throw new Error("Can't send message over closed websocket connection");
    }
    if (typeof data === "string") {
      this.#port.postMessage({ cmd: "send", data });
      return;
    }
    // Copy so the caller keeps its buffer; transfer the copy.
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
      : new Uint8Array(data).slice();
    this.#port.postMessage({ cmd: "send", data: bytes.buffer }, [bytes.buffer]);
  }

  #handle(msg: FromProxy): void {
    if (this.#closed) {
      return;
    }
    switch (msg.ev) {
      case "attached":
        clearTimeout(this.#attachTimeout);
        break;
      case "open":
        this.protocol = msg.protocol;
        this.onopen?.({});
        break;
      case "message":
        this.onmessage?.({ data: msg.data ?? msg.text });
        break;
      case "error":
        this.onerror?.({ error: new Error(msg.message) });
        break;
      case "close":
        this.#finish({ code: msg.code, reason: msg.reason, wasClean: msg.wasClean ?? false });
        break;
    }
  }

  #finish(event: CloseEventLike): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    clearTimeout(this.#attachTimeout);
    this.#port.close();
    this.onclose?.(event);
  }
}
