// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Command,
  initialPaletteState,
  paletteReducer,
  parseSeekInput,
  rankCommands,
} from "./commands";
import { formatOffset, topicTargets } from "./useAppCommands";

const cmd = (id: string, title: string, extra: Partial<Command> = {}): Command =>
  ({ id, title, run: vi.fn(), ...extra }) as Command;

describe("rankCommands", () => {
  const commands = [
    cmd("a", "Open local file…"),
    cmd("b", "Change layout…", { keywords: ["switch"] }),
    cmd("c", "Add panel…"),
    cmd("d", "Open connection: WebSocket"),
  ];
  const ids = (ranked: ReturnType<typeof rankCommands>) => ranked.map((r) => r.command.id);

  it("keeps registration order without a query or recents", () => {
    // Given no query and no recently used commands
    const query = "";

    // When ranking
    const ranked = rankCommands(commands, query, []);

    // Then the order is unchanged
    expect(ids(ranked)).toEqual(["a", "b", "c", "d"]);
  });

  it("puts recently used commands first, most recent first", () => {
    // Given a blank query and two recent commands
    const recent = ["c", "b"];

    // When ranking
    const ranked = rankCommands(commands, "  ", recent);

    // Then recents lead in recency order, followed by the rest
    expect(ids(ranked)).toEqual(["c", "b", "a", "d"]);
  });

  it("fuzzy matches titles and keywords and returns highlight positions", () => {
    // Given a query matching a title and one matching only a keyword
    const titleQuery = "layout";
    const keywordQuery = "switch";

    // When ranking
    const byTitle = rankCommands(commands, titleQuery, []);
    const byKeyword = rankCommands(commands, keywordQuery, []);

    // Then both find the command, and title matches report highlighted characters
    expect(ids(byTitle)).toEqual(["b"]);
    expect([...byTitle[0]!.positions].sort((x, y) => x - y)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(ids(byKeyword)).toEqual(["b"]);
  });

  it("boosts recent commands among similar matches", () => {
    // Given a query that matches two commands about equally well
    const query = "open";

    // When ranking without and with one of them recently used
    const fresh = rankCommands(commands, query, []);
    const withRecent = rankCommands(commands, query, ["d"]);

    // Then the recent one moves to the top
    expect(ids(fresh)[0]).toBe("a");
    expect(ids(withRecent)[0]).toBe("d");
  });

  it("does not let recency beat a much better match", () => {
    // Given a query that matches one command exactly while others were used recently
    const recent = ["a", "b", "d"];

    // When ranking
    const ranked = rankCommands(commands, "add panel", recent);

    // Then the exact match still wins
    expect(ids(ranked)[0]).toBe("c");
  });
});

describe("parseSeekInput", () => {
  const range = {
    start: { sec: 100, nsec: 0 },
    end: { sec: 200, nsec: 0 },
    current: { sec: 150, nsec: 0 },
  };

  it.each([
    ["12.5", { sec: 112, nsec: 500_000_000 }],
    ["12.5s", { sec: 112, nsec: 500_000_000 }],
    ["1:02", { sec: 162, nsec: 0 }],
    ["0:01:02.5", { sec: 162, nsec: 500_000_000 }],
    ["1m", { sec: 160, nsec: 0 }],
    ["250ms", { sec: 100, nsec: 250_000_000 }],
    [".5", { sec: 100, nsec: 500_000_000 }],
  ])("%s is an offset from the start", (text, time) => {
    // Given unsigned input
    const input = text;

    // When parsing
    const result = parseSeekInput(input, range);

    // Then it is measured from the start of the recording
    expect(result).toEqual({ time, relative: false });
  });

  it.each([
    ["+5s", { sec: 155, nsec: 0 }],
    ["-5", { sec: 145, nsec: 0 }],
    ["+1:00", { sec: 200, nsec: 0 }],
    ["- 500ms", { sec: 149, nsec: 500_000_000 }],
  ])("%s is relative to the current time", (text, time) => {
    // Given signed input
    const input = text;

    // When parsing
    const result = parseSeekInput(input, range);

    // Then it is measured from the current time
    expect(result).toEqual({ time, relative: true });
  });

  it("clamps to the recording range", () => {
    // Given input past either end of the recording
    const pastEnd = "1000";
    const beforeStart = "-1h";

    // When parsing
    const end = parseSeekInput(pastEnd, range);
    const start = parseSeekInput(beforeStart, range);

    // Then the result is clamped to the range
    expect(end?.time).toEqual(range.end);
    expect(start?.time).toEqual(range.start);
  });

  it("treats large plain numbers as absolute timestamps", () => {
    // Given a recording with epoch timestamps
    const epochRange = {
      start: { sec: 1_700_000_000, nsec: 0 },
      end: { sec: 1_700_000_100, nsec: 0 },
    };

    // When parsing an epoch timestamp
    const result = parseSeekInput("1700000042.5", epochRange);

    // Then it is used as-is
    expect(result?.time).toEqual({ sec: 1_700_000_042, nsec: 500_000_000 });
  });

  it.each(["", "open", "1:75", "1:2:3:4", "5x", "+", "12.5.1"])("rejects %p", (text) => {
    // Given input that is not a time
    const input = text;

    // When parsing
    const result = parseSeekInput(input, range);

    // Then nothing is offered
    expect(result).toBeUndefined();
  });

  it("needs a current time for relative input", () => {
    // Given a range without a current time
    const noCurrent = { start: range.start, end: range.end };

    // When parsing relative input
    const result = parseSeekInput("+5s", noCurrent);

    // Then nothing is offered
    expect(result).toBeUndefined();
  });
});

describe("paletteReducer", () => {
  const parent = cmd("layouts", "Change layout…");
  const items = [cmd("l1", "One"), cmd("l2", "Two")];

  /** Root with query "lay" and the second item selected. */
  const rootWithSelection = () =>
    paletteReducer(paletteReducer(initialPaletteState, { type: "set-query", query: "lay" }), {
      type: "move",
      delta: 1,
      count: 3,
    });

  it("drills into a sub-menu with a fresh query", () => {
    // Given a root with a query and a selection
    const root = rootWithSelection();

    // When opening a sub-menu and typing in it
    const opened = paletteReducer(root, { type: "push", parent, items });
    const typed = paletteReducer(opened, { type: "set-query", query: "tw" });

    // Then the sub-menu has its own query and the root query is kept
    expect(typed.stack).toHaveLength(2);
    expect(typed.stack[1]).toEqual({ parent, items, query: "tw", selectedIndex: 0 });
    expect(typed.stack[0]!.query).toBe("lay");
  });

  it("goes back to the root, restoring its query and selection", () => {
    // Given an open sub-menu above a root with a query and a selection
    const opened = paletteReducer(rootWithSelection(), { type: "push", parent, items });

    // When going back
    const back = paletteReducer(opened, { type: "pop" });

    // Then the root is restored as it was
    expect(back.stack).toEqual([{ query: "lay", selectedIndex: 1 }]);
  });

  it("does not pop the root", () => {
    // Given the root level
    const root = initialPaletteState;

    // When going back
    const state = paletteReducer(root, { type: "pop" });

    // Then nothing changes
    expect(state).toBe(root);
  });

  it("wraps selection around at both ends", () => {
    // Given three results with the first selected
    const root = initialPaletteState;

    // When moving up, then down
    const up = paletteReducer(root, { type: "move", delta: -1, count: 3 });
    const down = paletteReducer(up, { type: "move", delta: 1, count: 3 });

    // Then selection wraps to the last item and back to the first
    expect(up.stack[0]!.selectedIndex).toBe(2);
    expect(down.stack[0]!.selectedIndex).toBe(0);
  });

  it("resets selection when the query changes and ignores moves without results", () => {
    // Given the third item selected
    const selected = paletteReducer(initialPaletteState, { type: "select", index: 2 });

    // When the query changes, then a move happens with no results
    const typed = paletteReducer(selected, { type: "set-query", query: "x" });
    const moved = paletteReducer(typed, { type: "move", delta: 1, count: 0 });

    // Then selection goes back to the first item and the empty move is a no-op
    expect(typed.stack[0]!.selectedIndex).toBe(0);
    expect(moved).toBe(typed);
  });
});

describe("topicTargets", () => {
  const types = (schema: string | undefined) => topicTargets(schema).map((t) => t.panelType);

  it.each([
    ["sensor_msgs/msg/CompressedImage", "Image"],
    ["foxglove.RawImage", "Image"],
    ["rcl_interfaces/msg/Log", "RosOut"],
    ["diagnostic_msgs/DiagnosticArray", "DiagnosticSummary"],
    ["sensor_msgs/PointCloud2", "3D"],
    ["foxglove.SceneUpdate", "3D"],
  ])("suggests the best panel for %s first", (schema, panelType) => {
    // Given a known schema
    const schemaName = schema;

    // When picking panels
    const result = types(schemaName);

    // Then the specialized panel comes first
    expect(result[0]).toBe(panelType);
  });

  it.each(["sensor_msgs/CameraInfo", undefined])("offers only generic panels for %p", (schema) => {
    // Given an unknown or missing schema
    const schemaName = schema;

    // When picking panels
    const result = types(schemaName);

    // Then only the generic panels are offered
    expect(result).toEqual(["RawMessages", "Table"]);
  });
});

describe("formatOffset", () => {
  it.each([
    [0, "0:00.000"],
    [62.5, "1:02.500"],
    [3723.25, "1:02:03.250"],
    [-5, "-0:05.000"],
  ])("%p → %s", (seconds, text) => {
    // Given an offset in seconds
    const offset = seconds;

    // When formatting
    const result = formatOffset(offset);

    // Then it reads as [h:]m:ss.mmm
    expect(result).toBe(text);
  });
});
