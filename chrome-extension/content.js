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
    pagePort.postMessage({
      ev: "close",
      code: 1011,
      reason: "WebSocket proxy extension unavailable",
    });
    pagePort.close();
    return;
  }
  let closed = false;
  // An idle WebSocket doesn't keep the service worker alive; incoming port messages
  // reset its 30 s idle timer, so ping while this socket is open.
  const keepalive = setInterval(() => {
    worker.postMessage({ cmd: "ping" });
  }, 20_000);

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
    clearInterval(keepalive);
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
      clearInterval(keepalive);
      worker.disconnect();
      pagePort.close();
    }
  };

  worker.postMessage({ cmd: "open", url: msg.url, protocols: msg.protocols });
});

// HTTP relay: one MessagePort per request, from the page or from a worker's channel port.
// Response chunks cross the worker hop as base64, like WebSocket frames.

const FETCH_TYPE = "licht-http-proxy:fetch";
const CHANNEL_TYPE = "licht-http-proxy:channel";

function relayFetch(msg, pagePort) {
  if (msg?.type !== FETCH_TYPE || typeof msg.url !== "string" || pagePort == undefined) {
    return;
  }
  let worker;
  try {
    worker = chrome.runtime.connect({ name: "http" });
  } catch {
    pagePort.postMessage({
      ev: "error",
      message: "HTTP proxy extension unavailable",
      missing: true,
    });
    pagePort.close();
    return;
  }
  let done = false;
  // Port messages keep the service worker alive while it waits for a slow server
  const keepalive = setInterval(() => {
    worker.postMessage({ cmd: "ping" });
  }, 20_000);
  const stop = () => {
    clearInterval(keepalive);
    pagePort.close();
  };

  pagePort.postMessage({ ev: "attached" });
  worker.onMessage.addListener((m) => {
    if (m.ev === "chunk") {
      const data = Uint8Array.fromBase64(m.b64).buffer;
      pagePort.postMessage({ ev: "chunk", data }, [data]);
      return;
    }
    pagePort.postMessage(m);
    if (m.ev === "end" || m.ev === "error") {
      done = true;
      worker.disconnect();
      stop();
    }
  });
  worker.onDisconnect.addListener(() => {
    if (!done) {
      pagePort.postMessage({ ev: "error", message: "Proxy disconnected" });
    }
    stop();
  });
  pagePort.onmessage = ({ data: m }) => {
    if (m?.cmd === "abort") {
      done = true;
      worker.disconnect();
      stop();
    }
  };
  worker.postMessage({
    cmd: "fetch",
    url: msg.url,
    method: msg.method,
    headers: msg.headers,
    credentials: msg.credentials,
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) {
    return;
  }
  const channel = event.ports[0];
  if (event.data?.type === CHANNEL_TYPE && channel != undefined) {
    // A worker's requests: each message carries that request's own port
    channel.onmessage = ({ data, ports }) => relayFetch(data, ports[0]);
    return;
  }
  relayFetch(event.data, channel);
});
