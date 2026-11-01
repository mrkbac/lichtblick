// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";

import { getPanelTypeForPaths } from "./useOpenMessagePathsInPanel";

function topic(name: string, rootSchemaName: string): DraggedMessagePath {
  return {
    path: name,
    rootSchemaName,
    isTopic: true,
    isLeaf: false,
    topicName: name,
  };
}

function field(path: string, { isLeaf }: { isLeaf: boolean }): DraggedMessagePath {
  return {
    path,
    rootSchemaName: "foo/Bar",
    isTopic: false,
    isLeaf,
    topicName: "/foo",
  };
}

describe("getPanelTypeForPaths", () => {
  it.each<[string, DraggedMessagePath[], string]>([
    ["image topic", [topic("/cam", "sensor_msgs/msg/CompressedImage")], "Image"],
    ["foxglove image topic", [topic("/cam", "foxglove.RawImage")], "Image"],
    [
      "two image topics",
      [topic("/a", "sensor_msgs/Image"), topic("/b", "sensor_msgs/Image")],
      "RawMessages",
    ],
    [
      "scene topics",
      [topic("/tf", "tf2_msgs/TFMessage"), topic("/pc", "foxglove.PointCloud")],
      "3D",
    ],
    ["leaf fields", [field("/foo.a", { isLeaf: true }), field("/foo.b", { isLeaf: true })], "Plot"],
    ["non-leaf field", [field("/foo.a", { isLeaf: false })], "RawMessages"],
    ["unknown topic", [topic("/foo", "foo/Bar")], "RawMessages"],
  ])("%s", (_name, paths, expected) => {
    expect(getPanelTypeForPaths(paths)).toBe(expected);
  });
});
