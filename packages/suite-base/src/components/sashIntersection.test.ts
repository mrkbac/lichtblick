/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { crossingSashes } from "./sashIntersection";

/** Adds a sash of a split view to `shell`, laid out at the given rect. */
function addSash(
  shell: HTMLElement,
  orientation: "dv-horizontal" | "dv-vertical",
  rect: { x: number; y: number; width: number; height: number },
): HTMLElement {
  const splitView = document.createElement("div");
  splitView.className = `dv-split-view-container ${orientation}`;
  const sashContainer = document.createElement("div");
  const sash = document.createElement("div");
  sash.className = "dv-sash dv-enabled";
  sash.getBoundingClientRect = () => DOMRect.fromRect(rect);
  sashContainer.appendChild(sash);
  splitView.appendChild(sashContainer);
  shell.appendChild(splitView);
  return sash;
}

describe("crossingSashes", () => {
  it("finds the perpendicular sashes that meet the pointer, not parallel or distant ones", () => {
    const shell = document.createElement("div");
    shell.className = "dv-shell";
    document.body.appendChild(shell);

    // A vertical split line at x=100, with the right side split by a horizontal line at y=200.
    const vertical = addSash(shell, "dv-horizontal", { x: 98, y: 0, width: 4, height: 400 });
    const horizontal = addSash(shell, "dv-vertical", { x: 100, y: 198, width: 300, height: 4 });
    const otherVertical = addSash(shell, "dv-horizontal", { x: 250, y: 0, width: 4, height: 198 });
    addSash(shell, "dv-vertical", { x: 100, y: 300, width: 300, height: 4 });

    expect(crossingSashes(vertical, 100, 200)).toEqual([horizontal]);
    expect(crossingSashes(horizontal, 100, 200)).toEqual([vertical]);
    // Along a split, away from any junction.
    expect(crossingSashes(vertical, 100, 50)).toEqual([]);
    expect(crossingSashes(horizontal, 200, 200)).toEqual([]);
    // A T-junction of the right side's own splits.
    expect(crossingSashes(horizontal, 252, 199)).toEqual([otherVertical]);

    shell.remove();
  });
});
