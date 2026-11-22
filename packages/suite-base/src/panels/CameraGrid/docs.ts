// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";
import { ALL_SUPPORTED_ANNOTATION_SCHEMAS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/annotations/normalizeAnnotations";

import { IMAGE_SCHEMAS } from "./layout";
import { buildSettingsTree } from "./settings";
import { DEFAULT_CONFIG, makeTile } from "./types";

const docs: PanelDocs = {
  intro: "Shows many camera topics side by side in one grid, with optional annotations.",
  schemas: [...IMAGE_SCHEMAS, ...ALL_SUPPORTED_ANNOTATION_SCHEMAS],
  openInSchemas: IMAGE_SCHEMAS,
  // One example camera, so the per-camera fields are listed too.
  settings: () =>
    buildSettingsTree(
      { ...DEFAULT_CONFIG, tiles: [makeTile("Camera")] },
      [],
      [],
      sharedI18nObject.getFixedT(null, "cameraGrid"),
    ),
};
export default docs;
