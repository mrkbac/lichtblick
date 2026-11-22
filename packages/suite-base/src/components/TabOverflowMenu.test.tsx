/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { hiddenTabs, tabLabel } from "./TabOverflowMenu";

function box(el: HTMLElement, left: number, right: number) {
  el.getBoundingClientRect = () => ({ left, right }) as DOMRect;
}

describe("hiddenTabs", () => {
  it("lists tabs cut off on either side of the strip, in order", () => {
    const strip = document.createElement("div");
    box(strip, 100, 300);
    const tabs = [
      [40, 110],
      [110, 200],
      [200, 300],
      [300, 380],
    ].map(([left, right]) => {
      const tab = document.createElement("button");
      tab.setAttribute("role", "tab");
      box(tab, left!, right!);
      strip.appendChild(tab);
      return tab;
    });
    expect(hiddenTabs(strip)).toEqual([tabs[0], tabs[3]]);
  });
});

describe("tabLabel", () => {
  it("prefers the accessible name over the text, which may include a badge count", () => {
    const tab = document.createElement("button");
    tab.textContent = "Alerts3";
    expect(tabLabel(tab)).toBe("Alerts3");
    tab.setAttribute("aria-label", "Alerts");
    expect(tabLabel(tab)).toBe("Alerts");
  });
});
