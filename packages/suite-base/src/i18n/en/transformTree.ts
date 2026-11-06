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
  notYetPublishedCount: "{{count}} not published yet",
  warningCount_one: "{{count}} warning",
  warningCount_other: "{{count}} warnings",
  adjustedCount: "{{count}} adjusted",
  rotationConvention: {
    extrinsic:
      "Roll, pitch and yaw turn around the parent's fixed axes: x, then y, then z (extrinsic xyz, as in tf2 getRPY and URDF rpy). Change it in the panel settings.",
    intrinsic:
      "Roll, pitch and yaw turn around the frame's own axes: X, then Y, then Z, each turn on the already rotated axes (intrinsic XYZ). Change it in the panel settings.",
  },
  showingOriginal: "showing original",
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
  notYetPublished: "Not published yet at this point in the recording; values are from later on",
  adjusted: "adjusted",
  adjustedDetails: "Adjusted: values include an offset. Recorded x, y, z: {{xyz}}",
  selectToAdjust: "Click to adjust",
  editor: {
    title: "Adjust {{frame}}",
    stepLabel: "Step size",
    step: { fine: "1 mm · 0.01°", medium: "1 cm · 0.1°", coarse: "10 cm · 1°" },
    close: "Close",
    offset: "Offset",
    offsetHelp:
      "Applied on top of the recorded transform: translation along the parent's axes, then the rotation around the frame's own origin.",
    result: "Result",
    resultNoData: "No transform at the current time yet; edit the offset or wait for data.",
    resultHelp:
      "The transform that is rendered. Type a value here and the offset is computed for you.",
    rotationConvention: {
      extrinsic:
        "Offset and Result angles turn around the parent's fixed axes: x, then y, then z (extrinsic xyz, as in tf2 getRPY and URDF rpy). Change it in the panel settings.",
      intrinsic:
        "Offset and Result angles turn around the frame's own axes: X, then Y, then Z, each turn on the already rotated axes (intrinsic XYZ). Change it in the panel settings.",
    },
    showOriginal: "Show original",
    showOriginalHelp: "Render the recorded transforms in every panel, ignoring all offsets",
    reset: "Reset",
    copy: "Copy as…",
    copyUrdf: "URDF joint",
    copyStaticTransformPublisher: "ROS 2 static_transform_publisher",
    copyYaml: "YAML",
  },
  settings: {
    general: "General",
    rotationConvention: "Rotation angles",
    extrinsic: "Extrinsic xyz (ROS, fixed axes)",
    intrinsic: "Intrinsic XYZ (own axes)",
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
