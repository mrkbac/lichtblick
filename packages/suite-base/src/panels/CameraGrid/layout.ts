// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Topic } from "@lichtblick/suite";
import {
  COMPRESSED_IMAGE_DATATYPES as FOXGLOVE_COMPRESSED_IMAGE_DATATYPES,
  COMPRESSED_VIDEO_DATATYPES,
  RAW_IMAGE_DATATYPES as FOXGLOVE_RAW_IMAGE_DATATYPES,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/foxglove";
import {
  COMPRESSED_IMAGE_DATATYPES as ROS_COMPRESSED_IMAGE_DATATYPES,
  IMAGE_DATATYPES as ROS_IMAGE_DATATYPES,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/ros";

export type ImageKind =
  | "raw-ros"
  | "raw-foxglove"
  | "compressed-ros"
  | "compressed-foxglove"
  | "video";

export function imageKind(schemaName: string): ImageKind | undefined {
  if (ROS_IMAGE_DATATYPES.has(schemaName)) {
    return "raw-ros";
  }
  if (FOXGLOVE_RAW_IMAGE_DATATYPES.has(schemaName)) {
    return "raw-foxglove";
  }
  if (ROS_COMPRESSED_IMAGE_DATATYPES.has(schemaName)) {
    return "compressed-ros";
  }
  if (FOXGLOVE_COMPRESSED_IMAGE_DATATYPES.has(schemaName)) {
    return "compressed-foxglove";
  }
  if (COMPRESSED_VIDEO_DATATYPES.has(schemaName)) {
    return "video";
  }
  return undefined;
}

/** Names of all topics carrying a supported image schema, sorted by name so the order is stable. */
export function imageTopicNames(topics: readonly Topic[] | undefined): string[] {
  return (topics ?? [])
    .filter((topic) => imageKind(topic.schemaName) != undefined)
    .map((topic) => topic.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Picks the column count that makes the images as large as possible: each cell shows an image of
 * the given aspect ratio (width / height) letterboxed into a `width` x `height` area split into
 * `columns` x ceil(count / columns) cells.
 */
export function autoColumns(count: number, width: number, height: number, aspect: number): number {
  if (count <= 1 || width <= 0 || height <= 0) {
    return 1;
  }
  let best = 1;
  let bestArea = -1;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const imageWidth = Math.min(cellWidth, cellHeight * aspect);
    const area = imageWidth * (imageWidth / aspect);
    // Strictly greater keeps the fewer-columns layout on ties.
    if (area > bestArea + 1e-6) {
      best = columns;
      bestArea = area;
    }
  }
  return best;
}
