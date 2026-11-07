// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";

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

  it("keeps Tab panels, converting the layout of each tab", () => {
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
              { title: "Logs", layout: "Log!a" },
              { title: "Empty" },
            ],
          },
          "Image!a": { topic: "/a" },
        },
      ),
    );
    expect(result.layout).toEqual({
      direction: "row",
      children: [{ panels: ["Tab!t"] }, { panels: ["C!1"] }],
      sizes: [50, 50],
    });
    expect(result.configById["Tab!t"]).toEqual({
      activeTabIdx: 1,
      tabs: [
        {
          title: "Cameras",
          layout: {
            direction: "column",
            children: [{ panels: ["Image!a"] }, { panels: ["Image!b"] }],
            sizes: [50, 50],
          },
        },
        { title: "Logs", layout: { panels: ["Log!a"] } },
        { title: "Empty" },
      ],
    });
    expect(result.configById["Image!a"]).toEqual({ topic: "/a" });
  });

  it("converts nested Tab panels and leaves converted ones alone", () => {
    const result = migrateMosaicLayout(
      layoutData("Tab!outer", {
        "Tab!outer": { activeTabIdx: 0, tabs: [{ title: "1", layout: "Tab!inner" }] },
        "Tab!inner": { activeTabIdx: 0, tabs: [{ title: "2", layout: "A!1" }] },
      }),
    );
    expect(result.layout).toEqual({ panels: ["Tab!outer"] });
    expect(result.configById["Tab!inner"]).toEqual({
      activeTabIdx: 0,
      tabs: [{ title: "2", layout: { panels: ["A!1"] } }],
    });
    const current = layoutData({ panels: ["Tab!t"] }, { "Tab!t": result.configById["Tab!inner"]! });
    expect(migrateMosaicLayout(current)).toBe(current);
  });

  it("drops a malformed layout instead of failing on it", () => {
    expect(migrateMosaicLayout(layoutData({ direction: "row" })).layout).toBeUndefined();
  });

  it("turns malformed tabs into empty tabs", () => {
    const result = migrateMosaicLayout(
      layoutData("Tab!t", { "Tab!t": { tabs: ["x", { title: 3, layout: "B!1" }, { layout: 5 }] } }),
    );
    expect(result.configById["Tab!t"]).toEqual({
      tabs: [{ title: "2", layout: { panels: ["B!1"] } }, { title: "3" }],
    });
  });
});
