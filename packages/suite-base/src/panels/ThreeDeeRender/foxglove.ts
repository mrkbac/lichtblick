// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { addFoxgloveSchema } from "@lichtblick/suite-base/util/foxgloveSchemas";

// Re-exported so existing consumers keep importing it from here; the single source of truth lives
// in `util/foxgloveSchemas` so the player layer can share it without importing a panel module.
export { COMPRESSED_VIDEO_DATATYPES } from "@lichtblick/suite-base/util/foxgloveSchemas";

const foxgloveSchemas = (...schemas: string[]): Set<string> =>
  schemas.reduce((output, schema) => addFoxgloveSchema(output, schema), new Set<string>());

export const FRAME_TRANSFORM_DATATYPES = foxgloveSchemas("foxglove.FrameTransform");
export const FRAME_TRANSFORMS_DATATYPES = foxgloveSchemas("foxglove.FrameTransforms");
export const POINTCLOUD_DATATYPES = foxgloveSchemas("foxglove.PointCloud");
export const LASERSCAN_DATATYPES = foxgloveSchemas("foxglove.LaserScan");
export const RAW_IMAGE_DATATYPES = foxgloveSchemas("foxglove.RawImage");
export const COMPRESSED_IMAGE_DATATYPES = foxgloveSchemas("foxglove.CompressedImage");
export const CAMERA_CALIBRATION_DATATYPES = foxgloveSchemas("foxglove.CameraCalibration");
export const SCENE_UPDATE_DATATYPES = foxgloveSchemas("foxglove.SceneUpdate");
export const POSE_IN_FRAME_DATATYPES = foxgloveSchemas("foxglove.PoseInFrame");
export const POSES_IN_FRAME_DATATYPES = foxgloveSchemas("foxglove.PosesInFrame");
export const GRID_DATATYPES = foxgloveSchemas("foxglove.Grid");
export const VOXEL_GRID_DATATYPES = foxgloveSchemas("foxglove.VoxelGrid");
export const IMAGE_ANNOTATIONS_DATATYPES = foxgloveSchemas("foxglove.ImageAnnotations");
export const ODOMETRY_DATATYPES = foxgloveSchemas("foxglove.Odometry");
export const POINT3_IN_FRAME_DATATYPES = foxgloveSchemas("foxglove.Point3InFrame");

/** `foxglove.JointStates`, and `foxglove.JointState` for a topic that carries a single joint. */
export const JOINT_STATES_DATATYPES = foxgloveSchemas(
  "foxglove.JointStates",
  "foxglove.JointState",
);
