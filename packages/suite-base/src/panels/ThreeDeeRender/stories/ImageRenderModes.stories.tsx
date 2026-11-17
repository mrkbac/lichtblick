// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { userEvent, screen } from "storybook/test";
import { StoryObj } from "storybook-react-rsbuild";
import * as THREE from "three";

import { MessageEvent } from "@lichtblick/suite";
import { Topic } from "@lichtblick/suite-base/players/types";
import PanelSetup, { Fixture } from "@lichtblick/suite-base/stories/PanelSetup";

import { FIXED_FRAME_ID, rad2deg, SENSOR_FRAME_ID } from "./common";
import ThreeDeePanel from "../index";
import type { ImageRenderableSettings } from "../renderables/Images/ImageRenderable";
import { CameraInfo, Image, TransformStamped } from "../ros";

export default {
  title: "panels/ThreeDeeRender/ImageRenderModes",
  component: ThreeDeePanel,
  parameters: { colorScheme: "dark" },
};

const WIDTH = 160;
const HEIGHT = 120;
const FOCAL = 100;
const CAMERA_HEIGHT = 1.5;
const WALL_X = 6;

// Optical frame (z forward, y down) looking along the fixed frame's x axis, tilted 25° down
const CAMERA_ROTATION = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), (25 * Math.PI) / 180)
  .multiply(new THREE.Quaternion(-0.5, 0.5, -0.5, 0.5));

const header = { seq: 0, stamp: { sec: 0, nsec: 0 }, frame_id: SENSOR_FRAME_ID };
const event = <T,>(topic: string, schemaName: string, message: T): MessageEvent<T> => ({
  topic,
  receiveTime: { sec: 10, nsec: 0 },
  message,
  schemaName,
  sizeInBytes: 0,
});

const tf = event<TransformStamped>("/tf", "geometry_msgs/TransformStamped", {
  header: { ...header, frame_id: FIXED_FRAME_ID },
  child_frame_id: SENSOR_FRAME_ID,
  transform: {
    translation: { x: 0, y: 0, z: CAMERA_HEIGHT },
    rotation: {
      x: CAMERA_ROTATION.x,
      y: CAMERA_ROTATION.y,
      z: CAMERA_ROTATION.z,
      w: CAMERA_ROTATION.w,
    },
  },
});

const cx = (WIDTH - 1) / 2;
const cy = (HEIGHT - 1) / 2;
const info = event<Partial<CameraInfo>>("/cam/info", "sensor_msgs/CameraInfo", {
  header,
  width: WIDTH,
  height: HEIGHT,
  distortion_model: "",
  D: [],
  K: [FOCAL, 0, cx, 0, FOCAL, cy, 0, 0, 1],
  R: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  P: [FOCAL, 0, cx, 0, 0, FOCAL, cy, 0, 0, 0, 1, 0],
});

/** Z depth (meters) of a ground plane and a wall in front of the camera. */
function sceneDepth(col: number, row: number): number {
  const ray = new THREE.Vector3((col - cx) / FOCAL, (row - cy) / FOCAL, 1);
  ray.applyQuaternion(CAMERA_ROTATION);
  const toGround = ray.z < 0 ? CAMERA_HEIGHT / -ray.z : Infinity;
  const toWall = ray.x > 0 ? WALL_X / ray.x : Infinity;
  const depth = Math.min(toGround, toWall);
  return depth === Infinity ? 0 : depth;
}

const depthData = new Uint8Array(WIDTH * HEIGHT * 2);
const depthView = new DataView(depthData.buffer);
const colorData = new Uint8Array(WIDTH * HEIGHT * 3);
for (let row = 0; row < HEIGHT; row++) {
  for (let col = 0; col < WIDTH; col++) {
    const i = row * WIDTH + col;
    depthView.setUint16(i * 2, Math.round(sceneDepth(col, row) * 1000), true);
    // Checkerboard tinted by column, so plane projection and RGB coloring are easy to read
    const checker = (Math.floor(col / 16) + Math.floor(row / 16)) % 2 === 0;
    colorData[i * 3 + 0] = checker ? 230 : 40;
    colorData[i * 3 + 1] = Math.round((col / WIDTH) * 200);
    colorData[i * 3 + 2] = checker ? 60 : 220;
  }
}

const depth = event<Partial<Image>>("/cam/depth", "sensor_msgs/Image", {
  header,
  width: WIDTH,
  height: HEIGHT,
  encoding: "16UC1",
  is_bigendian: false,
  step: WIDTH * 2,
  data: depthData,
});
const color = event<Partial<Image>>("/cam/color", "sensor_msgs/Image", {
  header,
  width: WIDTH,
  height: HEIGHT,
  encoding: "rgb8",
  is_bigendian: false,
  step: WIDTH * 3,
  data: colorData,
});

const topics: Topic[] = [
  { name: "/tf", schemaName: "geometry_msgs/TransformStamped" },
  { name: "/cam/info", schemaName: "sensor_msgs/CameraInfo" },
  { name: "/cam/depth", schemaName: "sensor_msgs/Image" },
  { name: "/cam/color", schemaName: "sensor_msgs/Image" },
];

const fixture: Fixture = {
  topics,
  frame: {
    "/tf": [tf],
    "/cam/info": [info],
    "/cam/depth": [depth],
    "/cam/color": [color],
  },
  capabilities: [],
  activeData: { currentTime: { sec: 0, nsec: 0 } },
};

type Args = {
  includeSettings?: boolean;
  topics: Record<string, Partial<ImageRenderableSettings>>;
};

const Template: StoryObj<Args> = {
  render: function Story({ includeSettings = false, topics: topicSettings }: Args) {
    return (
      <PanelSetup fixture={fixture} includeSettings={includeSettings}>
        <ThreeDeePanel
          overrideConfig={{
            ...ThreeDeePanel.defaultConfig,
            followTf: FIXED_FRAME_ID,
            scene: { labelScaleFactor: 0 },
            cameraState: {
              distance: 14,
              perspective: true,
              phi: rad2deg(0.9),
              targetOffset: [3, 0, 0],
              thetaOffset: rad2deg(-2.2),
              fovy: rad2deg(0.75),
              near: 0.01,
              far: 5000,
              target: [0, 0, 0],
              targetOrientation: [0, 0, 0, 1],
            },
            topics: {
              "/cam/info": { visible: true, distance: 0.5 },
              ...topicSettings,
            },
          }}
        />
      </PanelSetup>
    );
  },
};

export const PlaneProjection: StoryObj<Args> = {
  ...Template,
  args: {
    topics: {
      "/cam/color": { visible: true, cameraInfoTopic: "/cam/info", renderMode: "plane" },
    },
  },
};

export const PlaneProjectionMaxDistance: StoryObj<Args> = {
  ...Template,
  args: {
    topics: {
      "/cam/color": {
        visible: true,
        cameraInfoTopic: "/cam/info",
        renderMode: "plane",
        projectionDistance: 4,
      },
    },
  },
};

export const DepthMapColorMap: StoryObj<Args> = {
  ...Template,
  args: {
    topics: {
      "/cam/depth": {
        visible: true,
        cameraInfoTopic: "/cam/info",
        renderMode: "depth",
        pointSize: 3,
      },
    },
  },
};

export const DepthMapRgbTopic: StoryObj<Args> = {
  ...Template,
  args: {
    topics: {
      "/cam/depth": {
        visible: true,
        cameraInfoTopic: "/cam/info",
        renderMode: "depth",
        rgbTopic: "/cam/color",
        pointSize: 3,
      },
    },
  },
};

export const DepthMapSettings: StoryObj<Args> = {
  ...Template,
  args: {
    includeSettings: true,
    topics: {
      "/cam/depth": {
        visible: true,
        cameraInfoTopic: "/cam/info",
        renderMode: "depth",
        colorMode: "gradient",
        pointSize: 3,
      },
    },
  },
  play: async () => {
    await userEvent.click(
      await screen.findByTestId("settings__nodeHeaderToggle__topics-/cam/depth"),
    );
  },
};
