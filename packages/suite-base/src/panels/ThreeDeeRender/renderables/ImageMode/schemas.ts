// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Kept apart from constants.ts (which pulls in three.js) so panel docs can import them.

import {
  CAMERA_CALIBRATION_DATATYPES,
  COMPRESSED_IMAGE_DATATYPES,
  COMPRESSED_VIDEO_DATATYPES,
  RAW_IMAGE_DATATYPES,
} from "../../foxglove";
import {
  IMAGE_DATATYPES as ROS_IMAGE_DATATYPES,
  COMPRESSED_IMAGE_DATATYPES as ROS_COMPRESSED_IMAGE_DATATYPES,
  CAMERA_INFO_DATATYPES,
} from "../../ros";

export const ALL_SUPPORTED_IMAGE_SCHEMAS = new Set([
  ...ROS_IMAGE_DATATYPES,
  ...ROS_COMPRESSED_IMAGE_DATATYPES,
  ...RAW_IMAGE_DATATYPES,
  ...COMPRESSED_IMAGE_DATATYPES,
  ...COMPRESSED_VIDEO_DATATYPES,
]);

export const SUPPORTED_RAW_IMAGE_SCHEMAS = new Set([
  ...RAW_IMAGE_DATATYPES,
  ...ROS_IMAGE_DATATYPES,
]);

export const ALL_SUPPORTED_CALIBRATION_SCHEMAS = new Set([
  ...CAMERA_INFO_DATATYPES,
  ...CAMERA_CALIBRATION_DATATYPES,
]);
