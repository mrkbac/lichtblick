// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Opens the real ws:// socket. The service worker runs at chrome-extension://,
// where Chrome's mixed-content block does not apply, so it can reach plain ws://
// servers that an https page cannot. One runtime port per socket.
//
// An open WebSocket keeps the service worker alive (Chrome 116+).

const ALLOWED_ORIGIN = "https://licht.marko.im";

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ws" || port.sender?.origin !== ALLOWED_ORIGIN) {
    port.disconnect();
    return;
  }

  /** @type {WebSocket | undefined} */
  let ws;

  const post = (msg) => {
    try {
      port.postMessage(msg);
    } catch {
      // Port is gone; onDisconnect closes the socket.
    }
  };
  const fail = (reason) => {
    post({ ev: "error", message: reason });
    post({ ev: "close", code: 1006, reason, wasClean: false });
    port.disconnect();
  };

  port.onMessage.addListener((msg) => {
    if (msg.cmd === "open") {
      if (ws != undefined) {
        return;
      }
      let url;
      try {
        url = new URL(msg.url);
      } catch {
        fail("Invalid URL");
        return;
      }
      // wss:// and loopback work without the proxy; only relay what the page can't reach.
      if (url.protocol !== "ws:") {
        fail("Proxy only relays ws:// URLs");
        return;
      }
      const protocols = Array.isArray(msg.protocols)
        ? msg.protocols.filter((p) => typeof p === "string")
        : [];
      try {
        ws = new WebSocket(url, protocols);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        return;
      }
      ws.binaryType = "arraybuffer";
      ws.onopen = () => post({ ev: "open", protocol: ws.protocol });
      ws.onmessage = ({ data }) => {
        post(
          typeof data === "string"
            ? { ev: "message", text: data }
            : { ev: "message", b64: new Uint8Array(data).toBase64() },
        );
      };
      ws.onerror = () => post({ ev: "error", message: `WebSocket error for ${url.href}` });
      ws.onclose = ({ code, reason, wasClean }) => {
        post({ ev: "close", code, reason, wasClean });
        port.disconnect();
      };
    } else if (msg.cmd === "send") {
      if (ws?.readyState !== WebSocket.OPEN) {
        return;
      }
      ws.send(msg.text ?? Uint8Array.fromBase64(msg.b64));
    }
  });

  port.onDisconnect.addListener(() => {
    ws?.close();
  });
});
