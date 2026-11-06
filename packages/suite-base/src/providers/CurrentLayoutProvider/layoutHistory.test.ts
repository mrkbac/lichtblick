// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  LayoutData,
  PanelsActions,
} from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { LayoutNode } from "@lichtblick/suite-base/types/layouts";

import { COALESCE_MS, HISTORY_LIMIT, LayoutHistory, reopenPlacement } from "./layoutHistory";

const initial: LayoutData = {
  configById: { "Plot!a": { title: "a" }, "Table!b": { title: "b" } },
  globalVariables: {},
  userNodes: {},
  playbackConfig: { speed: 1 },
  layout: { direction: "row", children: [{ panels: ["Plot!a"] }, { panels: ["Table!b"] }] },
};

const setTitle = (id: string, title: string): PanelsActions => ({
  type: "SAVE_PANEL_CONFIGS",
  payload: { configs: [{ id, config: { title } }] },
});

describe("LayoutHistory", () => {
  it("undoes and redoes", () => {
    const h = new LayoutHistory();
    const a = h.apply(initial, setTitle("Plot!a", "x"), 0)!;
    const b = h.apply(a, { type: "CLOSE_PANEL", payload: { id: "Table!b" } }, 1000)!;
    expect(b.configById["Table!b"]).toBeUndefined();

    expect(h.undo(b)).toBe(a);
    expect(h.undo(a)).toBe(initial);
    expect(h.undo(initial)).toBeUndefined();
    expect(h.redo(initial)).toBe(a);
    expect(h.redo(a)).toBe(b);
    expect(h.redo(b)).toBeUndefined();
  });

  it("drops redo steps after a new edit", () => {
    const h = new LayoutHistory();
    const a = h.apply(initial, setTitle("Plot!a", "x"), 0)!;
    h.undo(a);
    h.apply(initial, setTitle("Plot!a", "y"), 1000);
    expect(h.canRedo()).toBe(false);
  });

  it("skips no-op edits", () => {
    const h = new LayoutHistory();
    expect(h.apply(initial, setTitle("Plot!a", "a"), 0)).toBeUndefined();
    expect(h.canUndo()).toBe(false);
  });

  it("coalesces rapid edits of the same config into one step", () => {
    const h = new LayoutHistory();
    let data = initial;
    for (let i = 0; i < 10; i++) {
      // Each edit is within the window of the previous one, the series is longer than it.
      data = h.apply(data, setTitle("Plot!a", `t${i}`), i * (COALESCE_MS - 1))!;
    }
    expect(h.undo(data)).toBe(initial);
    expect(h.canUndo()).toBe(false);
  });

  it("does not coalesce edits of different panels, slow edits or discrete actions", () => {
    const h = new LayoutHistory();
    const a = h.apply(initial, setTitle("Plot!a", "x"), 0)!;
    const b = h.apply(a, setTitle("Table!b", "x"), 10)!;
    const c = h.apply(b, setTitle("Table!b", "y"), 10 + COALESCE_MS)!;
    const d = h.apply(
      c,
      { type: "SPLIT_PANEL", payload: { id: "Plot!a", direction: "row", config: {} } },
      20 + COALESCE_MS,
    )!;
    const e = h.apply(
      d,
      { type: "SPLIT_PANEL", payload: { id: "Plot!a", direction: "row", config: {} } },
      30 + COALESCE_MS,
    )!;
    expect([h.undo(e), h.undo(d), h.undo(c), h.undo(b)]).toEqual([d, c, b, a]);
  });

  it("starts a new step after undo instead of folding into the undone one", () => {
    const h = new LayoutHistory();
    const a = h.apply(initial, setTitle("Plot!a", "x"), 0)!;
    const b = h.apply(a, setTitle("Table!b", "x"), 1000)!;
    h.undo(b);
    const c = h.apply(a, setTitle("Table!b", "y"), 1001)!;
    expect(h.undo(c)).toBe(a);
  });

  it("does not record panels filling in their defaults", () => {
    const h = new LayoutHistory();
    const a = h.apply(initial, setTitle("Plot!a", "x"), 0)!;
    const filled = h.apply(
      a,
      {
        type: "SAVE_PANEL_CONFIGS",
        payload: { configs: [{ id: "Table!b", config: { extra: 1 } }], fillsDefaults: true },
      },
      1000,
    )!;
    // A brand-new panel saving its first config counts as filling defaults too.
    const added = h.apply(filled, setTitle("Plot!new", "n"), 2000)!;
    expect(added.configById["Plot!new"]).toEqual({ title: "n" });
    expect(h.undo(added)).toBe(initial);
    expect(h.canUndo()).toBe(false);
  });

  it("keeps redo when a panel fills in its defaults after undo", () => {
    const h = new LayoutHistory();
    const a = h.apply(initial, setTitle("Plot!a", "x"), 0)!;
    h.undo(a);
    const filled = h.apply(
      initial,
      {
        type: "SAVE_PANEL_CONFIGS",
        payload: { configs: [{ id: "Plot!a", config: { extra: 1 } }], fillsDefaults: true },
      },
      1000,
    )!;
    expect(h.redo(filled)).toBe(a);
  });

  it("is bounded", () => {
    const h = new LayoutHistory();
    let data = initial;
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      data = h.apply(data, setTitle("Plot!a", `t${i}`), i * COALESCE_MS * 2)!;
    }
    let steps = 0;
    while (h.canUndo()) {
      data = h.undo(data)!;
      steps++;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(data.configById["Plot!a"]).toEqual({ title: "t19" });
  });

  it("resets when the layout data changed outside of it", () => {
    const h = new LayoutHistory();
    h.apply(initial, setTitle("Plot!a", "x"), 0);
    const otherLayout = { ...initial };
    expect(h.undo(otherLayout)).toBeUndefined();
    expect(h.reopenClosedPanel(otherLayout, 0)).toBeUndefined();
  });

  it("reopens the most recently closed panel with its config and place", () => {
    const h = new LayoutHistory();
    const closed = h.apply(initial, { type: "CLOSE_PANEL", payload: { id: "Plot!a" } }, 0)!;
    const reopened = h.reopenClosedPanel(closed, 1000)!;
    expect(reopened.layout).toMatchObject(initial.layout!);
    expect(reopened.configById["Plot!a"]).toEqual({ title: "a" });
    expect(h.reopenClosedPanel(reopened, 2000)).toBeUndefined();
    // Reopening is undoable too.
    expect(h.undo(reopened)).toBe(closed);
  });

  it("skips closed panels that are already back", () => {
    const h = new LayoutHistory();
    const a = h.apply(initial, { type: "CLOSE_PANEL", payload: { id: "Plot!a" } }, 0)!;
    const b = h.apply(a, { type: "CLOSE_PANEL", payload: { id: "Table!b" } }, 1000)!;
    expect(h.undo(b)).toBe(a);
    // Table!b is back through undo, so Plot!a is the one to reopen.
    const reopened = h.reopenClosedPanel(a, 2000)!;
    expect(reopened.configById["Plot!a"]).toEqual({ title: "a" });
  });
});

describe("reopenPlacement", () => {
  const layout: LayoutNode = {
    direction: "row",
    children: [
      { panels: ["A!1", "A!2"] },
      { direction: "column", children: [{ panels: ["B!1"] }, { panels: ["C!1"] }] },
    ],
  };

  it("goes back as a tab next to its tab mates", () => {
    expect(reopenPlacement(layout, "A!2")).toEqual({ position: "center", targetPanelId: "A!1" });
  });

  it("goes back beside its neighbour", () => {
    expect(reopenPlacement(layout, "B!1")).toEqual({ position: "top", targetPanelId: "C!1" });
    expect(reopenPlacement(layout, "C!1")).toEqual({ position: "bottom", targetPanelId: "B!1" });
  });

  it("falls back to the right edge", () => {
    expect(reopenPlacement({ panels: ["A!1"] }, "A!1")).toEqual({ position: "right" });
  });
});
