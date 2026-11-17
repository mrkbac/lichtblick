// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";
import type {
  DocumentedFields,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { DEFAULT_CONFIG } from "./constants";
import { ColorModeConfig, GaugeConfig } from "./types";
import { buildSettingsTree } from "./useSettingsTree";

/** Fields of the default config plus the ones shown only in other display and color modes. */
function allFields(): DocumentedNodes {
  const t = sharedI18nObject.getFixedT(null, "gauge");
  const fields = (patch: Partial<GaugeConfig>): DocumentedFields | undefined =>
    buildSettingsTree(
      { config: { ...DEFAULT_CONFIG, ...patch }, pathParseError: undefined, error: undefined },
      t,
    ).general.fields;
  return {
    general: {
      fields: {
        ...fields({}),
        ...fields({ colorMode: ColorModeConfig.GRADIENT }),
        ...fields({ displayMode: "roll" }),
      },
    },
  };
}

const docs: PanelDocs = {
  intro:
    "Shows one numeric value as a colored arc gauge, a slider between min/max limits, or a roll/pitch inclinometer.",
  settings: allFields,
  sections: [
    {
      title: "Data",
      items: [["Message path", "Any single number, e.g. /battery.percentage."]],
    },
  ],
};
export default docs;
