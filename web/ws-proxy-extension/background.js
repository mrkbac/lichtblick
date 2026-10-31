// Lichtblick ws:// proxy — MV3 service worker.
//
// Lichtblick is served over HTTPS (Cloudflare Pages). A secure page may not open
// an insecure ws:// socket to a non-loopback host — the browser blocks it as
// mixed content. This service worker is the one context that CAN open it: it runs
// at chrome-extension:// (a secure context) and, with host_permissions, is exempt
// from the mixed-content rule for its granted hosts. So it opens the real socket
// on the page's behalf and relays traffic.
//
// Topology:  page  <--window.postMessage-->  content.js  <--runtime.Port-->  [here] --ws://--> bridge
//
// One content-script Port === one WebSocket (port.name = "lichtblick-ws:<id>"). The
// content script owns the id namespace; we just proxy. Binary frames cross the
// runtime.Port as base64 (runtime messaging is JSON-serialized — ArrayBuffers do
// not survive it); content.js decodes back to real ArrayBuffers for the page.

const PORT_PREFIX = "lichtblick-ws:";
const DEBUG = false; // logs to the service-worker console (chrome://extensions → inspect)
const log = (...a) => DEBUG && console.log("[lichtblick-ws-proxy/sw]", ...a);

/** Base64-encode an ArrayBuffer in chunks (avoids arg-count limits on spread). */
function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** Decode base64 → ArrayBuffer. */
function b64decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name || !port.name.startsWith(PORT_PREFIX)) return;
  log("port connected:", port.name);

  /** @type {WebSocket | null} */
  let ws = null;
  let rx = 0;

  const safePost = (msg) => {
    try {
      port.postMessage(msg);
    } catch {
      // Port already disconnected (page navigated away). Drop the socket.
      try {
        ws?.close();
      } catch {
        /* already closing */
      }
      ws = null;
    }
  };

  port.onMessage.addListener((msg) => {
    try {
      if (msg.cmd === "open") {
        log("opening", msg.url, "protocols:", msg.protocols);
        ws = new WebSocket(msg.url, msg.protocols || []);
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          log("ws OPEN", msg.url, "subprotocol:", ws.protocol || "(none)");
          safePost({ ev: "open", protocol: ws.protocol });
        };
        ws.onmessage = (e) => {
          rx++;
          if (rx <= 3 || rx % 500 === 0)
            log(
              `ws msg #${rx}`,
              typeof e.data === "string"
                ? e.data.slice(0, 80)
                : `${e.data.byteLength}B binary`,
            );
          if (typeof e.data === "string")
            safePost({ ev: "message", text: e.data });
          else safePost({ ev: "message", b64: b64encode(e.data) });
        };
        ws.onerror = () => {
          log("ws ERROR", msg.url);
          safePost({ ev: "error", message: "WebSocket error" });
        };
        ws.onclose = (e) => {
          log(
            "ws CLOSE",
            msg.url,
            "code:",
            e.code,
            "reason:",
            e.reason || "(none)",
          );
          safePost({
            ev: "close",
            code: e.code,
            reason: e.reason,
            wasClean: e.wasClean,
          });
        };
      } else if (msg.cmd === "send") {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (msg.text !== undefined) ws.send(msg.text);
        else if (msg.b64 !== undefined) ws.send(b64decode(msg.b64));
      } else if (msg.cmd === "close") {
        try {
          ws?.close(msg.code, msg.reason);
        } catch {
          /* invalid code / already closing */
        }
      }
    } catch (err) {
      safePost({
        ev: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  port.onDisconnect.addListener(() => {
    try {
      ws?.close();
    } catch {
      /* already closing */
    }
    ws = null;
  });
});
