// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { PANEL_TITLE_CONFIG_KEY } from "@lichtblick/suite-base/util/layout";

import { migrateMosaicLayout } from "./migrateMosaicLayout";

function layoutData(layout: unknown, configById: LayoutData["configById"] = {}): LayoutData {
  return {
    layout: layout as LayoutData["layout"],
    configById,
    globalVariables: {},
    playbackConfig: { speed: 1 },
  };
}

describe("migrateMosaicLayout", () => {
  it("converts binary splits", () => {
    const result = migrateMosaicLayout(
      layoutData({
        direction: "row",
        first: "A!1",
        second: { direction: "row", first: "B!1", second: "C!1", splitPercentage: 25 },
        splitPercentage: 50,
      }),
    );
    expect(result.layout).toEqual({
      direction: "row",
      children: [{ panels: ["A!1"] }, { panels: ["B!1"] }, { panels: ["C!1"] }],
      sizes: [50, 12.5, 37.5],
    });
  });

  it("converts a single panel and leaves new layouts alone", () => {
    expect(migrateMosaicLayout(layoutData("A!1")).layout).toEqual({ panels: ["A!1"] });
    const current = layoutData({ panels: ["A!1"] });
    expect(migrateMosaicLayout(current)).toBe(current);
  });

  it("turns a Tab panel into tab groups, keeping every panel and its config", () => {
    const result = migrateMosaicLayout(
      layoutData(
        { direction: "row", first: "Tab!t", second: "C!1" },
        {
          "Tab!t": {
            activeTabIdx: 1,
            tabs: [
              {
                title: "Cameras",
                layout: { direction: "column", first: "Image!a", second: "Image!b" },
              },
              {
                title: "Plots",
                layout: { direction: "column", first: "Plot!a", second: "Plot!b" },
              },
              { title: "Logs", layout: "Log!a" },
              { title: "Empty" },
            ],
          },
          "Image!a": { topic: "/a" },
          "Log!a": {},
          "C!1": {},
        },
      ),
    );
    // The active tab's arrangement, with the other tabs' panels stacked in the same positions
    expect(result.layout).toEqual({
      direction: "row",
      children: [
        {
          direction: "column",
          children: [
            { panels: ["Image!a", "Plot!a", "Log!a"], active: "Plot!a" },
            { panels: ["Image!b", "Plot!b"], active: "Plot!b" },
          ],
          sizes: [50, 50],
        },
        { panels: ["C!1"] },
      ],
      sizes: [50, 50],
    });
    expect(result.configById["Tab!t"]).toBeUndefined();
    expect(result.configById["Image!a"]).toEqual({ topic: "/a" });
    // A single-panel tab passes its title on to the panel
    expect(result.configById["Log!a"]).toEqual({ [PANEL_TITLE_CONFIG_KEY]: "Logs" });
  });

  it("converts nested Tab panels", () => {
    const result = migrateMosaicLayout(
      layoutData("Tab!outer", {
        "Tab!outer": { activeTabIdx: 0, tabs: [{ title: "1", layout: "Tab!inner" }] },
        "Tab!inner": { activeTabIdx: 0, tabs: [{ title: "2", layout: "A!1" }] },
      }),
    );
    expect(result.layout).toEqual({ panels: ["A!1"] });
    expect(Object.keys(result.configById)).toEqual(["A!1"]);
  });

  it("drops a malformed layout instead of failing on it", () => {
    expect(migrateMosaicLayout(layoutData({ direction: "row" })).layout).toBeUndefined();
  });
});
