// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { ALL_SUPPORTED_ANNOTATION_SCHEMAS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/annotations/normalizeAnnotations";

import { IMAGE_SCHEMAS } from "./layout";

const docs: PanelDocs = {
  intro: "Shows many camera topics side by side in one grid, with optional annotations.",
  schemas: [...IMAGE_SCHEMAS, ...ALL_SUPPORTED_ANNOTATION_SCHEMAS],
  sections: [
    {
      title: "Settings",
      items: [
        ["Add all compressed image topics", "Adds every compressed image and video topic at once."],
        ["Add camera", "Adds one topic; raw images are only added this way."],
        ["Columns", "Fixed column count; empty picks the layout with the largest images."],
        ["Link zoom", "Zoom and pan all cameras together."],
        ["Sync annotations", "Only draw annotations whose timestamp matches the image."],
        [
          "Annotations",
          "Per camera; defaults to annotation topics in the image topic's namespace.",
        ],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Wheel", "Zoom a camera at the cursor."],
        ["Drag", "Pan a zoomed camera."],
        ["Double-click", "Reset a zoomed camera, otherwise maximize it (again to restore)."],
      ],
    },
  ],
};
export default docs;
