// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { DEFAULT_CONFIG } from "./constants";
import { buildSettingsTree } from "./settings";

const docs: PanelDocs = {
  intro: "Shows the latest values of a float32 array as shares of a pie chart.",
  settings: () => buildSettingsTree(DEFAULT_CONFIG, 1),
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "A float32[] field; each element becomes one slice, as a percentage of the sum.",
        ],
      ],
    },
  ],
};
export default docs;
