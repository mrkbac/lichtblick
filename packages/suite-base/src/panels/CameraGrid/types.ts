// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export type Rotation = 0 | 90 | 180 | 270;

export type TileConfig = {
  topic: string;
  visible: boolean;
  /** "fit" letterboxes the whole image, "fill" crops it to cover the tile. */
  fit: "fit" | "fill";
  rotation: Rotation;
  flipHorizontal: boolean;
  flipVertical: boolean;
};

export type CameraGridConfig = {
  tiles: TileConfig[];
  /** Fixed column count; undefined picks the count that makes images largest. */
  columns?: number;
  showLabels: boolean;
  showTimestamps: boolean;
};

export const DEFAULT_CONFIG: CameraGridConfig = {
  tiles: [],
  showLabels: true,
  showTimestamps: false,
};

export function makeTile(topic: string): TileConfig {
  return {
    topic,
    visible: true,
    fit: "fit",
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
  };
}
