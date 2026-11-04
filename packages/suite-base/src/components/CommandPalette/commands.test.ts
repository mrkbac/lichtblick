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

const cmd = (
  id: string,
  title: string,
  extra: Partial<Command> = {},
): Command => ({ id, title, run: jest.fn(), ...extra }) as Command;

describe("rankCommands", () => {
  const commands = [
    cmd("a", "Open local file…"),
    cmd("b", "Change layout…", { keywords: ["switch"] }),
    cmd("c", "Add panel…"),
    cmd("d", "Open connection: WebSocket"),
  ];
  const ids = (ranked: ReturnType<typeof rankCommands>) =>
    ranked.map((r) => r.command.id);

  it("keeps registration order without a query or recents", () => {
    expect(ids(rankCommands(commands, "", []))).toEqual(["a", "b", "c", "d"]);
  });

  it("puts recently used commands first, most recent first", () => {
    expect(ids(rankCommands(commands, "  ", ["c", "b"]))).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });

  it("fuzzy matches titles and keywords and returns highlight positions", () => {
    const ranked = rankCommands(commands, "layout", []);
    expect(ids(ranked)).toEqual(["b"]);
    expect([...ranked[0]!.positions].sort((x, y) => x - y)).toEqual([
      7, 8, 9, 10, 11, 12,
    ]);
    expect(ids(rankCommands(commands, "switch", []))).toEqual(["b"]);
  });

  it("boosts recent commands among similar matches", () => {
    expect(ids(rankCommands(commands, "open", []))[0]).toBe("a");
    expect(ids(rankCommands(commands, "open", ["d"]))[0]).toBe("d");
  });

  it("does not let recency beat a much better match", () => {
    expect(ids(rankCommands(commands, "add panel", ["a", "b", "d"]))[0]).toBe(
      "c",
    );
  });
});

describe("parseSeekInput", () => {
  const range = {
    start: { sec: 100, nsec: 0 },
    end: { sec: 200, nsec: 0 },
    current: { sec: 150, nsec: 0 },
  };
  const parse = (text: string) => parseSeekInput(text, range);

  it.each([
    ["12.5", { sec: 112, nsec: 500_000_000 }],
    ["12.5s", { sec: 112, nsec: 500_000_000 }],
    ["1:02", { sec: 162, nsec: 0 }],
    ["0:01:02.5", { sec: 162, nsec: 500_000_000 }],
    ["1m", { sec: 160, nsec: 0 }],
    ["250ms", { sec: 100, nsec: 250_000_000 }],
    [".5", { sec: 100, nsec: 500_000_000 }],
  ])("%s is an offset from the start", (text, time) => {
    expect(parse(text)).toEqual({ time, relative: false });
  });

  it.each([
    ["+5s", { sec: 155, nsec: 0 }],
    ["-5", { sec: 145, nsec: 0 }],
    ["+1:00", { sec: 200, nsec: 0 }],
    ["- 500ms", { sec: 149, nsec: 500_000_000 }],
  ])("%s is relative to the current time", (text, time) => {
    expect(parse(text)).toEqual({ time, relative: true });
  });

  it("clamps to the recording range", () => {
    expect(parse("1000")?.time).toEqual(range.end);
    expect(parse("-1h")?.time).toEqual(range.start);
  });

  it("treats large plain numbers as absolute timestamps", () => {
    const wide = {
      start: { sec: 1_700_000_000, nsec: 0 },
      end: { sec: 1_700_000_100, nsec: 0 },
    };
    expect(parseSeekInput("1700000042.5", wide)?.time).toEqual({
      sec: 1_700_000_042,
      nsec: 500_000_000,
    });
  });

  it.each(["", "open", "1:75", "1:2:3:4", "5x", "+", "12.5.1"])(
    "rejects %p",
    (text) => {
      expect(parse(text)).toBeUndefined();
    },
  );

  it("needs a current time for relative input", () => {
    expect(
      parseSeekInput("+5s", { start: range.start, end: range.end }),
    ).toBeUndefined();
  });
});

describe("paletteReducer", () => {
  const parent = cmd("layouts", "Change layout…");
  const items = [cmd("l1", "One"), cmd("l2", "Two")];

  it("drills into a sub-menu with a fresh query and back out restoring the root", () => {
    let state = paletteReducer(initialPaletteState, {
      type: "set-query",
      query: "lay",
    });
    state = paletteReducer(state, { type: "move", delta: 1, count: 3 });
    state = paletteReducer(state, { type: "push", parent, items });
    expect(state.stack).toHaveLength(2);
    expect(state.stack[1]).toEqual({
      parent,
      items,
      query: "",
      selectedIndex: 0,
    });

    state = paletteReducer(state, { type: "set-query", query: "tw" });
    expect(state.stack[1]!.query).toBe("tw");
    expect(state.stack[0]!.query).toBe("lay");

    state = paletteReducer(state, { type: "pop" });
    expect(state.stack).toEqual([{ query: "lay", selectedIndex: 1 }]);
  });

  it("does not pop the root", () => {
    expect(paletteReducer(initialPaletteState, { type: "pop" })).toBe(
      initialPaletteState,
    );
  });

  it("wraps selection around and resets it when the query changes", () => {
    let state = paletteReducer(initialPaletteState, {
      type: "move",
      delta: -1,
      count: 3,
    });
    expect(state.stack[0]!.selectedIndex).toBe(2);
    state = paletteReducer(state, { type: "move", delta: 1, count: 3 });
    expect(state.stack[0]!.selectedIndex).toBe(0);
    state = paletteReducer(state, { type: "select", index: 2 });
    state = paletteReducer(state, { type: "set-query", query: "x" });
    expect(state.stack[0]!.selectedIndex).toBe(0);
    expect(paletteReducer(state, { type: "move", delta: 1, count: 0 })).toBe(
      state,
    );
  });
});

describe("topicTargets", () => {
  const types = (schema: string | undefined) =>
    topicTargets(schema).map((t) => t.panelType);

  it("suggests the best panel first by schema", () => {
    expect(types("sensor_msgs/msg/CompressedImage")[0]).toBe("Image");
    expect(types("foxglove.RawImage")[0]).toBe("Image");
    expect(types("rcl_interfaces/msg/Log")[0]).toBe("RosOut");
    expect(types("diagnostic_msgs/DiagnosticArray")[0]).toBe(
      "DiagnosticSummary",
    );
    expect(types("sensor_msgs/PointCloud2")[0]).toBe("3D");
    expect(types("foxglove.SceneUpdate")[0]).toBe("3D");
  });

  it("always offers raw messages, and nothing special for unknown schemas", () => {
    expect(types("sensor_msgs/CameraInfo")).toEqual(["RawMessages", "Table"]);
    expect(types(undefined)).toEqual(["RawMessages", "Table"]);
  });
});

describe("formatOffset", () => {
  it.each([
    [0, "0:00.000"],
    [62.5, "1:02.500"],
    [3723.25, "1:02:03.250"],
    [-5, "-0:05.000"],
  ])("%p → %s", (seconds, text) => {
    expect(formatOffset(seconds)).toBe(text);
  });
});
