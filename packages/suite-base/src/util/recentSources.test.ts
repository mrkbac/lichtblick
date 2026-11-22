// SPDX-License-Identifier: MPL-2.0

import {
  detectConnection,
  formatTimeAgo,
  connectionRecentArgs,
  splitRecentTitle,
  hostUrl,
  looksLikeHost,
  recentArgs,
  recentFileTitle,
} from "./recentSources";

describe("recentFileTitle", () => {
  it("lists merged files", () => {
    expect(recentFileTitle(["a.mcap", "b.mcap"])).toBe("a.mcap, b.mcap");
  });

  it("names a comparison of single files by its sides", () => {
    expect(recentFileTitle(["a.mcap", "b.mcap"], ["a.mcap", "b.mcap"])).toBe("a.mcap vs b.mcap");
  });

  it("leads with side names and lists a shared file once", () => {
    expect(
      recentFileTitle(["base.mcap", "a.mcap", "base.mcap", "b.mcap"], ["A", "A", "B", "B"]),
    ).toBe("A vs B (base.mcap, a.mcap, b.mcap)");
  });
});

describe("recentArgs", () => {
  const handles = [{ name: "a.mcap" }, { name: "b.mcap" }] as unknown as FileSystemFileHandle[];
  const recent = {
    id: "1",
    type: "file" as const,
    sourceId: "mcap-local-file",
    title: "t",
    handles,
  };

  it("reopens a comparison side by side", () => {
    expect(recentArgs({ ...recent, compare: ["A", "B"] })).toEqual({
      type: "file",
      handles,
      compare: ["A", "B"],
    });
  });

  it("reopens old recents without side names merged", () => {
    expect(recentArgs(recent).compare).toBeUndefined();
  });
});

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
  const day = 24 * 60 * 60 * 1000;
  it("picks the largest unit that fits, waiting for two of the long ones", () => {
    expect(formatTimeAgo(now - 117 * 1000, now, "en")).toBe("2 minutes ago");
    expect(formatTimeAgo(now - 50 * 1000, now, "en")).toBe("1 minute ago");
    expect(formatTimeAgo(now - 3 * 60 * 60 * 1000, now, "en")).toBe("3 hours ago");
    expect(formatTimeAgo(now - day, now, "en")).toBe("yesterday");
    expect(formatTimeAgo(now - 10 * day, now, "en")).toBe("10 days ago");
    expect(formatTimeAgo(now - 2 * day, now, "en")).toBe("2 days ago");
    expect(formatTimeAgo(now - 17 * 30 * day, now, "en")).toBe("17 months ago");
    expect(formatTimeAgo(now - 3 * 365 * day, now, "en")).toBe("3 years ago");
    expect(formatTimeAgo(now - 1000, now, "en")).toBe("now");
    expect(formatTimeAgo(now - 40 * 1000, now, "en")).toBe("now");
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

describe("connection recent arguments", () => {
  it("reopens older joined URL lists with their comparison settings", () => {
    const urls = ["https://example.com/run,1.mcap", "https://example.com/run2.mcap"];
    expect(
      connectionRecentArgs({
        sourceId: "remote-file",
        extra: { url: urls.join(), compareNames: "A,B" },
      }),
    ).toEqual({ type: "connection", params: { compareNames: "A,B" }, urls });
  });

  it("preserves the contents of a new remote recent's URL list", () => {
    const urls = ["https://example.com/run.mcap?tag=a,https://example.com/b.mcap"];
    expect(connectionRecentArgs({ sourceId: "remote-file", urls })).toEqual({
      type: "connection",
      params: {},
      urls,
    });
  });
});
