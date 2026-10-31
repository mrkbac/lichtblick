// Lichtblick ws:// proxy — content script.
//
// Injected into Lichtblick pages. Bridges the page (which cannot open insecure ws://
// from an HTTPS origin) to the extension service worker (which can). It speaks
// window.postMessage to the page and a runtime.Port per socket to the worker.
//
// Why a content script and not externally_connectable? A content script needs no
// hardcoded extension id — the page discovers the proxy by a handshake. And the
// page↔content hop uses structured clone, so real ArrayBuffers move without
// base64; only the content↔worker hop (JSON) needs base64, handled here.

(() => {
  const TAG = "lichtblick-ws-proxy"; // marks our messages so the page/CS ignore others
  const DEBUG = false; // logs to the PAGE console (the app tab's DevTools)
  const log = (...a) =>
    DEBUG && console.log("[lichtblick-ws-proxy/content]", ...a);
  log("injected on", location.origin);

  /** @type {Map<string, chrome.runtime.Port>} */
  const ports = new Map();

  const toPage = (obj) =>
    window.postMessage({ [TAG]: true, dir: "toPage", ...obj }, "*");

  // Tell the page the proxy is present. Sent on load and in reply to "detect".
  const announce = () => toPage({ ev: "ready" });

  function b64encode(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function b64decode(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function openSocket(id, url, protocols) {
    let port;
    try {
      port = chrome.runtime.connect({ name: `lichtblick-ws:${id}` });
    } catch (e) {
      // chrome.runtime.connect throws when the extension context is invalidated
      // (e.g. the extension was updated/reloaded mid-session). Report a close so
      // the page's ProxyWebSocket rejects promptly instead of hanging forever.
      log("connect failed:", e && e.message);
      toPage({
        id,
        ev: "close",
        code: 1011,
        reason: "extension unavailable",
        wasClean: false,
      });
      return;
    }
    ports.set(id, port);
    port.onMessage.addListener((m) => {
      if (m.ev === "message") {
        if (m.b64 !== undefined)
          toPage({ id, ev: "message", data: b64decode(m.b64), isBinary: true });
        else toPage({ id, ev: "message", data: m.text, isBinary: false });
      } else {
        toPage({ id, ...m });
      }
    });
    port.onDisconnect.addListener(() => {
      ports.delete(id);
      toPage({
        id,
        ev: "close",
        code: 1006,
        reason: "proxy disconnected",
        wasClean: false,
      });
    });
    port.postMessage({ cmd: "open", url, protocols });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg[TAG] !== true || msg.dir !== "toCS") return;

    if (msg.cmd === "detect") {
      log("detect ping ← page; announcing ready");
      announce();
      return;
    }
    if (msg.cmd === "open") {
      log("open ← page:", msg.url);
      openSocket(msg.id, msg.url, msg.protocols);
      return;
    }
    const port = ports.get(msg.id);
    if (!port) return;
    if (msg.cmd === "send") {
      if (msg.isBinary)
        port.postMessage({ cmd: "send", b64: b64encode(msg.data) });
      else port.postMessage({ cmd: "send", text: msg.data });
    } else if (msg.cmd === "close") {
      port.postMessage({ cmd: "close", code: msg.code, reason: msg.reason });
    }
  });

  announce();
})();
