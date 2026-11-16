// SPDX-License-Identifier: MPL-2.0

import { getFallbackPanelId, getVisiblePanelIds } from "@lichtblick/suite-base/util/tabLayout";

describe("getVisiblePanelIds", () => {
  it("includes root panels and only the shown tab of each Tab panel", () => {
    const data = {
      layout: {
        direction: "row" as const,
        children: [{ panels: ["Plot!a"] }, { panels: ["Tab!t"] }],
      },
      configById: {
        "Tab!t": {
          activeTabIdx: 1,
          tabs: [
            { title: "1", layout: { panels: ["RawMessages!hidden"] } },
            { title: "2", layout: { panels: ["Map!shown"] } },
          ],
        },
      },
    };
    expect(getVisiblePanelIds(data)).toEqual(["Plot!a", "Tab!t", "Map!shown"]);
  });

  it("returns only the Tab panel when its shown tab is empty", () => {
    const data = {
      layout: { panels: ["Tab!t"] },
      configById: {
        "Tab!t": {
          activeTabIdx: 1,
          tabs: [{ title: "1", layout: { panels: ["Plot!a"] } }, { title: "2" }],
        },
      },
    };
    expect(getVisiblePanelIds(data)).toEqual(["Tab!t"]);
  });

  it("returns only the active panel of a stacked group", () => {
    const data = { layout: { panels: ["Plot!a", "Map!b"], active: "Map!b" }, configById: {} };
    expect(getVisiblePanelIds(data)).toEqual(["Map!b"]);
  });
});

describe("getFallbackPanelId", () => {
  // A plot split next to a Tab panel whose tab 1 holds "Raw!a", tab 2 holds "Map!b" + "Image!c".
  const withTab = (activeTabIdx: number) => ({
    layout: {
      direction: "row" as const,
      children: [{ panels: ["Plot!p"] }, { panels: ["Tab!t"] }],
    },
    configById: {
      "Tab!t": {
        activeTabIdx,
        tabs: [
          { title: "A", layout: { panels: ["Raw!a"] } },
          {
            title: "B",
            layout: {
              direction: "column" as const,
              children: [{ panels: ["Map!b"] }, { panels: ["Image!c"] }],
            },
          },
          { title: "C" },
        ],
      },
    },
  });

  it("picks the first panel of the tab switched to, not the unrelated split", () => {
    expect(getFallbackPanelId(withTab(1), "Raw!a")).toBe("Map!b");
  });

  it("picks the Tab panel itself when the tab switched to is empty", () => {
    expect(getFallbackPanelId(withTab(2), "Raw!a")).toBe("Tab!t");
  });

  it("picks the first panel on screen when nothing was selected or the panel is gone", () => {
    expect(getFallbackPanelId(withTab(1), undefined)).toBe("Plot!p");
    expect(getFallbackPanelId(withTab(1), "Deleted!x")).toBe("Plot!p");
  });

  it("picks the first panel of the shown tab when the Tab panel itself is selected", () => {
    expect(getFallbackPanelId(withTab(1), "Tab!t")).toBe("Map!b");
    expect(getFallbackPanelId(withTab(2), "Tab!t")).toBe("Tab!t");
  });

  it("skips hidden panels", () => {
    expect(getFallbackPanelId(withTab(1), "Raw!a", new Set(["Map!b"]))).toBe("Image!c");
    expect(getFallbackPanelId(withTab(1), undefined, new Set(["Plot!p"]))).toBe("Map!b");
  });
});
