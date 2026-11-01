// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const transformTree = {
  noTransformTopics: "No transform topics found. Waiting for tf, tf_static or FrameTransform data.",
  allTopicsHidden: "All transform topics are hidden. Show one in the panel settings.",
  waitingForTransforms: "Waiting for transforms…",
  frameCount_one: "{{count}} frame",
  frameCount_other: "{{count}} frames",
  staticCount: "{{count}} static",
  multipleRoots: "{{count}} disconnected trees",
  warningCount_one: "{{count}} warning",
  warningCount_other: "{{count}} warnings",
  columns: {
    frame: "Frame",
    x: "x (m)",
    y: "y (m)",
    z: "z (m)",
    roll: "Roll (°)",
    pitch: "Pitch (°)",
    yaw: "Yaw (°)",
    age: "Age (s)",
    rate: "Rate (Hz)",
  },
  static: "static",
  collapse: "Collapse",
  expand: "Expand",
  parent: "Parent: {{parent}}",
  topic: "Topic: {{topic}}",
  quaternion: "Quaternion (x, y, z, w): {{value}}",
  settings: {
    topics: "Topics",
    static: "Static",
    staticHelp:
      "Static transforms are loaded from the whole recording and never reported as stale.",
    topicUnavailable: "Topic is not in the current data source",
  },
  warnings: {
    multipleParents: "Published with more than one parent: {{parents}}",
    stale: "No update for {{age}}, expected about every {{period}}",
    noData: "No transform received since the last seek",
  },
};
