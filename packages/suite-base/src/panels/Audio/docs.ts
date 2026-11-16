// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { AUDIO_SCHEMAS } from "./decode";

const docs: PanelDocs = {
  intro: "Plays an audio topic in sync with playback and draws its waveform.",
  schemas: AUDIO_SCHEMAS,
  sections: [
    {
      title: "Data",
      items: [
        [
          "Detected topics",
          "Topics with a listed schema are offered; the first is picked by default.",
        ],
        ["Other topics", "Any message with data and format fields also works."],
        ["Formats", "PCM (s16, s32, f32, u8, μ-law, A-law), Opus, MP3, AAC, Vorbis, FLAC and WAV."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Format", "Overrides the message's format field."],
        ["Sample rate (Hz)", "Used when the message has no sample_rate field."],
        ["Channels", "Used when the message has no number_of_channels field."],
        ["Volume", "Also adjustable, and mutable, from the panel's controls."],
      ],
    },
    {
      title: "Tips",
      items: [
        ["Enable audio", "Browsers block sound until you click the panel once."],
        ["Drop a topic", "Drag an audio topic onto the panel to play it."],
      ],
    },
  ],
};

export default docs;
