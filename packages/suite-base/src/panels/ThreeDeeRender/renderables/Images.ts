// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import { CompressedImage, RawImage } from "@foxglove/schemas";
import * as THREE from "three";
import { assert } from "ts-essentials";

import { selectCameraModel } from "@lichtblick/den/image";
import { CameraModelsMap } from "@lichtblick/den/image/types";
import Logger from "@lichtblick/log";
import { SettingsTreeAction } from "@lichtblick/suite";
import { ALL_SUPPORTED_IMAGE_SCHEMAS } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ImageMode/schemas";
import {
  imageProjectionSettingsNode,
  pointCloudColorCamera,
  type PointCloudCameraSettings,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import { toError } from "@lichtblick/suite-base/util/toError";

import type { AnyRendererSubscription } from "../IRenderer";
import type { Renderer } from "../Renderer";
import { PartialMessageEvent, SceneExtension, onlyLastByTopicMessage } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import {
  CAMERA_CALIBRATION_DATATYPES,
  COMPRESSED_IMAGE_DATATYPES,
  COMPRESSED_VIDEO_DATATYPES,
  RAW_IMAGE_DATATYPES,
} from "../foxglove";
import {
  CAMERA_INFO_DATATYPES,
  CameraInfo,
  COMPRESSED_IMAGE_DATATYPES as ROS_COMPRESSED_IMAGE_DATATYPES,
  IMAGE_DATATYPES as ROS_IMAGE_DATATYPES,
  CompressedImage as RosCompressedImage,
  Image as RosImage,
} from "../ros";
import { BaseSettings } from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose, AnyFrameId } from "../transforms";
import {
  IMAGE_RENDERABLE_DEFAULT_SETTINGS,
  ImageRenderable,
  ImageRenderableSettings,
  ImageUserData,
} from "./Images/ImageRenderable";
import { ALL_CAMERA_INFO_SCHEMAS, AnyImage, CompressedVideo } from "./Images/ImageTypes";
import { filterCompressedVideoQueue } from "./Images/filterCompressedVideoQueue";
import {
  normalizeCompressedImage,
  normalizeCompressedVideo,
  normalizeRawImage,
  normalizeRosCompressedImage,
  normalizeRosImage,
} from "./Images/imageNormalizers";
import { getTopicMatchPrefix, sortPrefixMatchesToFront } from "./Images/topicPrefixMatching";
import { CAMERA_COLOR_MAX_DELTA, type PointCloudCameraFrame } from "./pointClouds/cameraColor";
import { cameraInfosEqual, normalizeCameraInfo } from "./projections";

const log = Logger.getLogger(__filename);
void log;

export type LayerSettingsImage = BaseSettings &
  Pick<ImageRenderableSettings, "renderMode" | "rgbTopic"> & {
    cameraInfoTopic: string | undefined;
    distance: number;
    planarProjectionFactor: number;
    color: string;
  };

const DEFAULT_BITMAP_WIDTH = 512;
const NO_CAMERA_INFO_ERR = "NoCameraInfo";
const CAMERA_MODEL = "CameraModel";
const PROJECTION_FRAME_ERR = "ProjectionFrame";

const IDENTITY_POSE = makePose();
const tempPose = makePose();
const tempPlaneMatrix = new THREE.Matrix4();
const tempCamToPlane = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();

export class Images extends SceneExtension<ImageRenderable> {
  public static extensionId = "foxglove.Images";
  /* All known camera info topics */
  #cameraInfoTopics = new Set<string>();

  /**
   * A bi-directional mapping between cameraInfo topics and image topics. This
   * is used for retrieving an image renderable, which is indexed by image
   * topic, when receiving a camera info message.
   */
  #cameraInfoToImageTopics = new Map<string, Set<string>>();

  /**
   * Map of camera info topic name -> normalized CameraInfo message
   *
   * This stores the last camera info message on each topic so it can be applied when rendering the image
   */
  #cameraInfoByTopic = new Map<string, CameraInfo>();

  /**
   * Latest image on each topic that colors a depth map. A depth map created or pointed at the
   * topic after the image arrived (e.g. while paused) still gets colored.
   */
  #latestColorImageByTopic = new Map<string, AnyImage>();

  #pixelBuffers = new WeakMap<ImageBitmap, ImageData>();
  #pixelCanvas: OffscreenCanvas | undefined;
  // Keep a few already-read frames after hiding/unsubscribing; a paused player may not
  // redeliver a frame when another panel is already subscribed to the same camera.
  #recentPointCloudFrames = new Map<
    string,
    { frame: PointCloudCameraFrame; receiveTime: bigint }
  >();

  public customCameraModels: CameraModelsMap;

  protected supportedImageSchemas = ALL_SUPPORTED_IMAGE_SCHEMAS;

  public constructor(renderer: Renderer, name: string = Images.extensionId) {
    super(name, renderer);
    this.customCameraModels = renderer.customCameraModels;
    this.renderer.on("topicsChanged", this.#handleTopicsChanged);
    this.#handleTopicsChanged();
  }

  public override dispose(): void {
    this.renderer.off("topicsChanged", this.#handleTopicsChanged);
    super.dispose();
  }

  public override removeAllRenderables(): void {
    this.#recentPointCloudFrames.clear();
    super.removeAllRenderables();
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: AnyFrameId,
    fixedFrameId: AnyFrameId,
  ): void {
    // All setImage() calls for this frame have been made by the time startFrame() fires (they
    // happen inside #handleSubscriptionQueues(), which runs before startFrame()). Flushing here
    // means the full GOP batch is already in each queue, so skipRender correctly suppresses every
    // intermediate frame and only the last one triggers a GPU upload.
    for (const renderable of this.renderables.values()) {
      const { settings, topic } = renderable.userData;
      const wasDecodeOnly = renderable.decodeWithoutOverlay;
      renderable.decodeWithoutOverlay = !settings.visible;
      if (!settings.visible && !this.#isPointCloudCamera(topic)) {
        this.renderer.settings.errors.clearPath(renderable.userData.settingsPath);
        renderable.removeFromParent();
        renderable.dispose();
        this.renderables.delete(renderable.userData.topic);
        continue;
      }
      if (settings.visible && wasDecodeOnly) {
        this.#applyOverlayCalibration(renderable);
      }
      renderable.flushPendingDecodes();
      if (settings.visible && wasDecodeOnly) {
        renderable.update();
      }
    }
    super.startFrame(currentTime, renderFrameId, fixedFrameId);

    for (const renderable of this.renderables.values()) {
      const { renderMode } = renderable.userData.settings;
      if (renderMode === "depth") {
        renderable.setPixelRatio(this.renderer.getPixelRatio());
      } else if (renderMode === "plane" && renderable.visible) {
        this.#updatePlaneProjection(renderable, currentTime, renderFrameId, fixedFrameId);
      }
    }
  }

  /** Plane mode: tells the renderable where its projection plane is relative to the camera. */
  #updatePlaneProjection(
    renderable: ImageRenderable,
    currentTime: bigint,
    renderFrameId: AnyFrameId,
    fixedFrameId: AnyFrameId,
  ): void {
    const planeFrameId = renderable.userData.settings.projectionFrameId ?? fixedFrameId;
    const planePose = this.renderer.transformTree.apply(
      tempPose,
      IDENTITY_POSE,
      renderFrameId,
      fixedFrameId,
      planeFrameId,
      currentTime,
      currentTime,
    );
    const topic = renderable.userData.topic;
    if (!planePose) {
      renderable.setPlaneProjection(undefined);
      this.renderer.settings.errors.addToTopic(
        topic,
        PROJECTION_FRAME_ERR,
        `No transform to projection frame ${String(planeFrameId)}`,
      );
      return;
    }
    this.renderer.settings.errors.removeFromTopic(topic, PROJECTION_FRAME_ERR);
    const { position: p, orientation: q } = planePose;
    tempPlaneMatrix
      .makeRotationFromQuaternion(tempQuaternion.set(q.x, q.y, q.z, q.w))
      .setPosition(p.x, p.y, p.z);
    renderable.updateMatrix();
    tempCamToPlane.copy(tempPlaneMatrix.invert()).multiply(renderable.matrix);
    renderable.setPlaneProjection(tempCamToPlane);
  }

  public override async settleVideoDecodes(): Promise<void> {
    await Promise.all(
      Array.from(this.renderables.values(), async (renderable) => {
        await renderable.settleVideoDecodes();
      }),
    );
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: ALL_CAMERA_INFO_SCHEMAS,
        subscription: {
          handler: this.#handleCameraInfo,
          shouldSubscribe: this.#cameraInfoShouldSubscribe,
        },
      },
      {
        type: "schema",
        schemaNames: ROS_IMAGE_DATATYPES,
        subscription: {
          handler: this.#handleRosRawImage,
          filterQueue: onlyLastByTopicMessage,
          shouldSubscribe: this.#imageShouldSubscribe,
        },
      },
      {
        type: "schema",
        schemaNames: ROS_COMPRESSED_IMAGE_DATATYPES,
        subscription: {
          handler: this.#handleRosCompressedImage,
          filterQueue: onlyLastByTopicMessage,
          shouldSubscribe: this.#imageShouldSubscribe,
        },
      },
      {
        type: "schema",
        schemaNames: RAW_IMAGE_DATATYPES,
        subscription: {
          handler: this.#handleRawImage,
          filterQueue: onlyLastByTopicMessage,
          shouldSubscribe: this.#imageShouldSubscribe,
        },
      },
      {
        type: "schema",
        schemaNames: COMPRESSED_IMAGE_DATATYPES,
        subscription: {
          handler: this.#handleCompressedImage,
          filterQueue: onlyLastByTopicMessage,
          shouldSubscribe: this.#imageShouldSubscribe,
        },
      },
      {
        type: "schema",
        schemaNames: COMPRESSED_VIDEO_DATATYPES,
        subscription: {
          handler: this.#handleCompressedVideo,
          // For non-HEVC streams this collapses to the original onlyLastByTopicMessage behavior.
          // For HEVC, the filter preserves the active GOP so P-frames are still decodable.
          filterQueue: filterCompressedVideoQueue,
          shouldSubscribe: this.#imageShouldSubscribe,
        },
      },
    ];
  }

  /**
   * Update cameraInfoTopics cache with latest set of camera info messages
   */
  #handleTopicsChanged = () => {
    this.#cameraInfoTopics = new Set();
    for (const topic of this.renderer.topics ?? []) {
      if (
        topicIsConvertibleToSchema(topic, CAMERA_INFO_DATATYPES) ||
        topicIsConvertibleToSchema(topic, CAMERA_CALIBRATION_DATATYPES)
      ) {
        this.#cameraInfoTopics.add(topic.name);
      }
    }
  };

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    const imageTopics = (this.renderer.topics ?? []).filter((topic) =>
      topicIsConvertibleToSchema(topic, this.supportedImageSchemas),
    );
    const imageTopicOptions = imageTopics.map((topic) => ({
      label: topic.name,
      value: topic.name,
    }));
    for (const topic of imageTopics) {
      const imageTopic = topic.name;
      const config = (configTopics[imageTopic] ?? {}) as Partial<LayerSettingsImage>;

      // Build a list of all matching CameraInfo topics
      const cameraInfoOptions = Array.from(this.#cameraInfoTopics, (topicName) => ({
        label: topicName,
        value: topicName,
      }));
      cameraInfoOptions.sort((a, b) => a.value.localeCompare(b.value));
      sortPrefixMatchesToFront(cameraInfoOptions, imageTopic, (option) => option.value);

      const options =
        config.renderMode === "plane"
          ? { frameOptions: this.renderer.transformTree.frameList() }
          : config.renderMode === "depth"
            ? { rgbTopicOptions: imageTopicOptions.filter((option) => option.value !== imageTopic) }
            : {};
      entries.push({
        path: ["topics", imageTopic],
        node: {
          ...imageProjectionSettingsNode(topic, config, cameraInfoOptions, options),
          handler,
        },
      });
    }
    return entries;
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    const imageTopic = path[1]!;
    const prevSettings = (this.renderer.config.topics[imageTopic] ??
      {}) as Partial<LayerSettingsImage>;
    const prevCameraInfoTopic = prevSettings.cameraInfoTopic;

    this.saveSetting(path, action.payload.value);

    const settings = (this.renderer.config.topics[imageTopic] ?? {}) as Partial<LayerSettingsImage>;
    const cameraInfoTopic = settings.cameraInfoTopic;

    // Add this camera_info_topic -> image_topic mapping
    if (cameraInfoTopic !== prevCameraInfoTopic && cameraInfoTopic != undefined) {
      this.#mapCameraInfoToImage(cameraInfoTopic, imageTopic);
    }

    const renderable = this.renderables.get(imageTopic);
    if (!renderable) {
      return;
    }

    renderable.setSettings({ ...IMAGE_RENDERABLE_DEFAULT_SETTINGS, ...settings });
    this.#applyLatestColorImage(renderable);

    // The camera info topic changed for our renderable
    // Remove the previous camera_info_topic -> image_topic mapping
    if (prevCameraInfoTopic != undefined && prevCameraInfoTopic !== cameraInfoTopic) {
      this.#cameraInfoToImageTopics.get(prevCameraInfoTopic)?.delete(imageTopic);
    }

    // apply camera info to new renderable
    if (!cameraInfoTopic) {
      return;
    }

    // Look up the camera info for our image topic
    const cameraInfo = this.#cameraInfoByTopic.get(cameraInfoTopic);
    if (!cameraInfo) {
      this.renderer.settings.errors.addToTopic(
        imageTopic,
        NO_CAMERA_INFO_ERR,
        `No CameraInfo received on ${cameraInfoTopic}`,
      );
      return;
    }
    this.#recomputeCameraModel(renderable, cameraInfo);
    renderable.update();
  };

  #imageShouldSubscribe = (imageTopic: string): boolean =>
    this.renderer.config.topics[imageTopic]?.visible === true ||
    this.#isColorTopic(imageTopic) ||
    this.#isPointCloudCamera(imageTopic);

  #isPointCloudCamera(imageTopic: string): boolean {
    return Object.values(this.renderer.config.topics).some(
      (config: (Partial<BaseSettings> & PointCloudCameraSettings) | undefined) =>
        config?.visible === true && pointCloudColorCamera(config) === imageTopic,
    );
  }

  #pointCloudCalibrationTopic(imageTopic: string): string | undefined {
    const config: Partial<LayerSettingsImage> | undefined = this.renderer.config.topics[imageTopic];
    const topics = [...this.#cameraInfoTopics].sort();
    const namespace = getTopicMatchPrefix(imageTopic);
    const parent = namespace == undefined ? undefined : getTopicMatchPrefix(namespace.slice(0, -1));
    return (
      config?.cameraInfoTopic ??
      topics.find((topic) => topic.startsWith(imageTopic + "/")) ??
      this.#matchingCalibrationTopic(imageTopic) ??
      // ROS image transports add a topic segment under the base image topic.
      (parent == undefined
        ? undefined
        : topics.find((topic) => getTopicMatchPrefix(topic) === parent))
    );
  }

  #matchingCalibrationTopic(imageTopic: string): string | undefined {
    const prefix = getTopicMatchPrefix(imageTopic);
    return prefix == undefined
      ? undefined
      : [...this.#cameraInfoTopics].sort().find((topic) => topic.startsWith(prefix));
  }

  public pointCloudCameraFrame(
    imageTopic: string,
    scanTime?: bigint,
  ): PointCloudCameraFrame | undefined {
    const renderable = this.renderables.get(imageTopic);
    const time = renderable?.decodedImageTime;
    const image = renderable?.getDecodedImage();
    if (time == undefined || !image || !renderable) {
      const cached = this.#recentPointCloudFrames.get(imageTopic);
      if (
        cached &&
        (scanTime != undefined
          ? this.#nearScanTime(cached.frame.time, scanTime)
          : this.#nearScanTime(cached.receiveTime, this.renderer.currentTime))
      ) {
        return cached.frame;
      }
      return undefined;
    }
    if (scanTime != undefined && !this.#nearScanTime(time, scanTime)) {
      return undefined;
    }
    const calibrationTopic = this.#pointCloudCalibrationTopic(imageTopic);
    const calibration =
      calibrationTopic == undefined ? undefined : this.#cameraInfoByTopic.get(calibrationTopic);
    if (calibration == undefined) {
      return undefined;
    }
    const frameId = this.renderer.normalizeFrameId(
      calibration.header.frame_id || renderable.userData.frameId,
    );
    const pixels = this.#getPointCloudPixels(image);
    if (!pixels) {
      return undefined;
    }
    const frame = { time, frameId, calibration, pixels };
    this.#recentPointCloudFrames.delete(imageTopic);
    this.#recentPointCloudFrames.set(imageTopic, {
      frame,
      receiveTime: renderable.userData.receiveTime,
    });
    if (this.#recentPointCloudFrames.size > 4) {
      this.#recentPointCloudFrames.delete(this.#recentPointCloudFrames.keys().next().value!);
    }
    return frame;
  }

  #nearScanTime(imageTime: bigint, scanTime: bigint): boolean {
    return (
      imageTime >= scanTime - CAMERA_COLOR_MAX_DELTA &&
      imageTime <= scanTime + CAMERA_COLOR_MAX_DELTA
    );
  }

  #getPointCloudPixels(image: ImageBitmap | ImageData): ImageData | undefined {
    if (image instanceof ImageData) {
      return image;
    }
    let pixels = this.#pixelBuffers.get(image);
    if (pixels == undefined) {
      if (image.width === 0 || image.height === 0) {
        return undefined;
      }
      const canvas = (this.#pixelCanvas ??= new OffscreenCanvas(image.width, image.height));
      if (canvas.width !== image.width || canvas.height !== image.height) {
        canvas.width = image.width;
        canvas.height = image.height;
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return undefined;
      }
      context.clearRect(0, 0, image.width, image.height);
      context.drawImage(image, 0, 0);
      pixels = context.getImageData(0, 0, image.width, image.height);
      this.#pixelBuffers.set(image, pixels);
    }
    return pixels;
  }

  #isColorTopic(imageTopic: string): boolean {
    return Object.values(this.renderer.config.topics).some(
      (config: Partial<LayerSettingsImage> | undefined) =>
        config?.visible === true && config.renderMode === "depth" && config.rgbTopic === imageTopic,
    );
  }

  #applyLatestColorImage(renderable: ImageRenderable): void {
    const { renderMode, rgbTopic } = renderable.userData.settings;
    const image = rgbTopic == undefined ? undefined : this.#latestColorImageByTopic.get(rgbTopic);
    if (renderMode === "depth" && image) {
      renderable.setColorImage(image);
    }
  }

  #cameraInfoShouldSubscribe = (cameraInfoTopic: string): boolean => {
    // Iterate over each topic config and check if it has a cameraInfoTopic setting that matches
    // the cameraInfoTopic we might want to turn on. If it does and the topic is visible, return
    // true so we know to subscribe.
    for (const topicConfig of Object.values(this.renderer.config.topics)) {
      const maybeImageConfig = topicConfig as Partial<LayerSettingsImage>;
      if (
        maybeImageConfig.cameraInfoTopic === cameraInfoTopic &&
        maybeImageConfig.visible === true
      ) {
        return true;
      }
    }

    return Object.values(this.renderer.config.topics).some(
      (config: (Partial<BaseSettings> & PointCloudCameraSettings) | undefined) => {
        const topic = config?.visible === true ? pointCloudColorCamera(config) : undefined;
        return topic != undefined && this.#pointCloudCalibrationTopic(topic) === cameraInfoTopic;
      },
    );
  };

  #handleRosRawImage = (messageEvent: PartialMessageEvent<RosImage>): void => {
    this.handleImage(messageEvent, normalizeRosImage(messageEvent.message));
  };

  #handleRosCompressedImage = (messageEvent: PartialMessageEvent<RosCompressedImage>): void => {
    this.handleImage(messageEvent, normalizeRosCompressedImage(messageEvent.message));
  };

  #handleRawImage = (messageEvent: PartialMessageEvent<RawImage>): void => {
    this.handleImage(messageEvent, normalizeRawImage(messageEvent.message));
  };

  #handleCompressedImage = (messageEvent: PartialMessageEvent<CompressedImage>): void => {
    this.handleImage(messageEvent, normalizeCompressedImage(messageEvent.message));
  };

  #handleCompressedVideo = (messageEvent: PartialMessageEvent<CompressedVideo>): void => {
    this.handleImage(messageEvent, normalizeCompressedVideo(messageEvent.message));
  };

  protected handleImage = (messageEvent: PartialMessageEvent<AnyImage>, image: AnyImage): void => {
    const imageTopic = messageEvent.topic;
    if (this.#isColorTopic(imageTopic)) {
      this.#latestColorImageByTopic.set(imageTopic, image);
      for (const depthRenderable of this.renderables.values()) {
        const { settings } = depthRenderable.userData;
        if (settings.renderMode === "depth" && settings.rgbTopic === imageTopic) {
          depthRenderable.setColorImage(image);
        }
      }
    }
    const visible = this.renderer.config.topics[imageTopic]?.visible === true;
    if (!visible && !this.#isPointCloudCamera(imageTopic)) {
      return;
    }
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    const frameId = "header" in image ? image.header.frame_id : image.frame_id;

    const renderable = this.#getImageRenderable(imageTopic, receiveTime, image, frameId);

    renderable.userData.receiveTime = receiveTime;
    renderable.decodeWithoutOverlay = !visible;
    renderable.setImage(image, DEFAULT_BITMAP_WIDTH);
    if (visible) {
      this.#applyOverlayCalibration(renderable);
    }
  };

  #applyOverlayCalibration(renderable: ImageRenderable): void {
    // Auto-select settings.cameraInfoTopic if it's not already set
    const { topic: imageTopic, settings } = renderable.userData;
    if (settings.cameraInfoTopic == undefined) {
      const newCameraInfoTopic = this.#isPointCloudCamera(imageTopic)
        ? this.#pointCloudCalibrationTopic(imageTopic)
        : this.#matchingCalibrationTopic(imageTopic);
      settings.cameraInfoTopic = newCameraInfoTopic;
      renderable.setSettings(settings);

      // With no selected camera info topic, we show a topic error and bail
      // There's no way to render without camera info
      if (newCameraInfoTopic == undefined) {
        this.renderer.settings.errors.addToTopic(
          imageTopic,
          NO_CAMERA_INFO_ERR,
          "No CameraInfo topic found",
        );
        return;
      }

      // We auto-selected a camera info topic for this image topic so we need to add the lookup.
      // Without this lookup, the handleCameraInfo won't know what image topics to update when
      // camera info messages arrive after image messages.

      // Update user settings with the newly selected CameraInfo topic
      this.renderer.updateConfig((draft) => {
        const updatedUserSettings = { ...settings };
        updatedUserSettings.cameraInfoTopic = newCameraInfoTopic;
        draft.topics[imageTopic] = updatedUserSettings;
      });
      this.updateSettingsTree();
    }

    assert(settings.cameraInfoTopic != undefined);
    this.#mapCameraInfoToImage(settings.cameraInfoTopic, imageTopic);

    // Look up the camera info for our renderable
    const cameraInfo = this.#cameraInfoByTopic.get(settings.cameraInfoTopic);
    if (!cameraInfo) {
      this.renderer.settings.errors.addToTopic(
        imageTopic,
        NO_CAMERA_INFO_ERR,
        `No CameraInfo received on ${settings.cameraInfoTopic}`,
      );
    } else {
      this.#recomputeCameraModel(renderable, cameraInfo);
    }
  }

  #mapCameraInfoToImage(cameraInfoTopic: string, imageTopic: string): void {
    const imageTopics = this.#cameraInfoToImageTopics.get(cameraInfoTopic);
    if (imageTopics) {
      imageTopics.add(imageTopic);
    } else {
      this.#cameraInfoToImageTopics.set(cameraInfoTopic, new Set([imageTopic]));
    }
  }

  #handleCameraInfo = (messageEvent: PartialMessageEvent<CameraInfo>): void => {
    // Store the last camera info on each topic, when processing an image message we'll look up
    // the camera info by the info topic configured for the image
    const cameraInfo = normalizeCameraInfo(messageEvent.message);
    if (!cameraInfosEqual(this.#cameraInfoByTopic.get(messageEvent.topic), cameraInfo)) {
      this.#cameraInfoByTopic.set(messageEvent.topic, cameraInfo);
    }

    // Look up any image topics assigned to our camera info topic and determine if we need to update
    // those renderables since we now have a camera info whereas we may not have previously
    const imageTopics = this.#cameraInfoToImageTopics.get(messageEvent.topic) ?? [];
    for (const imageTopic of imageTopics) {
      const renderable = this.renderables.get(imageTopic);
      if (!renderable) {
        continue;
      }

      // If there's no camera info topic assigned then we don't need to do update this renderable
      const settings = renderable.userData.settings;
      if (!settings.cameraInfoTopic || settings.cameraInfoTopic !== messageEvent.topic) {
        continue;
      }
      this.renderer.settings.errors.removeFromTopic(imageTopic, NO_CAMERA_INFO_ERR);

      this.#recomputeCameraModel(renderable, cameraInfo);
      renderable.update();
    }
  };

  /**
   * Recompute a new camera model if the newCameraInfo differs from the current renderable info. If
   * the info is unchanged then the existing camera model is returned.
   *
   * If a camera model could not be created this returns undefined.
   *
   * This function will set a topic error on the image topic if the camera model creation fails.
   */
  #recomputeCameraModel(renderable: ImageRenderable, newCameraInfo: CameraInfo) {
    // If the camera info has not changed, we don't need to make a new model and can return the existing one
    const dataEqual = cameraInfosEqual(renderable.userData.cameraInfo, newCameraInfo);
    if (dataEqual && renderable.userData.cameraModel != undefined) {
      return;
    }

    const imageTopic = renderable.userData.topic;

    try {
      const cameraModel = selectCameraModel(newCameraInfo, this.customCameraModels);
      renderable.setCameraModel(cameraModel);
      renderable.userData.cameraInfo = newCameraInfo;
      this.renderer.settings.errors.removeFromTopic(imageTopic, CAMERA_MODEL);
    } catch (errUnk) {
      const err = toError(errUnk);
      this.renderer.settings.errors.addToTopic(imageTopic, CAMERA_MODEL, err.message);
    }
  }

  // Get or create an image renderable for the imageTopic
  #getImageRenderable(
    imageTopic: string,
    receiveTime: bigint,
    image: AnyImage | undefined,
    frameId: string,
  ): ImageRenderable {
    let renderable = this.renderables.get(imageTopic);
    if (renderable) {
      return renderable;
    }

    // Look up any existing settings for the image topic to save as user data with the renderable
    const userSettings = this.renderer.config.topics[imageTopic];
    const messageTime = image
      ? toNanoSec("header" in image ? image.header.stamp : image.timestamp)
      : 0n;
    renderable = this.initRenderable(imageTopic, {
      receiveTime,
      messageTime,
      firstMessageTime: messageTime,
      frameId: this.renderer.normalizeFrameId(frameId),
      pose: makePose(),
      settingsPath: ["topics", imageTopic],
      topic: imageTopic,
      settings: { ...IMAGE_RENDERABLE_DEFAULT_SETTINGS, ...userSettings },
      cameraInfo: undefined,
      cameraModel: undefined,
      image,
      texture: undefined,
      material: undefined,
      geometry: undefined,
      mesh: undefined,
    });

    this.add(renderable);
    this.#applyLatestColorImage(renderable);
    this.renderables.set(imageTopic, renderable);
    return renderable;
  }
  protected initRenderable(topicName: string, userData: ImageUserData): ImageRenderable {
    return new ImageRenderable(topicName, this.renderer, userData);
  }

  public setCustomCameraModels(newCameraModels: CameraModelsMap): void {
    this.customCameraModels = newCameraModels;
  }
}
