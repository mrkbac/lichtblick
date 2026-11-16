// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { sharedI18nObject } from "@lichtblick/suite-base/i18n";

import { AUDIO_BUTTONS } from "./buttons";
import { AUDIO_SCHEMAS } from "./decode";
import { buildSettingsTree } from "./settings";
import { DEFAULT_CONFIG } from "./types";

const docs: PanelDocs = {
  intro: "Plays an audio topic in sync with playback and draws its waveform.",
  schemas: AUDIO_SCHEMAS,
  buttons: Object.values(AUDIO_BUTTONS),
  settings: () =>
    buildSettingsTree(DEFAULT_CONFIG, undefined, [], sharedI18nObject.getFixedT(null, "audio")),
  sections: [
    {
      title: "Data",
      items: [
        ["Other topics", "Any message with data and format fields also works."],
        ["Formats", "PCM (s16, s32, f32, u8, μ-law, A-law), Opus, MP3, AAC, Vorbis, FLAC and WAV."],
        ["Enable audio", "Browsers block sound until you interact with the panel once."],
      ],
    },
  ],
};

export default docs;
