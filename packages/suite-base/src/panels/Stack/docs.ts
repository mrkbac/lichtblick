// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { STACK_BUTTONS } from "./buttons";
import { buildSettingsTree, DEFAULT_STACK_CONFIG } from "./settings";

const docs: PanelDocs = {
  intro: "Stack any number of panels in a scrolling list, row or grid.",
  buttons: Object.values(STACK_BUTTONS),
  settings: () =>
    buildSettingsTree(
      { ...DEFAULT_STACK_CONFIG, arrangement: "grid" },
      sharedI18nObject.getFixedT(null, "stack"),
    ),
  sections: [
    {
      title: "Items",
      items: [
        ["Adding", "Drag a panel over the stack and drop it on the bar that appears at the end."],
        ["Splitting", "Drop a panel onto an item's edge to split that item like a layout."],
        ["Sizing", "Drag the edge of an item to resize it; in a grid this sets the row height."],
        ["Title bars", "Each item's title bar shows while you point at the item."],
        [
          "Scrolling",
          "The rail at the side has a bar per item. Scroll over it, drag along it, or pick an item's bar to jump to it.",
        ],
        ["Pausing", "Items scrolled out of view pause where the panel supports it."],
      ],
    },
  ],
};

export default docs;
