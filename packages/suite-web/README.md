# @lichtblick/suite-web

This is an internal package used for bundling the Lichtblick web app. Its API is not considered public or stable.

## Installed PWA protocol links

Supported desktop Chromium browsers can register the installed HTTPS app for
`web+lichtblick://open` links. The browser may ask the user to approve handling
these links; registration and OS integration depend on the browser/platform.
Safari, Firefox and mobile browsers should use ordinary HTTPS app links instead.
The Electron app continues to use `lichtblick://`; a PWA cannot register that
unprefixed custom scheme.

Use the existing app query parameters, for example:

```text
web+lichtblick://open?ds=remote-file&ds.url=https%3A%2F%2Fexample.com%2Frecording.mcap
web+lichtblick://open?ds=foxglove-websocket&ds.url=wss%3A%2F%2Frobot.example.com
web+lichtblick://open?mcap-bundle=session-id
web+lichtblick://open?time=123
```

`layoutUrl` is also supported. Encode each query value with `URLSearchParams`,
especially URLs containing their own query strings or signed tokens. Remote
addresses must use HTTP(S) or WS(S); layouts require HTTP(S). URL userinfo,
other commands, and unknown query parameters are rejected. Connection and layout
loading still follow the existing app validation and browser network rules.

The manifest sends the encoded link to `./?protocol=%s`, relative to the installed
app scope. Cold launches load the requested state; with `focus-existing`, queued
launches apply it in the current workspace without reloading the page. A time-only
link seeks the current recording. A link specifying a source replaces that source;
ordinary app activations and invalid protocol links leave the session alone.
File launches continue through the same launch queue consumer.
Superseded layout downloads and imports are cancelled. A storage write already
underway may leave an unused saved layout copy after cancellation.

To validate OS integration manually, install the app, approve protocol handling,
and open a link from another application both with the PWA closed and already
open. Check a time-only link with a recording open, then open a supported file
through the OS. Browser tests simulate the launch queue; they do not verify OS
registration or permission dialogs.
