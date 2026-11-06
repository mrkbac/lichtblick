// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { parseMessagePath } from "@lichtblick/message-path";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import {
  CompiledRow,
  HISTORY_SIZE,
  WatchStore,
  createPlaybackClock,
  historyValues,
} from "./WatchStore";

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

  it("remembers when each value last updated", () => {
    const store = new WatchStore();
    store.setRows([row("a", "/a.items[:]{id==2}.v")]);
    store.addMessages([msg("/a", { items: [{ id: 2, v: 5 }] }, 3)]);
    // A message that does not update the value keeps its age running
    store.addMessages([msg("/a", { items: [{ id: 3, v: 7 }] }, 8)]);
    expect(store.get("a")?.time).toBe(3);
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

describe("createPlaybackClock", () => {
  it("follows the player, and keeps running while playing without updates", () => {
    const clock = createPlaybackClock();
    expect(clock({ current: undefined, isPlaying: true, speed: 1 }, 100)).toBeUndefined();
    expect(clock({ current: 10, isPlaying: true, speed: 1 }, 100)).toBe(10);
    // Live stream stalled: no new player time, but values keep aging
    expect(clock({ current: 10, isPlaying: true, speed: 1 }, 103)).toBe(13);
    expect(clock({ current: 10, isPlaying: true, speed: 2 }, 104)).toBe(18);
    // New player time takes over
    expect(clock({ current: 11, isPlaying: true, speed: 1 }, 104.5)).toBe(11);
  });

  it("stands still while paused", () => {
    const clock = createPlaybackClock();
    expect(clock({ current: 10, isPlaying: false, speed: 1 }, 100)).toBe(10);
    expect(clock({ current: 10, isPlaying: false, speed: 1 }, 160)).toBe(10);
  });
});
