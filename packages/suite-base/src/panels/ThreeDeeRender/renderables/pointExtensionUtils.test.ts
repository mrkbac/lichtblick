// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { SettingsTreeField, Topic } from "@lichtblick/suite";
import { IRenderer } from "@lichtblick/suite-base/panels/ThreeDeeRender/IRenderer";
import { LayerErrors } from "@lichtblick/suite-base/panels/ThreeDeeRender/LayerErrors";
import { MISSING_TRANSFORM } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/transforms";
import { updatePose } from "@lichtblick/suite-base/panels/ThreeDeeRender/updatePose";
import { BasicBuilder } from "@lichtblick/test-builders";

import { pointSettingsNode, RenderObjectHistory } from "./pointExtensionUtils";

vi.mock("@lichtblick/suite-base/panels/ThreeDeeRender/updatePose", () => ({
  updatePose: vi.fn(),
}));

type SettingsTreeFieldWithOptions = SettingsTreeField & {
  options: { label: string; value: string };
};

// Foxglove messages
const RGBA_OPTION = { label: "RGBA (separate fields)", value: "rgba-fields" };
const FOXGLOVE_POINTCLOUD_DATATYPE = "foxglove.PointCloud";
const VALID_MESSAGE_FIELDS = ["red", "blue", "green", "alpha"];

// ROS messages
const BGR_OPTION_ROS = { label: "BGR (packed)", value: "rgb" };
const BGRA_OPTION_ROS = { label: "BGRA (packed)", value: "rgba" };
const ROS_POINTCLOUD_DATATYPE = "sensor_msgs/PointCloud2";

describe("pointExtensionUtils", () => {
  describe("colorModeFields", () => {
    const createTopic = (topicArgs?: Partial<Topic>): Topic => {
      return {
        name: BasicBuilder.string(),
        schemaName: BasicBuilder.string(),
        ...topicArgs,
      };
    };

    it("should include RGBA color mode when topic schema is valid and contains RGBA fields", () => {
      const mockTopic = createTopic({ schemaName: FOXGLOVE_POINTCLOUD_DATATYPE });

      const panelSettings = pointSettingsNode(mockTopic, VALID_MESSAGE_FIELDS, {});
      const colorMode = panelSettings.fields!.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should include RGBA color mode when topic is convertible to a valid schema and contains RGBA fields", () => {
      const mockTopic = createTopic({ convertibleTo: [FOXGLOVE_POINTCLOUD_DATATYPE] });

      const panelSettings = pointSettingsNode(mockTopic, VALID_MESSAGE_FIELDS, {});
      const colorMode = panelSettings.fields!.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should not include RGBA color mode when topic has no RGBA fields", () => {
      const mockTopic = createTopic({ convertibleTo: [FOXGLOVE_POINTCLOUD_DATATYPE] });

      const panelSettings = pointSettingsNode(mockTopic, [], {});
      const colorMode = panelSettings.fields!.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should not include RGBA color mode when topic schema is invalid, even with valid RGBA fields", () => {
      const mockTopic = createTopic();

      const panelSettings = pointSettingsNode(mockTopic, VALID_MESSAGE_FIELDS, {});
      const colorMode = panelSettings.fields!.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
      expect(colorMode.options).toEqual(
        expect.not.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]),
      );
    });

    it("should include BGR and BGRA color modes for ROS PointCloud2 messages", () => {
      const mockTopic = createTopic({ schemaName: ROS_POINTCLOUD_DATATYPE });

      const panelSettings = pointSettingsNode(mockTopic, BasicBuilder.strings(), {});
      const colorMode = panelSettings.fields!.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]));
      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
    });

    it("should include BGR and BGRA color modes for ROS PointCloud2 messages from message converter", () => {
      const mockTopic = createTopic({ convertibleTo: [ROS_POINTCLOUD_DATATYPE] });

      const panelSettings = pointSettingsNode(mockTopic, BasicBuilder.strings(), {});
      const colorMode = panelSettings.fields!.colorMode! as SettingsTreeFieldWithOptions;

      expect(colorMode.options).toEqual(expect.arrayContaining([BGR_OPTION_ROS, BGRA_OPTION_ROS]));
      expect(colorMode.options).toEqual(expect.not.arrayContaining([RGBA_OPTION]));
    });
  });

  describe("pointShape", () => {
    const topic: Topic = { name: "/points", schemaName: ROS_POINTCLOUD_DATATYPE };

    it("shows cube size instead of point size for cubes", () => {
      const node = pointSettingsNode(topic, [], { pointShape: "cube", cubeSize: 0.2 });
      expect(node.fields!.cubeSize?.value).toBe(0.2);
      expect(node.fields!.pointSize).toBeUndefined();
    });

    it("shows point size for flat shapes", () => {
      const node = pointSettingsNode(topic, [], { pointShape: "square" });
      expect(node.fields!.pointSize).toBeDefined();
      expect(node.fields!.cubeSize).toBeUndefined();
    });

    it("only offers the given shapes", () => {
      const node = pointSettingsNode(topic, [], {}, undefined, ["circle", "square"]);
      const pointShape = node.fields!.pointShape as SettingsTreeFieldWithOptions;
      expect(pointShape.options).toEqual([
        { label: "Circle", value: "circle" },
        { label: "Square", value: "square" },
      ]);
    });
  });

  describe("RenderObjectHistory", () => {
    it("clears the missing transform error once the transform arrives", () => {
      const path = ["topics", "/points"];
      const errors = new LayerErrors();
      const renderer = { transformTree: {}, settings: { errors } } as unknown as IRenderer;
      const parentRenderable = {
        userData: { frameId: "lidar", settingsPath: path, settings: { decayTime: 0 } },
      } as unknown as ConstructorParameters<typeof RenderObjectHistory>[0]["parentRenderable"];
      const renderable = Object.assign(new THREE.Object3D(), { dispose: () => {} });
      const history = new RenderObjectHistory({
        initial: { receiveTime: 0n, messageTime: 0n, renderable },
        renderer,
        parentRenderable,
      });

      vi.mocked(updatePose).mockReturnValue(false);
      history.updatePoses(0n, "map", "map");
      expect(errors.hasError(path, MISSING_TRANSFORM)).toBe(true);
      expect(console.warn).toHaveBeenCalledTimes(1);
      (console.warn as ReturnType<typeof vi.fn>).mockClear();

      vi.mocked(updatePose).mockReturnValue(true);
      history.updatePoses(0n, "map", "map");
      expect(errors.hasError(path, MISSING_TRANSFORM)).toBe(false);
    });
  });
});
