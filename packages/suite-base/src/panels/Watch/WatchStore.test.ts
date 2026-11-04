// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { parseMessagePath } from "@lichtblick/message-path";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { CompiledRow, HISTORY_SIZE, WatchStore, historyValues } from "./WatchStore";

function row(id: string, path: string): CompiledRow {
  const parsed = parseMessagePath(path)!;
  return { id, path: parsed, key: path };
}

function msg(topic: string, message: unknown, sec = 0): MessageEvent {
  return { topic, message, receiveTime: { sec, nsec: 0 }, schemaName: "", sizeInBytes: 0 };
}

describe("WatchStore", () => {
  it("evaluates rows of the message's topic and marks them dirty", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.x"), row("b", "/a.y.@mul(2)"), row("c", "/c.x")]);
    store.takeDirty();
    store.addMessages([msg("/a", { x: 1, y: 2 }), msg("/a", { x: 3, y: 4 })]);
    expect(store.get("a")?.value).toBe(3);
    expect(store.get("b")?.value).toBe(8);
    expect(store.get("c")?.value).toBeUndefined();
    // Each row reported once, however many messages arrived
    expect(store.takeDirty().sort()).toEqual(["a", "b"]);
    expect(store.takeDirty()).toEqual([]);
  });

  it("keeps the previous value when a filter does not match", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.items[:]{id==2}.v")]);
    store.addMessages([msg("/a", { items: [{ id: 2, v: 5 }] })]);
    store.addMessages([msg("/a", { items: [{ id: 3, v: 7 }] })]);
    expect(store.get("a")?.value).toBe(5);
  });

  it("returns several matches as an array", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.items[:].v")]);
    store.addMessages([msg("/a", { items: [{ v: 1 }, { v: 2 }] })]);
    expect(store.get("a")?.value).toEqual([1, 2]);
  });

  it("applies time-series modifiers across messages", () => {
    const store = new WatchStore();
    store.setRows([
      row("d", "/a.x.@derivative"),
      row("i", "/a.x.@integral"),
      row("e", "/a.x.@delta.@abs"),
    ]);
    store.addMessages([msg("/a", { x: 0 }, 0)]);
    expect(store.get("d")?.value).toBeUndefined();
    store.addMessages([msg("/a", { x: 4 }, 2), msg("/a", { x: 2 }, 3)]);
    expect(store.get("d")?.value).toBe(-2);
    expect(store.get("i")?.value).toBe(4 + 3);
    expect(store.get("e")?.value).toBe(2);
  });

  it("reports evaluation errors per row", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.x.@derivative")]);
    store.addMessages([msg("/a", { x: "text" })]);
    expect(store.get("a")?.error).toMatch(/needs a number/);
  });

  it("evaluates new rows against the latest message, so paused playback shows them", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.x")]);
    store.addMessages([msg("/a", { x: 1, y: 9 })]);
    store.takeDirty();
    store.setRows([row("a", "/a.x"), row("b", "/a.y")]);
    expect(store.get("b")?.value).toBe(9);
    // Unchanged rows keep their state
    expect(store.takeDirty()).toEqual(["b"]);
  });

  it("forgets values on reset", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.x")]);
    store.addMessages([msg("/a", { x: 1 })]);
    store.reset();
    expect(store.get("a")?.value).toBeUndefined();
    expect(historyValues(store.get("a")!)).toEqual([]);
    store.setRows([row("a", "/a.x"), row("b", "/a.x")]);
    expect(store.get("b")?.value).toBeUndefined();
  });

  it("keeps a bounded history of plottable values", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.x")]);
    for (let i = 0; i < HISTORY_SIZE + 5; i++) {
      store.addMessages([msg("/a", { x: i })]);
    }
    store.addMessages([msg("/a", { x: "not plottable" })]);
    const history = historyValues(store.get("a")!);
    expect(history).toHaveLength(HISTORY_SIZE);
    expect(history[0]).toBe(5);
    expect(history.at(-1)).toBe(HISTORY_SIZE + 4);
  });
});
