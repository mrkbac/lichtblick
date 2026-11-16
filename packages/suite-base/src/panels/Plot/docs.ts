// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";
import { DELTA_OVERLAY_BUTTONS } from "@lichtblick/suite-base/panels/shared/deltaOverlayButtons";

import { PLOT_BUTTONS } from "./buttons";
import { DEFAULT_PLOT_CONFIG } from "./constants";
import { buildSettingsTree } from "./utils/buildSettingsTree";

const docs: PanelDocs = {
  intro:
    "Plots numeric values from any message path over time, against an index, or against another path.",
  buttons: [...Object.values(PLOT_BUTTONS), ...Object.values(DELTA_OVERLAY_BUTTONS)],
  settings: () => buildSettingsTree(DEFAULT_PLOT_CONFIG, sharedI18nObject.getFixedT(null, "plot")),
  sections: [
    {
      title: "Data",
      items: [
        ["Message path", "Any numeric field, e.g. /odom.pose.pose.position.x."],
        ["Reference line", "A fixed value drawn as a horizontal or vertical line."],
        ["Timestamp", "Receive time, header stamp, or a custom field of the same message."],
      ],
    },
  ],
};
export default docs;
