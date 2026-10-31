// Lichtblick ws:// proxy — page (MAIN world) script.
//
// Replaces window.WebSocket so `new WebSocket("ws://…")` from the HTTPS page is
// relayed through the extension (content.js -> background.js) instead of being
// blocked as mixed content. wss:// and everything else uses the native class.
// Sets <html data-ws-proxy> so the app knows to open sockets on the main thread
// (workers get the native, unpatched WebSocket).

(() => {
  const TAG = "lichtblick-ws-proxy";
  const NativeWebSocket = window.WebSocket;
  const toCS = (obj) =>
    window.postMessage({ [TAG]: true, dir: "toCS", ...obj }, "*");
  let nextId = 1;

  class ProxyWebSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    CONNECTING = 0;
    OPEN = 1;
    CLOSING = 2;
    CLOSED = 3;
    binaryType = "arraybuffer";
    protocol = "";
    extensions = "";
    bufferedAmount = 0;
    readyState = 0;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    #id = nextId++;

    constructor(url, protocols) {
      super();
      this.url = url;
      window.addEventListener("message", this.#onWindowMessage);
      const list = protocols == undefined ? [] : [].concat(protocols);
      toCS({ cmd: "open", id: this.#id, url, protocols: list });
    }

    send(data) {
      if (this.readyState !== 1)
        throw new DOMException("WebSocket is not open", "InvalidStateError");
      if (typeof data === "string")
        return toCS({ cmd: "send", id: this.#id, data, isBinary: false });
      const buf =
        data instanceof ArrayBuffer
          ? data
          : data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength,
            );
      toCS({ cmd: "send", id: this.#id, data: buf, isBinary: true });
    }

    close(code, reason) {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      toCS({ cmd: "close", id: this.#id, code, reason });
    }

    #onWindowMessage = (ev) => {
      const m = ev.data;
      if (
        ev.source !== window ||
        !m ||
        m[TAG] !== true ||
        m.dir !== "toPage" ||
        m.id !== this.#id
      )
        return;
      if (m.ev === "open") {
        this.readyState = 1;
        this.protocol = m.protocol || "";
        this.#emit(new Event("open"), this.onopen);
      } else if (m.ev === "message") {
        this.#emit(
          new MessageEvent("message", { data: m.data }),
          this.onmessage,
        );
      } else if (m.ev === "error") {
        this.#emit(new Event("error"), this.onerror);
      } else if (m.ev === "close") {
        this.readyState = 3;
        window.removeEventListener("message", this.#onWindowMessage);
        const init = {
          code: m.code ?? 1006,
          reason: m.reason ?? "",
          wasClean: m.wasClean === true,
        };
        this.#emit(new CloseEvent("close", init), this.onclose);
      }
    };

    #emit(ev, handler) {
      handler?.call(this, ev);
      this.dispatchEvent(ev);
    }
  }

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const url = new URL(args[0], location.href);
      if (url.protocol === "ws:") return new ProxyWebSocket(url.href, args[1]);
      return Reflect.construct(target, args, newTarget);
    },
  });
  document.documentElement.dataset.wsProxy = "1";
})();
