// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutNode } from "@lichtblick/suite-base/types/layouts";
import { dockviewToLayout, layoutToDockview } from "@lichtblick/suite-base/util/dockviewLayout";

import {
  getPanelIds,
  getSiblingGroup,
  groupPanels,
  insertPanel,
  layoutsEqual,
  normalizeLayout,
  removePanels,
  replacePanel,
} from "./layoutTree";

const threePanels: LayoutNode = {
  direction: "row",
  children: [
    { panels: ["A!1"] },
    { direction: "column", children: [{ panels: ["B!1"] }, { panels: ["C!1"] }], sizes: [30, 70] },
  ],
  sizes: [60, 40],
};

describe("normalizeLayout", () => {
  it("drops empty groups and collapses single-child splits", () => {
    expect(
      normalizeLayout({
        direction: "row",
        children: [{ panels: [] }, { direction: "column", children: [{ panels: ["A!1"] }] }],
      }),
    ).toEqual({ panels: ["A!1"] });
    expect(normalizeLayout({ panels: [] })).toBeUndefined();
  });

  it("flattens a split nested in a split of the same direction, keeping sizes", () => {
    expect(
      normalizeLayout({
        direction: "row",
        children: [
          { panels: ["A!1"] },
          { direction: "row", children: [{ panels: ["B!1"] }, { panels: ["C!1"] }] },
        ],
        sizes: [50, 50],
      }),
    ).toEqual({
      direction: "row",
      children: [{ panels: ["A!1"] }, { panels: ["B!1"] }, { panels: ["C!1"] }],
      sizes: [50, 25, 25],
    });
  });

  it("drops an active tab that is not in the group", () => {
    expect(normalizeLayout({ panels: ["A!1", "B!1"], active: "X!1" })).toEqual({
      panels: ["A!1", "B!1"],
    });
  });
});

describe("layout edits", () => {
  it("lists panel ids in layout order", () => {
    expect(getPanelIds(threePanels)).toEqual(["A!1", "B!1", "C!1"]);
  });

  it("removes a panel and closes its group", () => {
    expect(removePanels(threePanels, ["B!1"])).toEqual({
      direction: "row",
      children: [{ panels: ["A!1"] }, { panels: ["C!1"] }],
      sizes: [60, 40],
    });
    expect(removePanels({ panels: ["A!1"] }, ["A!1"])).toBeUndefined();
  });

  it("replaces a panel in place", () => {
    expect(getPanelIds(replacePanel(threePanels, "B!1", "D!1"))).toEqual(["A!1", "D!1", "C!1"]);
  });

  it("inserts next to a target group or along the layout edge", () => {
    expect(insertPanel(threePanels, "D!1", "bottom", "A!1")).toMatchObject({
      children: [
        { direction: "column", children: [{ panels: ["A!1"] }, { panels: ["D!1"] }] },
        expect.anything(),
      ],
    });
    expect(insertPanel(threePanels, "D!1", "left")).toMatchObject({
      direction: "row",
      children: [{ panels: ["D!1"] }, { panels: ["A!1"] }, expect.anything()],
    });
    expect(insertPanel(undefined, "D!1", "left")).toEqual({ panels: ["D!1"] });
  });

  it("stacks a panel as a tab on center drops", () => {
    expect(insertPanel(threePanels, "D!1", "center", "C!1")).toMatchObject({
      children: [
        expect.anything(),
        { children: [expect.anything(), { panels: ["C!1", "D!1"], active: "D!1" }] },
      ],
    });
  });

  it("moves a panel that is already in the layout instead of duplicating it", () => {
    const moved = insertPanel(threePanels, "A!1", "center", "C!1");
    expect(getPanelIds(moved)).toEqual(["B!1", "C!1", "A!1"]);
  });

  it("groups selected panels into the target's group", () => {
    expect(groupPanels(threePanels, "A!1", ["A!1", "B!1", "C!1"])).toEqual({
      panels: ["A!1", "B!1", "C!1"],
    });
  });

  it("finds the neighbouring group", () => {
    expect(getSiblingGroup(threePanels, "B!1")).toEqual({ panels: ["C!1"] });
    expect(getSiblingGroup(threePanels, "C!1")).toEqual({ panels: ["B!1"] });
    expect(getSiblingGroup(threePanels, "A!1")).toBeUndefined();
  });

  it("compares layouts with a size tolerance", () => {
    const resized: LayoutNode = { ...threePanels, sizes: [60.3, 39.7] };
    expect(layoutsEqual(threePanels, resized)).toBe(true);
    expect(layoutsEqual(threePanels, { ...threePanels, sizes: [70, 30] })).toBe(false);
    expect(layoutsEqual(threePanels, removePanels(threePanels, ["C!1"]))).toBe(false);
  });
});

describe("dockview conversion", () => {
  it("round-trips a layout", () => {
    const tabbed: LayoutNode = {
      direction: "column",
      children: [threePanels, { panels: ["D!1", "E!1"], active: "E!1" }],
      sizes: [75, 25],
    };
    expect(dockviewToLayout(layoutToDockview(tabbed))).toEqual(tabbed);
    expect(dockviewToLayout(layoutToDockview({ panels: ["A!1"] }))).toEqual({ panels: ["A!1"] });
  });
});
