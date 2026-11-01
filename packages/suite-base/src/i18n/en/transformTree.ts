// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const transformTree = {
  noTransformTopics: "No transform topics found. Waiting for tf, tf_static or FrameTransform data.",
  waitingForTransforms: "Waiting for transforms…",
  frameCount_one: "{{count}} frame",
  frameCount_other: "{{count}} frames",
  staticCount: "{{count}} static",
  multipleRoots: "{{count}} disconnected trees",
  warningCount_one: "{{count}} warning",
  warningCount_other: "{{count}} warnings",
  frame: "Frame",
  translation: "Translation (m)",
  rotation: "Roll, pitch, yaw (°)",
  age: "Age",
  rate: "Rate",
  static: "static",
  collapse: "Collapse",
  expand: "Expand",
  parent: "Parent: {{parent}}",
  topic: "Topic: {{topic}}",
  quaternion: "Quaternion (x, y, z, w): {{value}}",
  warnings: {
    multipleParents: "Published with more than one parent: {{parents}}",
    stale: "No update for {{age}}, expected about every {{period}}",
    noData: "No transform received since the last seek",
  },
};
