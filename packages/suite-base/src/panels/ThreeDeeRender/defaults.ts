// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Defaults that code outside the 3D panel (layout migrations) needs. Keep this file free of
// `three` and other heavy imports: importing it must not pull the renderer into the entry chunk.

import type { RendererConfig } from "./IRenderer";
import type { CameraState } from "./camera";

export const DEFAULT_CAMERA_STATE: CameraState = {
  distance: 20,
  perspective: true,
  phi: 60,
  target: [0, 0, 0],
  targetOffset: [0, 0, 0],
  targetOrientation: [0, 0, 0, 1],
  thetaOffset: 45,
  fovy: 45,
  near: 0.5,
  far: 5000,
};

export const DEFAULT_PUBLISH_SETTINGS: RendererConfig["publish"] = {
  type: "point",
  poseTopic: "/move_base_simple/goal",
  pointTopic: "/clicked_point",
  poseEstimateTopic: "/initialpose",
  poseEstimateXDeviation: 0.5,
  poseEstimateYDeviation: 0.5,
  poseEstimateThetaDeviation: 0.26179939, // π/12, rounded to 8 digits
};
