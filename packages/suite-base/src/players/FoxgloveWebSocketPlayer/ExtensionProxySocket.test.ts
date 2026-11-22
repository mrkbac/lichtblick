/** @vitest-environment jsdom */
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ExtensionProxySocket, {
  isMixedContentWs,
  needsExtensionProxy,
  PROXY_MISSING_REASON,
  resetExtensionMissingForTests,
} from "./ExtensionProxySocket";

describe("needsExtensionProxy", () => {
  it.each([
    ["ws://robot.example:8765", "https://licht.marko.im", true],
    ["ws://10.0.0.5:8765", "https://licht.marko.im", true],
    ["wss://robot.example:8765", "https://licht.marko.im", false],
    ["ws://localhost:8765", "https://licht.marko.im", false],
    ["ws://app.localhost:8765", "https://licht.marko.im", false],
    ["ws://127.0.0.1:8765", "https://licht.marko.im", false],
    ["ws://[::1]:8765", "https://licht.marko.im", false],
    ["ws://robot.example:8765", "http://licht.marko.im", false],
    ["ws://robot.example:8765", "https://preview.example", false],
    ["ws://robot.example:8765", "file://", false],
    ["not a url", "https://licht.marko.im", false],
  ])("%s from %s → %s", (url, pageOrigin, expected) => {
    expect(needsExtensionProxy(url, pageOrigin)).toBe(expected);
  });
});

describe("isMixedContentWs", () => {
  it.each([
    ["ws://robot.example:8765", "https://preview.example", true],
    ["ws://localhost:8765", "https://preview.example", false],
    ["wss://robot.example:8765", "https://preview.example", false],
    ["ws://robot.example:8765", "http://preview.example", false],
  ])("%s from %s → %s", (url, pageOrigin, expected) => {
    expect(isMixedContentWs(url, pageOrigin)).toBe(expected);
  });
});

describe("ExtensionProxySocket without the extension", () => {
  afterEach(() => {
    resetExtensionMissingForTests();
    vi.useRealTimers();
  });

  it("closes with PROXY_MISSING_REASON and lets later sockets connect directly", () => {
    vi.useFakeTimers();
    const url = "ws://robot.example:8765";
    const socket = new ExtensionProxySocket(url);
    const onclose = vi.fn();
    socket.onclose = onclose;
    vi.advanceTimersByTime(1000);
    expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ reason: PROXY_MISSING_REASON }));
    expect(needsExtensionProxy(url, "https://licht.marko.im")).toBe(false);
  });
});
