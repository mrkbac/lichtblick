# Licht WebSocket proxy (Chrome extension)

Chrome blocks an `https://` page from opening a `ws://` socket to anything but
loopback (mixed content). This extension lets https://licht.marko.im connect to
plain `ws://` Foxglove WebSocket servers anyway, without the "Not Secure" badge.

```
page ──MessagePort──▶ content.js ──runtime port (JSON)──▶ background.js ──ws://──▶ server
```

The app uses it automatically when the page is `https:` and the URL is a
non-loopback `ws://` (`ExtensionProxySocket.ts` in the Foxglove WebSocket player).
`wss://` and `ws://localhost` connect directly.

## Install

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → pick this `chrome-extension/` folder.
3. Reload licht.marko.im.
4. Remove the "Insecure content → Allow" site setting if you set it earlier.

## Scope

- Runs only on `https://licht.marko.im/*` (content script match, re-checked by the
  service worker via the sender origin).
- Asks for no permissions; relays only `ws://` URLs.
- Binary frames cross the worker hop as base64, so very high-rate topics are
  slower than a direct `wss://` connection.
