// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { TRANSFORM_TREE_BUTTONS } from "./buttons";
import { buildSettingsTree, DEFAULT_ROTATION_CONVENTION } from "./settings";
import { TRANSFORM_SCHEMAS } from "./transforms";

const docs: PanelDocs = {
  intro:
    "Inspect the coordinate frame tree with live transforms, publish rates and broken or stale frames.",
  schemas: TRANSFORM_SCHEMAS,
  buttons: Object.values(TRANSFORM_TREE_BUTTONS),
  settings: () =>
    buildSettingsTree(
      // One example topic, so the per-topic fields are listed too.
      [{ name: "Transforms", visible: true, isStatic: false, available: true }],
      DEFAULT_ROTATION_CONVENTION,
      sharedI18nObject.getFixedT(null, "transformTree"),
    ),
  sections: [
    {
      title: "Offset editor",
      items: [
        [
          "Offset / Result",
          "Type an offset on top of the recorded transform, or type the result you want. Offsets apply in every panel of the layout.",
        ],
        [
          "Copy as…",
          "Copy the adjusted transform as a URDF joint, static_transform_publisher command or YAML.",
        ],
        ["Reset", "Removes the offset from the frame."],
        ["Show original", "Temporarily render the recorded transforms, ignoring all offsets."],
      ],
    },
    {
      title: "Warnings",
      items: [
        ["Multiple parents", "A frame was published with more than one parent."],
        ["Stale", "No update for several expected periods."],
        ["Disconnected trees", "The frames form more than one tree; the badge lists their roots."],
      ],
    },
  ],
};

export default docs;
