// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { imageProjectionSettingsNode } from "./topics";

const topic = { name: "/camera/depth" };
const fieldKeys = (config: Parameters<typeof imageProjectionSettingsNode>[1]) =>
  Object.keys(imageProjectionSettingsNode(topic, config, []).fields ?? {});

describe("imageProjectionSettingsNode render modes", () => {
  it("shows distance and planar projection in the default mode", () => {
    expect(fieldKeys({})).toEqual([
      "cameraInfoTopic",
      "renderMode",
      "distance",
      "planarProjectionFactor",
      "color",
    ]);
  });

  it("offers the fixed frame and the given frames for plane projection", () => {
    const node = imageProjectionSettingsNode(topic, { renderMode: "plane" }, [], {
      frameOptions: [{ label: "map", value: "map" }],
    });
    const frameField = node.fields!.projectionFrameId!;
    expect(frameField.input === "select" && frameField.options.map((o) => o.value)).toEqual([
      undefined,
      "map",
    ]);
    const distanceField = node.fields!.projectionDistance!;
    expect(distanceField.input === "number" && distanceField.min).toBe(1);
    expect(node.fields!.distance).toBeUndefined();
  });

  it("shows depth fields and color modes without an RGB topic", () => {
    const node = imageProjectionSettingsNode(topic, { renderMode: "depth" }, [], {
      rgbTopicOptions: [{ label: "/camera/color", value: "/camera/color" }],
    });
    const fields = node.fields!;
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["depthDistanceType", "pointSize", "depthScale", "rgbTopic"]),
    );
    expect(fields.depthDistanceType!.value).toBe("z");
    expect(fields.colorMode!.value).toBe("colormap");
    const colorModes = fields.colorMode!.input === "select" ? fields.colorMode!.options : [];
    expect(colorModes.map((o) => o.value).sort()).toEqual(["colormap", "flat", "gradient"]);
    expect(fields.minValue).toBeDefined();
    const rgbField = fields.rgbTopic!;
    expect(rgbField.input === "select" && rgbField.options.map((o) => o.value)).toEqual([
      undefined,
      "/camera/color",
    ]);
  });

  it("hides the color fields when an RGB topic colors the points", () => {
    const keys = fieldKeys({ renderMode: "depth", rgbTopic: "/camera/color" });
    expect(keys).not.toContain("colorMode");
    expect(keys).not.toContain("flatColor");
  });
});
