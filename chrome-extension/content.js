// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Bridges the page to the service worker. The page opens each socket by posting
// a MessagePort to this script; all traffic for that socket then runs over that
// private port (structured clone, ArrayBuffers transferred), never over window.
// The hop to the service worker is JSON, so binary frames cross it as base64.

const OPEN_TYPE = "licht-ws-proxy:open";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) {
    return;
  }
  const msg = event.data;
  const pagePort = event.ports[0];
  if (msg?.type !== OPEN_TYPE || typeof msg.url !== "string" || pagePort == undefined) {
    return;
  }

  let worker;
  try {
    worker = chrome.runtime.connect({ name: "ws" });
  } catch {
    // Extension was reloaded or removed; this page's script is orphaned.
    pagePort.postMessage({ ev: "close", code: 1011, reason: "Proxy extension unavailable" });
    pagePort.close();
    return;
  }
  let closed = false;

  pagePort.postMessage({ ev: "attached" });

  worker.onMessage.addListener((m) => {
    if (m.ev === "message" && m.b64 != undefined) {
      const data = Uint8Array.fromBase64(m.b64).buffer;
      pagePort.postMessage({ ev: "message", data }, [data]);
      return;
    }
    if (m.ev === "close") {
      closed = true;
    }
    pagePort.postMessage(m);
  });
  worker.onDisconnect.addListener(() => {
    if (!closed) {
      pagePort.postMessage({ ev: "close", code: 1006, reason: "Proxy disconnected" });
    }
    pagePort.close();
  });

  pagePort.onmessage = ({ data: m }) => {
    if (m?.cmd === "send") {
      const { data } = m;
      if (typeof data === "string") {
        worker.postMessage({ cmd: "send", text: data });
      } else if (data instanceof ArrayBuffer) {
        worker.postMessage({ cmd: "send", b64: new Uint8Array(data).toBase64() });
      }
    } else if (m?.cmd === "close") {
      closed = true;
      worker.disconnect();
      pagePort.close();
    }
  };

  worker.postMessage({ cmd: "open", url: msg.url, protocols: msg.protocols });
});
