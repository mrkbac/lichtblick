// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";

import {
  AUDIO_FORMATS,
  AudioFormat,
  MAX_CHANNELS,
  MAX_SAMPLE_RATE,
  MIN_SAMPLE_RATE,
} from "./decode";
import { AudioConfig } from "./types";

export const FORMAT_LABELS: Record<AudioFormat, string> = {
  s16: "PCM 16-bit",
  s16be: "PCM 16-bit big-endian",
  s32: "PCM 32-bit",
  f32: "PCM float32",
  u8: "PCM 8-bit unsigned",
  mulaw: "G.711 µ-law",
  alaw: "G.711 A-law",
  opus: "Opus",
  mp3: "MP3",
  aac: "AAC (ADTS)",
  vorbis: "Ogg Vorbis (file per message)",
  flac: "FLAC (file per message)",
  wav: "WAV (file per message)",
};

export function buildSettingsTree(
  config: AudioConfig,
  topic: string | undefined,
  audioTopics: readonly string[],
  t: TFunction<"audio">,
): SettingsTreeNodes {
  return {
    general: {
      label: t("general"),
      fields: {
        topic: {
          label: t("topic"),
          input: "autocomplete",
          value: topic ?? "",
          items: [...audioTopics],
        },
        format: {
          label: t("format"),
          input: "select",
          value: config.format,
          options: [
            { label: t("autoFormat"), value: "auto" },
            ...AUDIO_FORMATS.map((value) => ({ label: FORMAT_LABELS[value], value })),
          ],
        },
        sampleRate: {
          label: t("sampleRate"),
          help: t("sampleRateHelp"),
          input: "number",
          value: config.sampleRate,
          min: MIN_SAMPLE_RATE,
          max: MAX_SAMPLE_RATE,
          step: 1000,
        },
        channels: {
          label: t("channels"),
          help: t("channelsHelp"),
          input: "number",
          value: config.channels,
          min: 1,
          max: MAX_CHANNELS,
          step: 1,
        },
        volume: {
          label: t("volume"),
          input: "slider",
          value: config.volume,
          min: 0,
          max: 1,
          step: 0.05,
        },
      },
    },
  };
}

export function settingsUpdate(action: SettingsTreeAction): Partial<AudioConfig> | undefined {
  if (action.action !== "update") {
    return undefined;
  }
  const field = action.payload.path[1];
  const value = action.payload.value;
  switch (field) {
    case "topic":
      return { topic: typeof value === "string" && value !== "" ? value : undefined };
    case "format":
      return { format: value as AudioConfig["format"] };
    case "sampleRate":
    case "channels":
    case "volume":
      return typeof value === "number" ? { [field]: value } : undefined;
    default:
      return undefined;
  }
}
