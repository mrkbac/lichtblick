// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { Images } from "./Images";
import type { Renderer } from "../Renderer";
import type { ImageRenderable } from "./Images/ImageRenderable";

function hiddenRenderable() {
  return Object.assign(new THREE.Object3D(), {
    userData: { topic: "hidden", settings: { visible: false }, settingsPath: ["topics", "hidden"] },
    dispose: vi.fn(),
    flushPendingDecodes: vi.fn(),
  }) as unknown as ImageRenderable & {
    dispose: ReturnType<typeof vi.fn>;
    flushPendingDecodes: ReturnType<typeof vi.fn>;
  };
}

describe("Images", () => {
  it("disposes the renderable of a hidden topic instead of keeping its texture and decoder", () => {
    const renderer = {
      on: vi.fn(),
      off: vi.fn(),
      topics: [],
      customCameraModels: new Map(),
      config: { topics: {} },
      settings: { errors: { clearPath: vi.fn() }, setNodesForKey: vi.fn() },
    } as unknown as Renderer;
    const images = new Images(renderer);
    const hidden = hiddenRenderable();
    images.renderables.set("hidden", hidden);
    images.add(hidden);

    images.startFrame(0n, "frame", "frame");

    expect(hidden.dispose).toHaveBeenCalledTimes(1);
    expect(images.renderables.size).toBe(0);
    expect(hidden.parent).toBeNull();
  });

  it.each(["/camera/color", "/camera/color/image_raw/compressed"])(
    "keeps hidden paint camera %s subscribed with calibration",
    (topic) => {
      const renderer = {
        on: vi.fn(),
        off: vi.fn(),
        topics: [{ name: "/camera/color/camera_info", schemaName: "sensor_msgs/CameraInfo" }],
        customCameraModels: new Map(),
        config: {
          topics: {
            "/cloud": { visible: true, colorCameraTopic: topic },
            [topic]: { visible: false },
          },
        },
        settings: { errors: { clearPath: vi.fn() }, setNodesForKey: vi.fn() },
      } as unknown as Renderer;
      const images = new Images(renderer);
      const subscriptions = images.getSubscriptions();
      const calibration = subscriptions.find(
        (sub) => sub.type === "schema" && sub.schemaNames.has("sensor_msgs/CameraInfo"),
      )!;
      const video = subscriptions.find(
        (sub) => sub.type === "schema" && sub.schemaNames.has("foxglove.CompressedVideo"),
      )!;
      expect(video.subscription.shouldSubscribe?.(topic)).toBe(true);
      expect(calibration.subscription.shouldSubscribe?.("/camera/color/camera_info")).toBe(true);

      const hidden = hiddenRenderable();
      hidden.userData.topic = topic;
      images.renderables.set(topic, hidden);
      images.add(hidden);
      images.startFrame(0n, "frame", "frame");

      expect(hidden.dispose).not.toHaveBeenCalled();
      expect(hidden.flushPendingDecodes).toHaveBeenCalledTimes(1);
      expect(hidden.visible).toBe(false);
    },
  );

  describe("depth map RGB topic", () => {
    const config = {
      topics: {
        "/depth": { visible: true, renderMode: "depth", rgbTopic: "/color" },
        "/other": { visible: false },
      },
    };
    function makeImages() {
      const renderer = {
        on: vi.fn(),
        off: vi.fn(),
        topics: [],
        customCameraModels: new Map(),
        config,
        settings: { errors: { clearPath: vi.fn() }, setNodesForKey: vi.fn() },
      } as unknown as Renderer;
      return new Images(renderer);
    }
    const rosImageSubscription = (images: Images) =>
      images
        .getSubscriptions()
        .find((sub) => sub.type === "schema" && sub.schemaNames.has("sensor_msgs/Image"))!
        .subscription;

    it("subscribes to the RGB topic of a visible depth map", () => {
      const shouldSubscribe = rosImageSubscription(makeImages()).shouldSubscribe!;
      expect(shouldSubscribe("/depth")).toBe(true);
      expect(shouldSubscribe("/color")).toBe(true);
      expect(shouldSubscribe("/other")).toBe(false);
    });

    it("hands RGB images to the depth map without drawing them itself", () => {
      const images = makeImages();
      const setColorImage = vi.fn();
      const depth = Object.assign(new THREE.Object3D(), {
        userData: { topic: "/depth", settings: config.topics["/depth"] },
        setColorImage,
      }) as unknown as ImageRenderable;
      images.renderables.set("/depth", depth);

      rosImageSubscription(images).handler({
        topic: "/color",
        receiveTime: { sec: 0, nsec: 0 },
        message: {
          header: { frame_id: "camera", stamp: { sec: 0, nsec: 0 } },
          encoding: "rgb8",
          width: 1,
          height: 1,
          step: 3,
          data: new Uint8Array(3),
        },
      } as never);

      expect(setColorImage).toHaveBeenCalledTimes(1);
      expect(images.renderables.has("/color")).toBe(false);
    });
  });
});
