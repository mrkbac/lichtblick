// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  detectConnection,
  formatTimeAgo,
  splitRecentTitle,
  hostUrl,
  looksLikeHost,
} from "./recentSources";

describe("splitRecentTitle", () => {
  it("puts the file name first for URLs pointing at a file", () => {
    expect(splitRecentTitle("ws://localhost:8766/ws/some%20dir/example.mcap")).toEqual({
      primary: "example.mcap",
      location: "localhost:8766/ws/some dir",
    });
  });

  it("uses host and path for plain servers", () => {
    expect(splitRecentTitle("ws://localhost:8765/path")).toEqual({
      primary: "localhost:8765/path",
    });
  });

  it("keeps non-URL titles as is", () => {
    expect(splitRecentTitle("a.mcap, b.mcap")).toEqual({
      primary: "a.mcap, b.mcap",
    });
  });
});

describe("formatTimeAgo", () => {
  const now = 1_700_000_000_000;
  it("picks the largest fitting unit", () => {
    expect(formatTimeAgo(now - 3 * 60 * 60 * 1000, now, "en")).toBe("3 hours ago");
    expect(formatTimeAgo(now - 24 * 60 * 60 * 1000, now, "en")).toBe("yesterday");
    expect(formatTimeAgo(now, now, "en")).toBe("now");
  });
});

describe("detectConnection", () => {
  it.each([
    ["ws://localhost:8765", "foxglove-websocket", "ws://localhost:8765"],
    ["localhost:8765", "foxglove-websocket", "ws://localhost:8765"],
    [
      "wss://example.com/ws/example.mcap",
      "foxglove-websocket",
      "wss://example.com/ws/example.mcap",
    ],
    ["ws://localhost:9090", "rosbridge-websocket", "ws://localhost:9090"],
    ["https://example.com/example.MCAP", "remote-file", "https://example.com/example.MCAP"],
    [
      "https://example.com/a.bag,https://example.com/b.bag",
      "remote-file",
      "https://example.com/a.bag,https://example.com/b.bag",
    ],
    ["http://localhost:11311", "ros1-socket", "http://localhost:11311"],
  ])("%s -> %s", (input, sourceId, url) => {
    expect(detectConnection(input)).toEqual({ sourceId, url });
  });

  it.each(["", "not a url", "odom", "https://example.com/page"])("rejects %j", (input) => {
    expect(detectConnection(input)).toBeUndefined();
  });
});

describe("looksLikeHost", () => {
  it.each([
    ["robot.local", true],
    ["192.168.1.5", true],
    ["localhost", true],
    ["drive.mcap", false],
    ["robot-1", true],
    ["robot", true],
    ["-robot", false],
    ["topic:/camera", false],
    ["two words", false],
  ])("%s -> %s", (input, expected) => {
    expect(looksLikeHost(input)).toBe(expected);
  });

  it("builds the default URL per source", () => {
    expect(hostUrl("robot.local", "foxglove-websocket")).toBe("ws://robot.local:8765");
    expect(hostUrl("robot.local", "rosbridge-websocket")).toBe("ws://robot.local:9090");
    expect(hostUrl("robot.local", "ros1-socket")).toBe("http://robot.local:11311");
  });
});
