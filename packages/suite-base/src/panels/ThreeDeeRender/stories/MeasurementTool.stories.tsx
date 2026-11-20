// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StoryObj } from "storybook-react-rsbuild";

import { MessageEvent } from "@lichtblick/suite";
import { Topic } from "@lichtblick/suite-base/players/types";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import delay from "@lichtblick/suite-base/util/delay";

import { makeColor, QUAT_IDENTITY, rad2deg, TEST_COLORS } from "./common";
import ThreeDeePanel from "../index";
import { Marker, TransformStamped } from "../ros";

export default {
  title: "panels/ThreeDeeRender",
  component: ThreeDeePanel,
};

export const MeasurementTool: StoryObj = {
  render: function Story() {
    const topics: Topic[] = [{ name: "/tf", schemaName: "geometry_msgs/TransformStamped" }];
    const tf1: MessageEvent<TransformStamped> = {
      topic: "/tf",
      receiveTime: { sec: 10, nsec: 0 },
      message: {
        header: { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "map" },
        child_frame_id: "base_link",
        transform: {
          translation: { x: 1e7, y: 0, z: 0 },
          rotation: QUAT_IDENTITY,
        },
      },
      schemaName: "geometry_msgs/TransformStamped",
      sizeInBytes: 0,
    };

    const fixture = {
      topics,
      frame: { "/tf": [tf1] },
      capabilities: [],
      activeData: {
        currentTime: { sec: 0, nsec: 0 },
      },
    };
    return (
      <PanelSetup fixture={fixture}>
        <ThreeDeePanel
          overrideConfig={{
            ...ThreeDeePanel.defaultConfig,
            followTf: "base_link",
            layers: {
              grid: { layerId: "foxglove.Grid" },
            },
            cameraState: {
              distance: 5.5,
              perspective: true,
              phi: rad2deg(0.5),
              targetOffset: [-0.5, 0.75, 0],
              thetaOffset: rad2deg(-0.25),
              fovy: rad2deg(0.75),
              near: 0.01,
              far: 5000,
              target: [0, 0, 0],
              targetOrientation: [0, 0, 0, 1],
            },
          }}
        />
      </PanelSetup>
    );
  },

  parameters: { colorScheme: "dark", chromatic: { delay: 200 } },

  play: async () => {
    document.querySelector<HTMLElement>("[data-testid=measure-button]")!.click();
    await delay(100);
    document
      .querySelector("canvas")!
      .dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 100 }));
    document
      .querySelector("canvas")!
      .dispatchEvent(new MouseEvent("click", { clientX: 100, clientY: 100 }));
    document
      .querySelector("canvas")!
      .dispatchEvent(new MouseEvent("mousedown", { clientX: 300, clientY: 200 }));
    document
      .querySelector("canvas")!
      .dispatchEvent(new MouseEvent("click", { clientX: 300, clientY: 200 }));
    await delay(100);
  },
};

/** A box on the ground, viewed at an angle: a profile across it should show its top, not what the camera ray hits */
export const MeasurementProfile: StoryObj = {
  render: function Story() {
    const topics: Topic[] = [
      { name: "/tf", schemaName: "geometry_msgs/TransformStamped" },
      { name: "/markers", schemaName: "visualization_msgs/Marker" },
    ];
    const tf: MessageEvent<TransformStamped> = {
      topic: "/tf",
      receiveTime: { sec: 10, nsec: 0 },
      message: {
        header: { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "map" },
        child_frame_id: "base_link",
        transform: { translation: { x: 0, y: 0, z: 0 }, rotation: QUAT_IDENTITY },
      },
      schemaName: "geometry_msgs/TransformStamped",
      sizeInBytes: 0,
    };
    const box = (id: number, x: number, z: number): MessageEvent<Marker> => ({
      topic: "/markers",
      receiveTime: { sec: 10, nsec: 0 },
      message: {
        header: { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: "map" },
        id,
        ns: "",
        type: 1,
        action: 0,
        frame_locked: false,
        pose: { position: { x, y: 0, z: z / 2 }, orientation: QUAT_IDENTITY },
        scale: { x: id === 0 ? 8 : 1, y: id === 0 ? 4 : 1, z },
        color: makeColor(id === 0 ? TEST_COLORS.MARKER_GREEN1 : TEST_COLORS.MARKER_RED1, 1),
        lifetime: { sec: 0, nsec: 0 },
        points: [],
        colors: [],
        text: "",
        mesh_resource: "",
        mesh_use_embedded_materials: false,
      },
      schemaName: "visualization_msgs/Marker",
      sizeInBytes: 0,
    });
    const fixture = {
      topics,
      frame: { "/tf": [tf], "/markers": [box(0, 0, 0.02), box(1, 0, 1)] },
      capabilities: [],
      activeData: { currentTime: { sec: 0, nsec: 0 } },
    };
    return (
      <PanelSetup fixture={fixture}>
        <ThreeDeePanel
          overrideConfig={{
            ...ThreeDeePanel.defaultConfig,
            followTf: "base_link",
            topics: { "/markers": { visible: true } },
            cameraState: {
              distance: 9,
              perspective: true,
              phi: rad2deg(1.1),
              targetOffset: [0, 0, 0],
              thetaOffset: rad2deg(-1.2),
              fovy: rad2deg(0.75),
              near: 0.01,
              far: 5000,
              target: [0, 0, 0],
              targetOrientation: [0, 0, 0, 1],
            },
          }}
        />
      </PanelSetup>
    );
  },
  parameters: { colorScheme: "dark" },
};
