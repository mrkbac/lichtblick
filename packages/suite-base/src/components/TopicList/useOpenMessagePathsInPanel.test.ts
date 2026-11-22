// SPDX-License-Identifier: MPL-2.0

import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";

import {
  getDefaultPanelType,
  getOpenInPanels,
  loadOpenInSchemas,
} from "./useOpenMessagePathsInPanel";

function topic(name: string, rootSchemaName: string): DraggedMessagePath {
  return { path: name, rootSchemaName, isTopic: true, isLeaf: false, topicName: name };
}

function field(path: string, { isLeaf }: { isLeaf: boolean }): DraggedMessagePath {
  return { path, rootSchemaName: "foo/Bar", isTopic: false, isLeaf, topicName: "/foo" };
}

function panel(
  type: string,
  openIn: PanelInfo["openIn"],
  schemas: string[] = [],
  extra: Partial<PanelInfo> = {},
): PanelInfo {
  return {
    title: type,
    type,
    openIn,
    module: async () => await Promise.reject(new Error("not loaded")),
    docs: async () => await Promise.resolve({ default: { intro: "", schemas } }),
    ...extra,
  };
}

const PANELS = [
  panel("3D", { kind: "topic", multiple: true }, ["sensor_msgs/Image", "tf2_msgs/TFMessage"]),
  panel("Image", { kind: "topic" }, ["sensor_msgs/Image"]),
  panel("CameraGrid", { kind: "topic", multiple: true }, ["sensor_msgs/Image"]),
  panel("RosOut", { kind: "topic", multiple: true }, ["rosgraph_msgs/Log"]),
  panel("Gauge", { kind: "field" }),
  panel("Plot", { kind: "field", multiple: true }),
  panel("RawMessages", { kind: "path" }),
  panel("RawMessagesVirtual", { kind: "path" }, [], { hidden: true }),
  panel("Notes", undefined),
];

describe("getOpenInPanels / getDefaultPanelType", () => {
  it.each<[string, DraggedMessagePath[], string[], string]>([
    [
      "image topic",
      [topic("/cam", "sensor_msgs/Image")],
      ["3D", "Image", "CameraGrid", "RawMessages"],
      "Image",
    ],
    [
      "two image topics",
      [topic("/a", "sensor_msgs/Image"), topic("/b", "sensor_msgs/Image")],
      ["3D", "CameraGrid"],
      "CameraGrid",
    ],
    [
      "scene topics",
      [topic("/tf", "tf2_msgs/TFMessage"), topic("/cam", "sensor_msgs/Image")],
      ["3D"],
      "3D",
    ],
    ["log topic", [topic("/log", "rosgraph_msgs/Log")], ["RosOut", "RawMessages"], "RosOut"],
    [
      "one leaf field",
      [field("/foo.a", { isLeaf: true })],
      ["Gauge", "Plot", "RawMessages"],
      "Plot",
    ],
    [
      "leaf fields",
      [field("/foo.a", { isLeaf: true }), field("/foo.b", { isLeaf: true })],
      ["Plot"],
      "Plot",
    ],
    ["non-leaf field", [field("/foo.a", { isLeaf: false })], ["RawMessages"], "RawMessages"],
    ["unknown topic", [topic("/foo", "foo/Bar")], ["RawMessages"], "RawMessages"],
    ["nothing", [], [], "RawMessages"],
  ])("%s", async (_name, paths, expectedPanels, expectedDefault) => {
    const offered = getOpenInPanels(PANELS, await loadOpenInSchemas(PANELS), paths);
    expect(offered.map((p) => p.type)).toEqual(expectedPanels);
    expect(getDefaultPanelType(offered)).toBe(expectedDefault);
  });
});
