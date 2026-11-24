# Digitalis proxy (Chrome extension)

Chrome blocks an `https://` page from opening a `ws://` socket or fetching an
`http://` URL on anything but loopback (mixed content). This extension lets
Digitalis connect to plain `ws://` Foxglove WebSocket servers, and open `http://`
catalogs, recordings, layouts and thumbnails, without the "Not Secure" badge.

```
page ──MessagePort──▶ content.js ──runtime port (JSON)──▶ background.js ──ws://──▶ server
```

The app uses it automatically when the page is `https:` and the URL is a
non-loopback `ws://` (`ExtensionProxySocket.ts` in the Foxglove WebSocket player)
or `http://` (`util/httpProxy.ts`). `wss://`, `https://` and loopback connect
directly. Data source workers can't reach the content script, so the main thread
passes each one a channel port to it.

```
page/worker ──MessagePort──▶ content.js ──runtime port (JSON)──▶ background.js ──http://──▶ server
```

HTTP requests run from the extension's origin, so the server still needs CORS
headers (`Access-Control-Allow-Origin`, and `Access-Control-Expose-Headers` for
`Content-Range`/`Accept-Ranges` on recordings), as for a direct fetch.

## Install

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this `chrome-extension/` folder.
3. Reload the extension if previously installed, then reload the Digitalis tab.
4. Remove the "Insecure content → Allow" site setting if you set it earlier.

## Scope

- Runs only on `https://digitalis.marko.im/*` and `https://licht.marko.im/*` (content script match, re-checked by the
  service worker via the sender origin).
- Asks for no permissions; relays only `ws://` and `http://` URLs.
- Binary frames and response bodies cross the worker hop as base64, so very
  high-rate topics and large downloads are slower than `wss://`/`https://`.
