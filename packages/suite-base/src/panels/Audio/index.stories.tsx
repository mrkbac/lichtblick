// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { StoryObj } from "storybook-react-rsbuild";

import PanelSetup, { Fixture } from "@lichtblick/suite-base/stories/PanelSetup";

import Audio from "./index";

function sine(frequency: number, sampleRate: number, seconds: number): Uint8Array {
  const samples = new Int16Array(Math.round(sampleRate * seconds));
  samples.forEach((_, i) => {
    samples[i] = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 8000);
  });
  return new Uint8Array(samples.buffer);
}

const rawAudio: Fixture = {
  topics: [{ name: "/microphone", schemaName: "foxglove.RawAudio" }],
  frame: {
    "/microphone": [
      {
        topic: "/microphone",
        schemaName: "foxglove.RawAudio",
        receiveTime: { sec: 1, nsec: 0 },
        sizeInBytes: 0,
        message: {
          timestamp: { sec: 1, nsec: 0 },
          data: sine(440, 48000, 0.1),
          format: "pcm-s16",
          sample_rate: 48000,
          number_of_channels: 1,
        },
      },
    ],
  },
};

const missingFormat: Fixture = {
  topics: [{ name: "/audio", schemaName: "audio_common_msgs/AudioData" }],
  frame: {
    "/audio": [
      {
        topic: "/audio",
        schemaName: "audio_common_msgs/AudioData",
        receiveTime: { sec: 1, nsec: 0 },
        sizeInBytes: 0,
        message: { data: new Uint8Array(16) },
      },
    ],
  },
};

export default {
  title: "panels/Audio",
  component: Audio,
};

export const RawAudio: StoryObj = {
  render: () => (
    <PanelSetup fixture={rawAudio}>
      <Audio />
    </PanelSetup>
  ),
};

export const MissingFormat: StoryObj = {
  render: () => (
    <PanelSetup fixture={missingFormat}>
      <Audio />
    </PanelSetup>
  ),
};

export const NoAudioTopic: StoryObj = {
  render: () => (
    <PanelSetup fixture={{ topics: [{ name: "/odom", schemaName: "nav_msgs/Odometry" }] }}>
      <Audio />
    </PanelSetup>
  ),
};
