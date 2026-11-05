// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { StoryObj } from "storybook-react-rsbuild";

import Watch from "@lichtblick/suite-base/panels/Watch";
import PanelSetup, { Fixture } from "@lichtblick/suite-base/stories/PanelSetup";

import { WatchConfig } from "./config";

const datatypes: Fixture["datatypes"] = new Map([
  [
    "example/State",
    {
      definitions: [
        { name: "IDLE", type: "uint8", isConstant: true, value: 0 },
        { name: "MOVING", type: "uint8", isConstant: true, value: 1 },
        { name: "mode", type: "uint8" },
        { name: "speed", type: "float64" },
        { name: "label", type: "string" },
        { name: "ok", type: "bool" },
        { name: "ranges", type: "float32", isArray: true },
        { name: "pose", type: "example/Pose" },
      ],
    },
  ],
  [
    "example/Pose",
    {
      definitions: [
        { name: "x", type: "float64" },
        { name: "y", type: "float64" },
      ],
    },
  ],
]);

const fixture: Fixture = {
  datatypes,
  topics: [{ name: "/state", schemaName: "example/State" }],
  frame: {
    "/state": [
      {
        topic: "/state",
        receiveTime: { sec: 10, nsec: 0 },
        schemaName: "example/State",
        sizeInBytes: 0,
        message: {
          mode: 1,
          speed: 12.3456789,
          label: "forward",
          ok: true,
          ranges: [1.5, 2.25, 3, 4, 5, 6],
          pose: { x: 1, y: 2 },
        },
      },
    ],
  },
};

const config: WatchConfig = {
  sparklines: true,
  rows: [
    { id: "a", path: "/state.speed", label: "Speed", precision: 2, unit: "m/s" },
    { id: "b", path: "/state.speed.@mul(3.6)", label: "Speed", precision: 1, unit: "km/h" },
    { id: "c", path: "/state.mode" },
    { id: "d", path: "/state.label" },
    { id: "e", path: "/state.ok" },
    { id: "f", path: "/state.ranges" },
    { id: "g", path: "/state.pose" },
    { id: "h", path: "/state.." },
  ],
};

export default {
  title: "panels/Watch",
  component: Watch,
};

export const Default: StoryObj = {
  render: () => (
    <PanelSetup fixture={fixture} includeSettings>
      <Watch overrideConfig={config} />
    </PanelSetup>
  ),
};

export const Empty: StoryObj = {
  render: () => (
    <PanelSetup fixture={fixture}>
      <Watch />
    </PanelSetup>
  ),
};
