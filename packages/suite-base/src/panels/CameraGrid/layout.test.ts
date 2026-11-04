// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { autoColumns, imageKind, imageTopicNames } from "./layout";

describe("imageTopicNames", () => {
  it("keeps only image topics, sorted by name", () => {
    const topics = [
      { name: "/cam/right/image", schemaName: "sensor_msgs/msg/Image" },
      { name: "/tf", schemaName: "tf2_msgs/msg/TFMessage" },
      { name: "/cam/left/compressed", schemaName: "sensor_msgs/CompressedImage" },
      { name: "/cam/Back", schemaName: "foxglove.CompressedImage" },
      { name: "/cam/front", schemaName: "foxglove.RawImage" },
      { name: "/video", schemaName: "foxglove.CompressedVideo" },
    ];
    expect(imageTopicNames(topics)).toEqual([
      "/cam/Back",
      "/cam/front",
      "/cam/left/compressed",
      "/cam/right/image",
    ]);
    expect(imageTopicNames(undefined)).toEqual([]);
  });

  it("classifies schemas", () => {
    expect(imageKind("sensor_msgs/Image")).toBe("raw-ros");
    expect(imageKind("foxglove_msgs/msg/RawImage")).toBe("raw-foxglove");
    expect(imageKind("sensor_msgs/msg/CompressedImage")).toBe("compressed-ros");
    expect(imageKind("foxglove.CompressedImage")).toBe("compressed-foxglove");
    expect(imageKind("std_msgs/String")).toBeUndefined();
  });
});

describe("autoColumns", () => {
  it("uses one column for zero or one tile and for an unmeasured panel", () => {
    expect(autoColumns(0, 800, 600, 4 / 3)).toBe(1);
    expect(autoColumns(1, 800, 600, 4 / 3)).toBe(1);
    expect(autoColumns(4, 0, 0, 4 / 3)).toBe(1);
  });

  it("makes a square grid for square-ish panels", () => {
    expect(autoColumns(4, 800, 600, 4 / 3)).toBe(2);
    expect(autoColumns(9, 800, 600, 4 / 3)).toBe(3);
  });

  it("follows the panel shape", () => {
    expect(autoColumns(4, 1600, 300, 4 / 3)).toBe(4);
    expect(autoColumns(4, 300, 1600, 4 / 3)).toBe(1);
    expect(autoColumns(6, 1920, 800, 16 / 9)).toBe(3);
  });

  it("accounts for the image aspect ratio", () => {
    // Tall (rotated) images fit more columns in the same panel.
    expect(autoColumns(4, 1600, 800, 16 / 9)).toBe(2);
    expect(autoColumns(4, 1600, 800, 9 / 16)).toBe(4);
  });
});
