// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";
import { DELTA_OVERLAY_BUTTONS } from "@lichtblick/suite-base/panels/shared/deltaOverlayButtons";

import { STATE_TRANSITIONS_BUTTONS } from "./buttons";
import { buildSettingsTree, defaultConfig } from "./settings";

const docs: PanelDocs = {
  intro: "Shows how discrete values, like states or modes, change over time as colored bars.",
  buttons: [...Object.values(STATE_TRANSITIONS_BUTTONS), ...Object.values(DELTA_OVERLAY_BUTTONS)],
  settings: () =>
    buildSettingsTree(defaultConfig, [], sharedI18nObject.getFixedT(null, "stateTransitions")),
  sections: [
    {
      title: "Data",
      items: [
        [
          "Message path",
          "One value per message, e.g. /robot_state.mode; each distinct value gets a color.",
        ],
        [
          "Match count",
          "With a condition set, the toolbar shows how many matches the playhead has passed, out of all matches.",
        ],
      ],
    },
  ],
};
export default docs;
