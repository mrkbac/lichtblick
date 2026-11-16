// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { ALL_SUPPORTED_ANNOTATION_SCHEMAS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/annotations/normalizeAnnotations";
import {
  ALL_SUPPORTED_CALIBRATION_SCHEMAS,
  ALL_SUPPORTED_IMAGE_SCHEMAS,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/schemas";

const docs: PanelDocs = {
  intro:
    "Shows a camera image with annotations, and 3D topics projected onto it given a calibration.",
  schemas: [
    ...ALL_SUPPORTED_IMAGE_SCHEMAS,
    ...ALL_SUPPORTED_CALIBRATION_SCHEMAS,
    ...ALL_SUPPORTED_ANNOTATION_SCHEMAS,
  ],
  sections: [
    {
      title: "Settings",
      items: [
        ["Topic", "The image topic; a matching calibration topic is picked automatically."],
        ["Calibration", "Camera info used to project 3D topics; None shows the image only."],
        ["Sync annotations", "Only draw annotations whose timestamp matches the image."],
        ["Rotation / Flip", "Rotate in 90° steps or mirror the image."],
        ["Brightness / Contrast", "Adjust how the image is drawn."],
        ["Image annotations", "Toggle annotation topics drawn over the image."],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Wheel", "Zoom at the cursor."],
        ["Drag", "Pan the image."],
        ["Reset view", "Button that appears after zooming or panning."],
        ["Right-click", "Download image saves the current frame."],
      ],
    },
    {
      title: "Tips",
      items: [["Raw images", "Color mode settings appear for raw and depth images."]],
    },
  ],
};
export default docs;
