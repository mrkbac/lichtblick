// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { splitPlacement } from "./useAddPanel";

describe("splitPlacement", () => {
  const wide = { id: "Plot!a", width: 800, height: 300 };
  const tall = { id: "Image!b", width: 300, height: 600 };
  const tab = { id: "Tab!t", width: 2000, height: 2000 };
  const hidden = { id: "Map!h", width: 0, height: 0 };

  it("splits the selected panel along its longer side", () => {
    expect(splitPlacement([wide, tall], ["Image!b"])).toEqual({
      targetPanelId: "Image!b",
      position: "bottom",
    });
    expect(splitPlacement([wide, tall], ["Plot!a"])).toEqual({
      targetPanelId: "Plot!a",
      position: "right",
    });
  });

  it("falls back to the largest visible panel, skipping tab panels", () => {
    // Given no usable selection: several selected, or a selected panel that isn't visible
    for (const selected of [[], ["Plot!a", "Image!b"], ["Map!h"]]) {
      // Then the biggest real panel (the Plot, 240k px² vs 180k px²) is split
      expect(splitPlacement([tab, tall, wide, hidden], selected)).toEqual({
        targetPanelId: "Plot!a",
        position: "right",
      });
    }
  });

  it("leaves the layout default when no panel is visible", () => {
    expect(splitPlacement([hidden], [])).toBeUndefined();
  });
});
