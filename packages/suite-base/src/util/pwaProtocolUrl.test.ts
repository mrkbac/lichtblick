// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseAppURLState } from "./appURLState";
import { pwaProtocolUrl } from "./pwaProtocolUrl";

const appURL = new URL("https://example.com/studio/?ds=old#old");
const callback = (protocol: string) =>
  `https://example.com/studio/?protocol=${encodeURIComponent(protocol)}`;

describe("pwaProtocolUrl", () => {
  it("decodes once, preserves repeated URLs and signed query parameters, and uses the app path", () => {
    const remoteURL = "https://data.example/one.mcap?token=a%2Fb&part=2";
    const protocol = new URL("web+lichtblick://open");
    protocol.searchParams.append("ds", "remote-file");
    protocol.searchParams.append("ds.url", remoteURL);
    protocol.searchParams.append("ds.url", "https://data.example/two.mcap");
    protocol.searchParams.append("time", "123");
    const result = pwaProtocolUrl(callback(protocol.href), appURL)!;
    expect(result.origin + result.pathname).toBe("https://example.com/studio/");
    expect(result.hash).toBe("");
    expect(parseAppURLState(result)).toMatchObject({
      ds: "remote-file",
      dsParams: { url: `${remoteURL},https://data.example/two.mcap` },
      time: { sec: 123, nsec: 0 },
    });
  });

  it("supports session bundles, layouts and websocket connections", () => {
    for (const query of [
      "mcap-bundle=session-123",
      "layoutUrl=https%3A%2F%2Fexample.com%2Flayout.json",
      "ds=foxglove-websocket&ds.url=wss%3A%2F%2Fexample.com",
    ]) {
      expect(pwaProtocolUrl(callback(`web+lichtblick://open/?${query}`), appURL)?.search).toBe(
        `?${query}`,
      );
    }
  });

  it.each([
    "not a URL",
    "lichtblick://open?ds=remote-file",
    "javascript:alert(1)",
    "web+lichtblick://signin-complete?ds=test",
    "web+lichtblick://open/path?ds=test",
    "web+lichtblick://user:password@open?ds=test",
    "web+lichtblick://open:123?ds=test",
    "web+lichtblick://open?ds=test#fragment",
    "web+lichtblick://open?openIn=desktop",
    "web+lichtblick://open?ds.__proto__=x",
    "web+lichtblick://open?ds.constructor=x",
    "web+lichtblick://open?layoutUrl=javascript:alert(1)",
    "web+lichtblick://open?ds.url=file:///tmp/data.mcap",
    "web+lichtblick://open?ds.url=https://user:password@example.com/data.mcap",
    "web+lichtblick://open?ds.url=not-a-url",
    "web+lichtblick://open?ds.url=https://example.com/a.mcap,javascript:alert(1)",
  ])("rejects unsafe or unsupported input: %s", (protocol) => {
    expect(pwaProtocolUrl(callback(protocol), appURL)).toBeUndefined();
  });

  it.each([
    "https://other.example/studio/?protocol=web%2Blichtblick%3A%2F%2Fopen",
    "https://example.com/other/?protocol=web%2Blichtblick%3A%2F%2Fopen",
    "https://example.com/studio/?protocol=web%2Blichtblick%3A%2F%2Fopen&protocol=duplicate",
    "https://example.com/studio/?ds=remote-file",
    "not a URL",
  ])("rejects callbacks outside the app endpoint or without one protocol: %s", (url) => {
    expect(pwaProtocolUrl(url, appURL)).toBeUndefined();
  });
});
