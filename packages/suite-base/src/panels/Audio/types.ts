// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AudioFormat } from "./decode";

export type AudioConfig = {
  /** Undefined: the first topic with an audio schema. */
  topic?: string;
  /** "auto" reads the message's `format` field. */
  format: AudioFormat | "auto";
  /** Fallbacks for messages without sample_rate / number_of_channels. */
  sampleRate: number;
  channels: number;
  volume: number;
  muted: boolean;
};

export const DEFAULT_CONFIG: AudioConfig = {
  format: "auto",
  sampleRate: 16000,
  channels: 1,
  volume: 1,
  muted: false,
};
