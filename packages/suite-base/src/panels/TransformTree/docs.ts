// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { TRANSFORM_SCHEMAS } from "./transforms";

const docs: PanelDocs = {
  intro:
    "Inspect the coordinate frame tree with live transforms, publish rates and broken or stale frames.",
  schemas: TRANSFORM_SCHEMAS,
  sections: [
    {
      title: "Settings",
      items: [
        ["Rotation angles", "Show roll, pitch and yaw as extrinsic xyz (ROS) or intrinsic XYZ."],
        ["Topics", "Hide transform topics you don't want in the tree."],
        [
          "Static",
          "Per topic: load it from the whole recording and never report it as stale. On by default for topics named *tf_static.",
        ],
      ],
    },
    {
      title: "Interactions",
      items: [
        ["Click a frame", "Opens the offset editor to adjust that transform in every panel."],
        [
          "Offset / Result",
          "Type an offset on top of the recorded transform, or type the result you want.",
        ],
        [
          "Copy as…",
          "Copy the adjusted transform as a URDF joint, static_transform_publisher command or YAML.",
        ],
        ["Show original", "Temporarily render the recorded transforms, ignoring all offsets."],
        ["from / to", "Hover a frame to measure between two frames; shared with 3D panels."],
      ],
    },
    {
      title: "Warnings",
      items: [
        ["Multiple parents", "A frame was published with more than one parent."],
        ["Stale", "No update for several expected periods."],
        [
          "Disconnected trees",
          "The frames form more than one tree; hover the badge to see the roots.",
        ],
      ],
    },
  ],
};

export default docs;
