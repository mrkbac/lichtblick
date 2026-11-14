// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChartOptions } from "chart.js";

import {
  SamplesByPath,
  StateTransitionPath,
} from "@lichtblick/suite-base/panels/StateTransitions/types";
import { fontMonospace } from "@lichtblick/theme";

export const EMPTY_ITEMS_BY_PATH: SamplesByPath = {};
/** Live samples kept per path when the source has no recorded range: about 30 min at 50 Hz. */
export const LIVE_HISTORY_SIZE = 100_000;
/** How often the chart takes live updates. */
export const LIVE_REDRAW_MS = 250;
export const EMPTY_TOPICS: string[] = [];
export const EMPTY_PATHS: string[] = [];

export const DEFAULT_STATE_TRANSITION_PATH: StateTransitionPath = Object.freeze({
  value: "",
  timestampMethod: "receiveTime",
});

export const STATE_TRANSITION_PLUGINS: ChartOptions["plugins"] = {
  datalabels: {
    display: "auto",
    anchor: "center",
    align: -45,
    offset: 0,
    clip: true,
    font: {
      family: fontMonospace,
      size: 10,
      weight: "bold",
    },
  },
  zoom: {
    zoom: {
      enabled: true,
      mode: "x",
      sensitivity: 3,
      speed: 0.1,
    },
    pan: {
      mode: "x",
      enabled: true,
      speed: 20,
      threshold: 10,
    },
  },
};

export const TRANSITIONABLE_ROS_TYPES = [
  "bool",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "string",
];
