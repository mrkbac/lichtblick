// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { IMAGE_BUTTONS } from "@lichtblick/suite-base/panels/ThreeDeeRender/buttons";
import { ALL_SUPPORTED_ANNOTATION_SCHEMAS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/annotations/normalizeAnnotations";
import {
  ALL_SUPPORTED_CALIBRATION_SCHEMAS,
  ALL_SUPPORTED_IMAGE_SCHEMAS,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/schemas";
import { imageGuideSettings } from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/guide";

const docs: PanelDocs = {
  intro:
    "Shows a camera image with annotations, and 3D topics projected onto it given a calibration.",
  schemas: [
    ...ALL_SUPPORTED_IMAGE_SCHEMAS,
    ...ALL_SUPPORTED_CALIBRATION_SCHEMAS,
    ...ALL_SUPPORTED_ANNOTATION_SCHEMAS,
  ],
  buttons: Object.values(IMAGE_BUTTONS),
  settings: imageGuideSettings,
  sections: [
    {
      title: "Tips",
      items: [["Raw images", "Color mode settings appear for raw and depth images."]],
    },
  ],
};
export default docs;
