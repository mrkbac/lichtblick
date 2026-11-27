// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, toNanoSec } from "@foxglove/rostime";
import { NumericType, PackedElementField, PointCloud } from "@foxglove/schemas";
import * as THREE from "three/webgpu";

import { SettingsTreeAction } from "@lichtblick/suite";
import { DynamicBufferGeometry } from "@lichtblick/suite-base/panels/ThreeDeeRender/DynamicBufferGeometry";
import {
  createGeometry,
  pointCloudColorEncoding,
  pointStyle,
  DECAY_HISTORY_LIMITS,
  RenderObjectHistory,
  PointsRenderable,
  DECAY_LIMITED,
  keepDecayingTopics,
  pointDecayTime,
  updateDecayRing,
  isSameRecord,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/pointExtensionUtils";
import { colorFieldComputedPrefix } from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/colorMode";
import {
  DEFAULT_DECAY_MAX_POINTS_MILLIONS,
  DEFAULT_POINT_SETTINGS,
  LayerSettingsPointExtension,
  POINT_CLOUD_REQUIRED_FIELDS,
  pointCloudColorCamera,
  type PointCloudCameraSettings,
  pointCloudSettingsNode,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import type { MessageEvent, RosObject, RosValue } from "@lichtblick/suite-base/players/types";

import type { AnyRendererSubscription } from "../IRenderer";
import { BaseUserData, ChildUserData, Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import { PartialMessage, PartialMessageEvent, SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry, SettingsTreeNodeWithActionHandler } from "../SettingsManager";
import { POINTCLOUD_DATATYPES as FOXGLOVE_POINTCLOUD_DATATYPES } from "../foxglove";
import { sameBytes } from "../math";
import {
  normalizeByteArray,
  normalizeHeader,
  normalizeTime,
  normalizePose,
  numericTypeToPointFieldType,
} from "../normalizeMessages";
import {
  PointCloud2,
  POINTCLOUD_DATATYPES as ROS_POINTCLOUD_DATATYPES,
  PointField,
  PointFieldType,
} from "../ros";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose, Pose } from "../transforms";
import { ALL_SUPPORTED_IMAGE_SCHEMAS } from "./ImageMode/schemas";
import { Images } from "./Images";
import {
  autoSelectColorSettings,
  ColorConverter,
  colorHasTransparency,
  getColorConverter,
} from "./colorMode";
import { DecayPointRing, type RingScanInfo } from "./pointClouds/DecayPointRing";
import {
  applyCameraFallback,
  paintPointColors,
  type PointCloudCameraFrame,
} from "./pointClouds/cameraColor";
import { FieldReader, getReader, isSupportedField } from "./pointClouds/fieldReaders";
import { MISSING_TRANSFORM } from "./transforms";

type PointCloudFieldReaders = {
  xReader: FieldReader;
  yReader: FieldReader;
  zReader: FieldReader;
  packedColorReader: FieldReader;
  redReader: FieldReader;
  greenReader: FieldReader;
  blueReader: FieldReader;
  alphaReader: FieldReader;
  /** Byte offsets of x/y/z when all three are 4-byte aligned float32, enabling a typed-array fast path */
  float32XyzOffsets: [number, number, number] | undefined;
};

type LayerSettingsPointClouds = LayerSettingsPointExtension &
  PointCloudCameraSettings & {
    stixelsEnabled: boolean;
    colorFieldComputed: "distance" | undefined;
    /** Limit on accumulated decay points, in millions; DEFAULT_DECAY_MAX_POINTS_MILLIONS if unset */
    decayMaxPoints?: number;
  };

/** The decay point budget for these settings, in points */
function decayMaxPoints(settings: LayerSettingsPointClouds): number {
  const millions = settings.decayMaxPoints;
  return millions != undefined && Number.isFinite(millions) && millions > 0
    ? Math.round(millions * 1e6)
    : DEFAULT_DECAY_MAX_POINTS_MILLIONS * 1e6;
}

/** Stixels draw two vertices per point: the budget that covers the same decay window as the points */
function stixelMaxVertices(settings: LayerSettingsPointClouds): number {
  return 2 * decayMaxPoints(settings);
}

const DEFAULT_SETTINGS = {
  ...DEFAULT_POINT_SETTINGS,
  stixelsEnabled: false,
  colorFieldComputed: undefined,
};

type PointCloudHistoryUserData = BaseUserData & {
  settings: LayerSettingsPointClouds;
  topic: string;
  latestPointCloud: PointCloud | PointCloud2;
  historyOnly?: boolean;
  recordId?: string;
  latestOriginalMessage: Record<string, RosValue> | undefined;
  stixelMaterial: THREE.LineBasicMaterial;
};

const ALL_POINTCLOUD_DATATYPES = new Set<string>([
  ...FOXGLOVE_POINTCLOUD_DATATYPES,
  ...ROS_POINTCLOUD_DATATYPES,
]);

function hideUnpaintedPoints(settings: LayerSettingsPointClouds): boolean {
  return (
    settings.hideUnpaintedCameraPoints === true &&
    (settings.colorFromCamera ?? settings.colorCameraTopic != undefined)
  );
}

const INVALID_POINTCLOUD = "INVALID_POINTCLOUD";
const CAMERA_DECODE_WAIT_MS = 120;
const MAX_WAITING_SCANS = 16;
const tempCameraPose = makePose();

type WaitingScan = {
  pointCloud: PointCloud | PointCloud2;
  originalMessage: RosObject;
  receiveTime: bigint;
  deadline: number;
  recordId: string | undefined;
};

const tempColor = { r: 0, g: 0, b: 0, a: 0 };
const tempFieldReaders: PointCloudFieldReaders = {
  xReader: zeroReader,
  yReader: zeroReader,
  zReader: zeroReader,
  packedColorReader: zeroReader,
  redReader: zeroReader,
  greenReader: zeroReader,
  blueReader: zeroReader,
  alphaReader: zeroReader,
  float32XyzOffsets: undefined,
};

type PointCloudUserData = ChildUserData & {
  /** Undefined once a newer decay entry exists (see releaseMessage) */
  pointCloud: PointCloud | PointCloud2 | undefined;
  originalMessage: Record<string, RosValue> | undefined;
};

class PointCloudRenderable extends PointsRenderable<PointCloudUserData> {
  /** What the geometry buffers currently hold, to skip re-decoding unchanged data */
  public decoded: { pointCloud: PointCloud | PointCloud2; key: string } | undefined;

  public override details(): Record<string, RosValue> {
    return this.userData.originalMessage ?? {};
  }

  public releaseMessage(): void {
    this.userData.pointCloud = undefined;
    this.userData.originalMessage = undefined;
    this.decoded = undefined;
  }

  public override instanceDetails(instanceId: number): Record<string, RosValue> | undefined {
    const pointCloud = this.userData.pointCloud;
    if (!pointCloud) {
      return undefined; // an older decay entry: only its geometry is kept
    }
    const data = pointCloud.data;
    const stride = getStride(pointCloud);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const pointStep = getStride(pointCloud);
    const details: Record<string, RosValue> = {};

    for (const field of pointCloud.fields) {
      const pointOffset = instanceId * pointStep;
      const reader = getReader(field, stride);
      if (reader) {
        details[field.name] = reader(view, pointOffset);
      }
    }

    return details;
  }
}

export class PointCloudHistoryRenderable extends Renderable<PointCloudHistoryUserData> {
  public override pickable = false; // Picking happens on child renderables
  #pointsHistory: RenderObjectHistory<PointCloudRenderable>;
  #stixelsHistory: RenderObjectHistory<StixelsRenderable>;
  /**
   * With a decay time, scans older than the latest accumulate here. The latest stays a regular
   * PointCloudRenderable, so picking it still shows the message and per-point fields.
   */
  #decayRing: DecayPointRing | undefined;
  /** Decodes scans older than the latest before they are copied into the ring */
  #scratch: DynamicBufferGeometry | undefined;
  #latestUnpaintedColors: Uint8Array | undefined;
  #latestPaintedPoints: Uint8Array | undefined;
  #latestCameraFrame: PointCloudCameraFrame | undefined;
  #latestProjectionAttempt: { version: number; fixedFrameId: string | undefined } | undefined;
  #historyProjectionAttempt: { version: number; fixedFrameId: string | undefined } | undefined;
  public waitingToRepaint = false;

  public constructor(topic: string, renderer: Renderer, userData: PointCloudHistoryUserData) {
    super(topic, renderer, userData);

    const isDecay = userData.settings.decayTime > 0;
    // Rewritten by every message, also with a decay time (older scans are copied to the ring)
    const geometry = createGeometry(topic, THREE.DynamicDrawUsage);
    geometry.resize(0);

    const points = new PointCloudRenderable(
      topic,
      {
        pose: getPose(userData.latestPointCloud),
        topic,
        pointCloud: userData.latestPointCloud,
        originalMessage: userData.latestOriginalMessage,
      },
      geometry,
    );
    points.setStyle(pointStyle(userData.settings));
    this.#pointsHistory = new RenderObjectHistory({
      initial: {
        messageTime: userData.messageTime,
        receiveTime: userData.receiveTime,
        renderable: points,
      },
      parentRenderable: this,
      renderer,
      limits: DECAY_HISTORY_LIMITS,
    });
    this.add(points);

    const stixelGeometry = createStixelGeometry(
      topic,
      isDecay ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage,
    );
    const stixels = new StixelsRenderable(
      topic,
      {
        frameId: "",
        pose: getPose(userData.latestPointCloud),
        topic,
      },
      stixelGeometry,
      userData.stixelMaterial,
    );
    this.#stixelsHistory = new RenderObjectHistory({
      initial: {
        messageTime: userData.messageTime,
        receiveTime: userData.receiveTime,
        renderable: stixels,
      },
      parentRenderable: this,
      renderer,
      limits: DECAY_HISTORY_LIMITS, // maxPoints set before each trim
    });

    this.add(stixels);
  }

  public override dispose(): void {
    this.userData.latestOriginalMessage = undefined;
    this.userData.stixelMaterial.dispose();
    this.#pointsHistory.dispose();
    this.#stixelsHistory.dispose();
    this.#decayRing?.dispose();
    this.#scratch?.dispose();
    this.renderer.settings.errors.remove(this.userData.settingsPath, DECAY_LIMITED);
    super.dispose();
  }

  public applySettings(settings: LayerSettingsPointClouds): void {
    const cameraTopic = pointCloudColorCamera(settings);
    const cameraChanged =
      pointCloudColorCamera(this.userData.settings) !== cameraTopic ||
      (cameraTopic != undefined &&
        (this.userData.settings.cameraColorProjection ?? "raw") !==
          (settings.cameraColorProjection ?? "raw"));
    if (cameraChanged) {
      this.#decayRing?.recolor();
      this.#stixelsHistory.forEach(({ renderable }) => {
        renderable.recolor();
      });
      this.waitingToRepaint = cameraTopic != undefined;
      this.#historyProjectionAttempt = undefined;
    }
    const hide = hideUnpaintedPoints(settings);
    const wasHidden = hideUnpaintedPoints(this.userData.settings);
    if (hide !== wasHidden || (cameraChanged && hide)) {
      this.#decayRing?.updateCameraFallback({ hide });
      this.#stixelsHistory.forEach(({ renderable }) => {
        renderable.updateCameraFallback({ hide });
      });
    }
    if (this.userData.historyOnly === true) {
      this.userData.settings = settings;
      this.#decayRing?.setStyle(pointStyle(settings), { preserveColors: true });
      this.#updateStixelMaterial(settings);
      return;
    }
    this.updatePointCloud(
      this.userData.latestPointCloud,
      this.userData.latestOriginalMessage,
      settings,
      this.userData.receiveTime,
      cameraChanged ? undefined : this.#latestCameraFrame,
    );
  }

  public repaintFromCamera(camera: PointCloudCameraFrame): void {
    const { transformTree, fixedFrameId } = this.renderer;
    const previous = this.#historyProjectionAttempt;
    if (
      previous &&
      previous.version === transformTree.version &&
      previous.fixedFrameId === fixedFrameId
    ) {
      return;
    }
    this.waitingToRepaint = false;
    this.#historyProjectionAttempt = undefined;
    const { settings, latestPointCloud, latestOriginalMessage, receiveTime } = this.userData;
    const paint = (
      scan: RingScanInfo,
      positions: Float32Array,
      colors: Uint8Array,
      count: number,
      paintedPoints: Uint8Array,
    ) => {
      const pose = transformTree.apply(
        tempCameraPose,
        scan.pose,
        camera.frameId,
        fixedFrameId,
        scan.frameId,
        camera.time,
        scan.messageTime,
      );
      if (!pose) {
        this.waitingToRepaint = true;
        this.#historyProjectionAttempt ??= { version: transformTree.version, fixedFrameId };
      } else {
        paintPointColors(
          positions,
          colors,
          count,
          camera,
          pose,
          pointCloudColorEncoding(settings),
          paintedPoints,
        );
      }
    };
    const hide = hideUnpaintedPoints(settings);
    this.#decayRing?.recolor(paint, { hideUnpainted: hide });
    this.#stixelsHistory.forEach((entry) => {
      const { renderable } = entry;
      const { frameId, pose } = renderable.userData;
      renderable.recolor((positions, colors, count, painted) => {
        paint({ ...entry, frameId, pose }, positions, colors, count, painted);
      });
      if (hide) {
        renderable.updateCameraFallback({ hide });
      }
    });
    if (this.userData.historyOnly !== true) {
      this.updatePointCloud(latestPointCloud, latestOriginalMessage, settings, receiveTime, camera);
    }
  }

  public updatePointCloud(
    this: PointCloudHistoryRenderable,
    pointCloud: PointCloud | PointCloud2,
    originalMessage: RosObject | undefined,
    settings: LayerSettingsPointClouds,
    receiveTime: bigint,
    cameraFrame?: PointCloudCameraFrame,
  ): void {
    this.#latestCameraFrame = cameraFrame;
    this.#latestProjectionAttempt = undefined;
    const messageTime = toNanoSec(getTimestamp(pointCloud));
    this.userData.receiveTime = receiveTime;
    this.userData.messageTime = messageTime;
    this.userData.frameId = this.renderer.normalizeFrameId(getFrameId(pointCloud));
    this.userData.latestPointCloud = pointCloud;
    this.userData.latestOriginalMessage = originalMessage;

    const prevSettings = this.userData.settings;
    const prevIsDecay = prevSettings.decayTime > 0;
    this.userData.settings = settings;

    const pointsHistory = this.#pointsHistory;
    const stixelsHistory = this.#stixelsHistory;
    const style = pointStyle(settings);
    pointsHistory.forEach((entry) => {
      entry.renderable.setStyle(style);
    });
    this.#decayRing?.setStyle(style, { preserveColors: true });
    this.#updateStixelMaterial(settings);

    if (settings.colorField === colorFieldComputedPrefix + "distance") {
      settings.colorFieldComputed = "distance";
    }

    const stixelsEnabledChanged = prevSettings.stixelsEnabled !== settings.stixelsEnabled;
    // when stixels are switched off we can clear its history
    if (!settings.stixelsEnabled && stixelsEnabledChanged) {
      stixelsHistory.clearHistory();
    }

    // Invalid point cloud checks
    if (!this.#validatePointCloud(pointCloud)) {
      return;
    }

    // Parse the fields and create typed readers for x/y/z and color
    if (!this.#getPointCloudFieldReaders(tempFieldReaders, pointCloud, settings)) {
      return;
    }
    // A clean cloud clears the previous message's error (only then, so a cloud that keeps
    // failing or warning doesn't remove and re-add it on every message)
    if (!this.#warned) {
      this.renderer.settings.errors.removeFromTopic(this.userData.topic, INVALID_POINTCLOUD);
    }

    if (this.userData.recordId != undefined) {
      this.#decayRing?.removeRecord(this.userData.recordId);
      if (settings.stixelsEnabled) {
        stixelsHistory.removeOlderRecord(this.userData.recordId);
      }
    }
    const latestPointsEntry = pointsHistory.latest();
    latestPointsEntry.receiveTime = receiveTime;
    latestPointsEntry.messageTime = messageTime;
    latestPointsEntry.recordId = this.userData.recordId;
    latestPointsEntry.renderable.userData.pose = getPose(pointCloud);
    latestPointsEntry.renderable.userData.pointCloud = pointCloud;
    latestPointsEntry.renderable.userData.originalMessage = originalMessage;

    const pointCount = Math.trunc(pointCloud.data.length / getStride(pointCloud));
    const latestPoints = latestPointsEntry.renderable;
    latestPointsEntry.renderable.geometry.resize(pointCount);
    const positionAttribute = latestPoints.geometry.attributes.position!;
    const colorAttribute = latestPoints.geometry.attributes.color!;

    const latestStixelEntry = stixelsHistory.latest();

    const isDecay = settings.decayTime > 0;
    if (!isDecay && prevIsDecay !== isDecay) {
      latestStixelEntry.renderable.geometry.setUsage(THREE.DynamicDrawUsage);
    }

    latestStixelEntry.receiveTime = receiveTime;
    latestStixelEntry.messageTime = messageTime;
    latestStixelEntry.recordId = this.userData.recordId;
    latestStixelEntry.renderable.userData.pose = latestPointsEntry.renderable.userData.pose;
    latestStixelEntry.renderable.userData.frameId = this.userData.frameId;
    if (settings.stixelsEnabled) {
      latestStixelEntry.renderable.geometry.resize(pointCount * 2);
    } else {
      latestStixelEntry.renderable.geometry.resize(0);
    }
    const stixelPositionAttribute = latestStixelEntry.renderable.geometry.attributes.position!;
    const stixelColorAttribute = latestStixelEntry.renderable.geometry.attributes.color!;
    // Use the fixed frame to account for motion between the scan and the camera exposure.
    const { transformTree, fixedFrameId } = this.renderer;
    const pointToCamera =
      cameraFrame == undefined
        ? undefined
        : transformTree.apply(
            tempCameraPose,
            getPose(pointCloud),
            cameraFrame.frameId,
            fixedFrameId,
            this.userData.frameId,
            cameraFrame.time,
            messageTime,
          );
    if (cameraFrame && !pointToCamera) {
      this.#latestProjectionAttempt = { version: transformTree.version, fixedFrameId };
    }

    // Settings changes that don't affect the buffers (point size, shape, decay, ...) re-submit the
    // same message; skip the full decode for those
    const decodeKey = JSON.stringify([
      settings.colorMode,
      settings.colorField,
      settings.colorFieldComputed,
      settings.colorMap,
      settings.flatColor,
      settings.gradient,
      settings.explicitAlpha,
      settings.minValue,
      settings.maxValue,
      settings.stixelsEnabled,
      pointCloudColorCamera(settings),
      hideUnpaintedPoints(settings),
      cameraFrame?.time.toString(),
      cameraFrame?.projection,
      pointToCamera != undefined,
    ])!;
    const decoded = latestPoints.decoded;
    if (decoded?.pointCloud === pointCloud && decoded.key === decodeKey) {
      return;
    }
    latestPoints.decoded = { pointCloud, key: decodeKey };

    const { unpaintedColors, paintedPoints } = this.#updatePointCloudBuffers(
      pointCloud,
      tempFieldReaders,
      pointCount,
      settings,
      positionAttribute,
      colorAttribute,
      stixelPositionAttribute,
      stixelColorAttribute,
      cameraFrame,
      pointToCamera,
    );
    this.#latestUnpaintedColors = unpaintedColors;
    this.#latestPaintedPoints = paintedPoints;
    latestStixelEntry.renderable.setCameraCoverage(unpaintedColors, paintedPoints);
  }

  #updateStixelMaterial(settings: LayerSettingsPointClouds): void {
    const current = this.userData.stixelMaterial;
    const hide = hideUnpaintedPoints(settings);
    if (
      current.alphaTest === (hide ? 1 / 255 : 0) &&
      current.transparent === (colorHasTransparency(settings) || hide)
    ) {
      return;
    }
    current.dispose();
    const material = createStixelMaterial(settings);
    this.userData.stixelMaterial = material;
    this.#stixelsHistory.forEach(({ renderable }) => {
      renderable.updateMaterial(material);
    });
  }

  public startFrame(currentTime: bigint, renderFrameId: string, fixedFrameId: string): void {
    const attempt = this.#latestProjectionAttempt;
    if (
      attempt &&
      this.userData.historyOnly !== true &&
      (attempt.version !== this.renderer.transformTree.version ||
        attempt.fixedFrameId !== this.renderer.fixedFrameId)
    ) {
      const { latestPointCloud, latestOriginalMessage, settings, receiveTime } = this.userData;
      this.updatePointCloud(
        latestPointCloud,
        latestOriginalMessage,
        settings,
        receiveTime,
        this.#latestCameraFrame,
      );
    }
    this.#pointsHistory.updateHistoryFromCurrentTime(currentTime);
    const poseOptions = { skipLatest: this.userData.historyOnly };
    let posesResolved = this.#pointsHistory.updatePoses(
      currentTime,
      renderFrameId,
      fixedFrameId,
      poseOptions,
    );
    posesResolved =
      this.#updateDecayRing(currentTime, renderFrameId, fixedFrameId) && posesResolved;
    this.#pointsHistory.forEach((entry) => {
      entry.renderable.syncPoints();
    });
    if (this.userData.settings.stixelsEnabled) {
      this.#stixelsHistory.setMaxPoints(stixelMaxVertices(this.userData.settings));
      this.#stixelsHistory.updateHistoryFromCurrentTime(currentTime);
      posesResolved =
        this.#stixelsHistory.updatePoses(currentTime, renderFrameId, fixedFrameId, poseOptions) &&
        posesResolved;
    }
    if (posesResolved) {
      this.renderer.settings.errors.remove(this.userData.settingsPath, MISSING_TRANSFORM);
    }
  }

  public isLatestScan(
    pointCloud: PointCloud | PointCloud2,
    receiveTime: bigint,
    recordId: string | undefined,
  ): boolean {
    const latest = this.userData;
    if (latest.historyOnly === true || !this.#pointsHistory.latest().renderable.decoded) {
      return false;
    }
    return isSameRecord(
      {
        recordId,
        receiveTime,
        messageTime: toNanoSec(getTimestamp(pointCloud)),
        payload: pointCloud.data,
      },
      { ...latest, payload: latest.latestPointCloud.data },
    );
  }

  public pushHistory(
    this: PointCloudHistoryRenderable,
    pointCloud: PointCloud | PointCloud2,
    settings: LayerSettingsPointClouds,
    receiveTime: bigint,
  ): void {
    const messageTime = toNanoSec(getTimestamp(pointCloud));
    const pointsHistory = this.#pointsHistory;
    const stixelsHistory = this.#stixelsHistory;
    const stixelMaterial = this.userData.stixelMaterial;
    const topic = this.userData.topic;

    // The latest scan moves into the decay ring; updatePointCloud() then decodes the new message
    // into the latest renderable's buffers
    const latest = pointsHistory.latest();
    const latestCount = latest.renderable.decoded ? latest.renderable.geometry.drawRange.count : 0;
    if (latestCount > 0) {
      const { position, color } = latest.renderable.geometry.attributes;
      this.#ring(settings).push(
        {
          receiveTime: latest.receiveTime,
          messageTime: latest.messageTime,
          recordId: latest.recordId,
          frameId: this.userData.frameId,
          pose: latest.renderable.userData.pose,
        },
        (position!.array as Float32Array).subarray(0, latestCount * 3),
        (color!.array as Uint8Array).subarray(0, latestCount * 4),
        this.#latestUnpaintedColors,
        this.#latestPaintedPoints,
      );
    }

    if (settings.stixelsEnabled) {
      const stixelGeometry = createStixelGeometry(topic, THREE.StaticDrawUsage);
      const stixels = new StixelsRenderable(
        topic,
        {
          frameId: "",
          pose: getPose(pointCloud),
          topic,
        },
        stixelGeometry,
        stixelMaterial,
      );
      stixelsHistory.addHistoryEntry({ receiveTime, messageTime, renderable: stixels });
      this.add(stixels);
    }
  }

  /**
   * Decodes a scan older than the latest one (read back after a seek) straight into the decay ring
   * (and the stixel history), leaving the latest scan as it is. A scan the history already holds
   * (e.g. played, then read back) is skipped; that is checked only when both times tie.
   */
  public addOlderScan(
    pointCloud: PointCloud | PointCloud2,
    settings: LayerSettingsPointClouds,
    receiveTime: bigint,
    recordId?: string,
    camera?: PointCloudCameraFrame,
  ): void {
    if (
      recordId != undefined &&
      this.#decayRing?.holdsRecord(recordId) === true &&
      (!settings.stixelsEnabled ||
        this.#stixelsHistory.has(
          receiveTime,
          toNanoSec(getTimestamp(pointCloud)),
          () => false,
          recordId,
        ))
    ) {
      return;
    }
    // An older cloud that can't be drawn is just skipped; the latest one stays
    const skip = () => {};
    if (
      !this.#validatePointCloud(pointCloud, skip) ||
      !this.#getPointCloudFieldReaders(tempFieldReaders, pointCloud, settings, skip)
    ) {
      return;
    }
    const messageTime = toNanoSec(getTimestamp(pointCloud));
    const count = Math.trunc(pointCloud.data.length / getStride(pointCloud));
    this.#scratch ??= createGeometry(`${this.userData.topic}:older`, THREE.StaticDrawUsage);
    this.#scratch.resize(count);
    const { position, color } = this.#scratch.attributes;
    const positions = (position!.array as Float32Array).subarray(0, count * 3);
    const colors = (color!.array as Uint8Array).subarray(0, count * 4);
    const points = { ...settings, stixelsEnabled: false };
    const frameId = this.renderer.normalizeFrameId(getFrameId(pointCloud));
    const pose = getPose(pointCloud);
    const pointToCamera =
      camera == undefined
        ? undefined
        : this.renderer.transformTree.apply(
            tempCameraPose,
            pose,
            camera.frameId,
            this.renderer.fixedFrameId,
            frameId,
            camera.time,
            messageTime,
          );
    const { unpaintedColors, paintedPoints } = this.#updatePointCloudBuffers(
      pointCloud,
      tempFieldReaders,
      count,
      points,
      position!,
      color!,
      position!,
      color!,
      camera,
      pointToCamera,
    );
    this.#ring(settings).push(
      {
        receiveTime,
        messageTime,
        recordId,
        frameId,
        pose,
      },
      positions,
      colors,
      unpaintedColors,
      paintedPoints,
    );

    // Stixels keep one renderable per scan, inserted into their history in time order
    const sameStixels = (renderable: StixelsRenderable) => {
      const tops = renderable.geometry.attributes.position!.array as Float32Array;
      if (renderable.geometry.drawRange.count !== count * 2) {
        return false;
      }
      for (let i = 0; i < count; i++) {
        if (!sameBytes(tops.subarray(i * 6, i * 6 + 3), positions.subarray(i * 3, i * 3 + 3))) {
          return false;
        }
      }
      return true;
    };
    if (
      !settings.stixelsEnabled ||
      this.#stixelsHistory.has(receiveTime, messageTime, sameStixels, recordId)
    ) {
      return;
    }
    const stixels = new StixelsRenderable(
      this.userData.topic,
      {
        frameId,
        pose: getPose(pointCloud),
        topic: this.userData.topic,
      },
      createStixelGeometry(this.userData.topic, THREE.StaticDrawUsage),
      this.userData.stixelMaterial,
    );
    stixels.geometry.resize(count * 2);
    this.#updatePointCloudBuffers(
      pointCloud,
      tempFieldReaders,
      count,
      settings,
      position!,
      color!,
      stixels.geometry.attributes.position!,
      stixels.geometry.attributes.color!,
      camera,
      pointToCamera,
    );
    stixels.setCameraCoverage(unpaintedColors, paintedPoints);
    this.add(stixels);
    this.#stixelsHistory.setMaxPoints(stixelMaxVertices(settings));
    this.#stixelsHistory.insertOlderEntry({
      receiveTime,
      messageTime,
      recordId,
      renderable: stixels,
    });
  }

  /** The decay ring, created on first use, with the point budget of `settings` */
  #ring(settings: LayerSettingsPointClouds): DecayPointRing {
    if (!this.#decayRing) {
      this.#decayRing = new DecayPointRing(this.userData.topic, pointStyle(settings), {
        maxEntries: DECAY_HISTORY_LIMITS.maxEntries,
        maxPoints: decayMaxPoints(settings),
      });
      this.add(this.#decayRing);
    }
    // A limit changed since the last frame applies to this scan already
    this.#decayRing.setMaxPoints(decayMaxPoints(settings));
    return this.#decayRing;
  }

  /** Expires, poses and budget-checks the decay ring. Returns whether all its scans resolved. */
  #updateDecayRing(currentTime: bigint, renderFrameId: string, fixedFrameId: string): boolean {
    const ring = this.#decayRing;
    if (!ring) {
      return true;
    }
    if (this.userData.settings.decayTime <= 0) {
      ring.removeFromParent();
      ring.dispose();
      this.#decayRing = undefined;
      this.renderer.settings.errors.remove(this.userData.settingsPath, DECAY_LIMITED);
      return true;
    }
    return updateDecayRing(
      this.renderer,
      this.userData,
      ring,
      decayMaxPoints(this.userData.settings),
      this.#pointsHistory.latest().renderable.geometry.drawRange.count,
      currentTime,
      renderFrameId,
      fixedFrameId,
    );
  }

  #invalidError = (message: string): void => {
    this.renderer.settings.errors.addToTopic(this.userData.topic, INVALID_POINTCLOUD, message);
    const lastEntry = this.#pointsHistory.latest();
    lastEntry.renderable.geometry.resize(0);
    lastEntry.renderable.decoded = undefined;
  };

  /** Whether the last validated cloud had a tolerated problem */
  #warned = false;

  #warn(message: string): void {
    this.#warned = true;
    this.renderer.settings.errors.addToTopic(this.userData.topic, INVALID_POINTCLOUD, message);
  }

  /** `report` gets why a cloud can't be drawn (by default an error that blanks the latest scan) */
  #validatePointCloud(pointCloud: PointCloud | PointCloud2, report = this.#invalidError): boolean {
    this.#warned = false;
    return "header" in pointCloud
      ? this.#validateRosPointCloud(pointCloud, report)
      : this.#validateFoxglovePointCloud(pointCloud, report);
  }

  #validateFoxglovePointCloud(pointCloud: PointCloud, report: (message: string) => void): boolean {
    const data = pointCloud.data;

    if (data.length % pointCloud.point_stride !== 0) {
      const message = `PointCloud data length ${data.length} is not a multiple of point_stride ${pointCloud.point_stride}`;
      report(message);
      return false;
    }

    if (pointCloud.fields.length === 0) {
      const message = `PointCloud has no fields`;
      report(message);
      return false;
    }

    return true;
  }

  #validateRosPointCloud(pointCloud: PointCloud2, report: (message: string) => void): boolean {
    const data = pointCloud.data;

    if (pointCloud.is_bigendian) {
      const message = `PointCloud2 is_bigendian=true is not supported`;
      report(message);
      return false;
    }

    if (data.length % pointCloud.point_step !== 0) {
      const message = `PointCloud2 data length ${data.length} is not a multiple of point_step ${pointCloud.point_step}`;
      report(message);
      return false;
    }

    if (pointCloud.fields.length === 0) {
      const message = `PointCloud2 has no fields`;
      report(message);
      return false;
    }

    if (data.length < pointCloud.height * pointCloud.row_step) {
      const message = `PointCloud2 data length ${data.length} is less than height ${pointCloud.height} * row_step ${pointCloud.row_step}`;
      this.#warn(message);
      // Allow this error for now since we currently ignore row_step
    }

    if (pointCloud.width * pointCloud.point_step > pointCloud.row_step) {
      const message = `PointCloud2 width ${pointCloud.width} * point_step ${pointCloud.point_step} is greater than row_step ${pointCloud.row_step}`;
      this.#warn(message);
      // Allow this error for now since we currently ignore row_step
    }

    return true;
  }

  #getPointCloudFieldReaders(
    output: PointCloudFieldReaders,
    pointCloud: PointCloud | PointCloud2,
    settings: LayerSettingsPointClouds,
    report = this.#invalidError,
  ): boolean {
    let xReader: FieldReader | undefined;
    let yReader: FieldReader | undefined;
    let zReader: FieldReader | undefined;
    let packedColorReader: FieldReader | undefined;
    let redReader: FieldReader | undefined;
    let greenReader: FieldReader | undefined;
    let blueReader: FieldReader | undefined;
    let alphaReader: FieldReader | undefined;
    const float32Offsets = new Map<string, number>();

    const stride = getStride(pointCloud);

    // Determine the minimum bytes needed per point based on offset/size of each
    // field, so we can ensure point_step is >= this value
    let minBytesPerPoint = 0;

    for (const field of pointCloud.fields) {
      // Skip this field, we don't support counts other than 1
      if (!isSupportedField(field)) {
        continue;
      }
      const type = "type" in field ? numericTypeToPointFieldType(field.type) : field.datatype;

      if (field.offset < 0) {
        const message = `PointCloud field "${field.name}" has invalid offset ${field.offset}. Must be >= 0`;
        report(message);
        return false;
      }

      if (type === PointFieldType.FLOAT32 && field.offset % 4 === 0) {
        float32Offsets.set(field.name, field.offset);
      } else {
        float32Offsets.delete(field.name);
      }

      if (field.name === "x") {
        xReader = getReader(field, stride);
        if (!xReader) {
          const typeName = pointFieldTypeName(type);
          const message = `PointCloud field "x" is invalid. type=${typeName}, offset=${field.offset}, stride=${stride}`;
          report(message);
          return false;
        }
      } else if (field.name === "y") {
        yReader = getReader(field, stride);
        if (!yReader) {
          const typeName = pointFieldTypeName(type);
          const message = `PointCloud field "y" is invalid. type=${typeName}, offset=${field.offset}, stride=${stride}`;
          report(message);
          return false;
        }
      } else if (field.name === "z") {
        zReader = getReader(field, stride);
        if (!zReader) {
          const typeName = pointFieldTypeName(type);
          const message = `PointCloud field "z" is invalid. type=${typeName}, offset=${field.offset}, stride=${stride}`;
          report(message);
          return false;
        }
      } else if (field.name === "red") {
        redReader = getReader(field, stride, /*normalize*/ true);
      } else if (field.name === "green") {
        greenReader = getReader(field, stride, /*normalize*/ true);
      } else if (field.name === "blue") {
        blueReader = getReader(field, stride, /*normalize*/ true);
      } else if (field.name === "alpha") {
        alphaReader = getReader(field, stride, /*normalize*/ true);
      }

      const byteWidth = pointFieldWidth(type);
      minBytesPerPoint = Math.max(minBytesPerPoint, field.offset + byteWidth);

      if (field.name === settings.colorField) {
        // If the selected color mode is rgb/rgba and the field only has one channel with at least a
        // four byte width, force the color data to be interpreted as four individual bytes. This
        // overcomes a common problem where the color field data type is set to float32 or something
        // other than uint32
        const forceType =
          (settings.colorMode === "rgb" || settings.colorMode === "rgba") && byteWidth >= 4
            ? "type" in field
              ? NumericType.UINT32
              : PointFieldType.UINT32
            : undefined;
        packedColorReader = getReader(field, stride, /*normalize*/ false, forceType);
        if (!packedColorReader) {
          const typeName = pointFieldTypeName(type);
          const message = `PointCloud field "${field.name}" is invalid. type=${typeName}, offset=${field.offset}, stride=${stride}`;
          report(message);
          return false;
        }
      }
    }

    if (settings.colorFieldComputed === "distance") {
      packedColorReader = (view: DataView, pointOffset: number) => {
        const x = xReader?.(view, pointOffset) ?? 0;
        const y = yReader?.(view, pointOffset) ?? 0;
        const z = zReader?.(view, pointOffset) ?? 0;
        // Math.hypot is several times slower and the overflow safety it buys is irrelevant here
        return Math.sqrt(x * x + y * y + z * z);
      };
    }
    if (minBytesPerPoint > stride) {
      const message = `PointCloud stride ${stride} is less than minimum bytes per point ${minBytesPerPoint}`;
      report(message);
      return false;
    }

    const positionReaderCount = (xReader ? 1 : 0) + (yReader ? 1 : 0) + (zReader ? 1 : 0);
    if (positionReaderCount < 2) {
      const message = `PointCloud must contain at least two of x/y/z fields`;
      report(message);
      return false;
    }

    output.xReader = xReader ?? zeroReader;
    output.yReader = yReader ?? zeroReader;
    output.zReader = zReader ?? zeroReader;
    output.packedColorReader = packedColorReader ?? xReader ?? yReader ?? zReader ?? zeroReader;
    output.redReader = redReader ?? zeroReader;
    output.greenReader = greenReader ?? zeroReader;
    output.blueReader = blueReader ?? zeroReader;
    output.alphaReader = alphaReader ?? zeroReader;
    const xOffset = float32Offsets.get("x");
    const yOffset = float32Offsets.get("y");
    const zOffset = float32Offsets.get("z");
    output.float32XyzOffsets =
      xOffset != undefined &&
      yOffset != undefined &&
      zOffset != undefined &&
      stride % 4 === 0 &&
      pointCloud.data.byteOffset % 4 === 0
        ? [xOffset, yOffset, zOffset]
        : undefined;
    return true;
  }

  #updatePointCloudBuffers(
    pointCloud: PointCloud | PointCloud2,
    readers: PointCloudFieldReaders,
    pointCount: number,
    settings: LayerSettingsPointClouds,
    positionAttribute: THREE.BufferAttribute,
    colorAttribute: THREE.BufferAttribute,
    stixelPositionAttribute: THREE.BufferAttribute,
    stixelColorAttribute: THREE.BufferAttribute,
    cameraFrame: PointCloudCameraFrame | undefined,
    pointToCamera: Pose | undefined,
  ): { unpaintedColors: Uint8Array | undefined; paintedPoints: Uint8Array | undefined } {
    const data = pointCloud.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const pointStep = getStride(pointCloud);
    const {
      xReader,
      yReader,
      zReader,
      packedColorReader,
      redReader,
      greenReader,
      blueReader,
      alphaReader,
      float32XyzOffsets,
    } = readers;

    // Hot loops for large clouds: write the typed arrays directly. BufferAttribute.setXYZ/W
    // re-normalizes every component through a type switch.
    const positions = positionAttribute.array as Float32Array;
    const colors = colorAttribute.array as Uint8Array;
    const stixelsEnabled = settings.stixelsEnabled;

    // Update position attribute
    if (float32XyzOffsets) {
      // Aligned float32 x/y/z (nearly every lidar): index a Float32Array instead of three DataView
      // reader calls per point
      const floats = new Float32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
      const floatStride = pointStep >> 2;
      const ox = float32XyzOffsets[0] >> 2;
      const oy = float32XyzOffsets[1] >> 2;
      const oz = float32XyzOffsets[2] >> 2;
      for (let i = 0, p = 0, f = 0; i < pointCount; i++, p += 3, f += floatStride) {
        positions[p] = floats[f + ox]!;
        positions[p + 1] = floats[f + oy]!;
        positions[p + 2] = floats[f + oz]!;
      }
    } else {
      for (let i = 0, p = 0; i < pointCount; i++, p += 3) {
        const pointOffset = i * pointStep;
        positions[p] = xReader(view, pointOffset);
        positions[p + 1] = yReader(view, pointOffset);
        positions[p + 2] = zReader(view, pointOffset);
      }
    }
    if (stixelsEnabled) {
      const stixelPositions = stixelPositionAttribute.array as Float32Array;
      for (let i = 0, p = 0, sp = 0; i < pointCount; i++, p += 3, sp += 6) {
        stixelPositions[sp] = stixelPositions[sp + 3] = positions[p]!;
        stixelPositions[sp + 1] = stixelPositions[sp + 4] = positions[p + 1]!;
        stixelPositions[sp + 2] = positions[p + 2]!;
        stixelPositions[sp + 5] = 0;
      }
    }

    // Update color attribute
    const colorMode = settings.colorMode;
    if (colorMode === "rgba-fields") {
      for (let i = 0; i < pointCount; i++) {
        const pointOffset = i * pointStep;
        writeColor(
          colors,
          i,
          redReader(view, pointOffset),
          greenReader(view, pointOffset),
          blueReader(view, pointOffset),
          alphaReader(view, pointOffset),
        );
      }
    } else if (colorMode === "rgb" || colorMode === "rgba") {
      // 0xaarrggbb, same as getColorBgra() but straight to bytes
      const explicitAlpha = Math.round(settings.explicitAlpha * 255);
      for (let i = 0, c = 0; i < pointCount; i++, c += 4) {
        const num = packedColorReader(view, i * pointStep) >>> 0;
        colors[c] = (num >>> 16) & 0xff;
        colors[c + 1] = (num >>> 8) & 0xff;
        colors[c + 2] = num & 0xff;
        colors[c + 3] = colorMode === "rgba" ? num >>> 24 : explicitAlpha;
      }
    } else if (colorMode === "flat") {
      if (pointCount > 0) {
        getColorConverter({ ...settings, colorMode }, 0, 0)(tempColor, 0);
        writeColor(colors, 0, tempColor.r, tempColor.g, tempColor.b, tempColor.a);
        const colors32 = new Uint32Array(colors.buffer, colors.byteOffset, pointCount);
        colors32.fill(colors32[0]!);
      }
    } else {
      // Read each color value once, tracking the auto min/max in the same pass. Only finite
      // values count, so one NaN or ±Infinity can't give every point the same color.
      const values = colorValueScratch(pointCount);
      let minColorValue = Number.POSITIVE_INFINITY;
      let maxColorValue = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < pointCount; i++) {
        const value = packedColorReader(view, i * pointStep);
        values[i] = value;
        if (Number.isFinite(value)) {
          if (value < minColorValue) {
            minColorValue = value;
          }
          if (value > maxColorValue) {
            maxColorValue = value;
          }
        }
      }
      minColorValue = settings.minValue ?? minColorValue;
      maxColorValue = settings.maxValue ?? maxColorValue;

      // gradient/colormap only depend on the clamped fraction (value - min) / delta, so sample
      // the converter once into an RGBA8 table instead of running it per point
      const colorConverter = getColorConverter(
        { ...settings, colorMode },
        minColorValue,
        maxColorValue,
      );
      const lut32 = new Uint32Array(
        buildColorLut(colorConverter, minColorValue, maxColorValue).buffer,
      );
      const colors32 = new Uint32Array(colors.buffer, colors.byteOffset, pointCount);
      const valueDelta = Math.max(maxColorValue - minColorValue, Number.EPSILON);
      const scale = (COLOR_LUT_SIZE - 1) / valueDelta;
      for (let i = 0; i < pointCount; i++) {
        const colorValue = values[i]!;
        const index = Math.round((colorValue - minColorValue) * scale);
        if (index >= 0 && index < COLOR_LUT_SIZE) {
          colors32[i] = lut32[index]!;
        } else if (index < 0) {
          colors32[i] = lut32[0]!;
        } else if (index >= COLOR_LUT_SIZE) {
          colors32[i] = lut32[COLOR_LUT_SIZE - 1]!;
        } else {
          // NaN: keep whatever the converter makes of it
          colorConverter(tempColor, colorValue);
          writeColor(colors, i, tempColor.r, tempColor.g, tempColor.b, tempColor.a);
        }
      }
    }

    const hide = hideUnpaintedPoints(settings);
    const unpaintedColors =
      hide || (cameraFrame && pointToCamera) ? colors.slice(0, pointCount * 4) : undefined;
    let paintedPoints: Uint8Array | undefined;
    if (cameraFrame && pointToCamera) {
      paintedPoints = new Uint8Array(pointCount);
      paintPointColors(
        positions,
        colors,
        pointCount,
        cameraFrame,
        pointToCamera,
        pointCloudColorEncoding(settings),
        paintedPoints,
      );
    }
    if (hide && unpaintedColors) {
      applyCameraFallback(colors, unpaintedColors, paintedPoints, {
        hide: true,
      });
    }
    if (stixelsEnabled) {
      // Both stixel vertices get the point's color
      const colors32 = new Uint32Array(colors.buffer, colors.byteOffset, pointCount);
      const stixelColors32 = new Uint32Array(
        (stixelColorAttribute.array as Uint8Array).buffer,
        0,
        pointCount * 2,
      );
      for (let i = 0; i < pointCount; i++) {
        stixelColors32[i * 2] = stixelColors32[i * 2 + 1] = colors32[i]!;
      }
    }

    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    stixelPositionAttribute.needsUpdate = true;
    stixelColorAttribute.needsUpdate = true;
    return { unpaintedColors, paintedPoints };
  }
}

export class PointClouds extends SceneExtension<PointCloudHistoryRenderable> {
  public static extensionId = "foxglove.PointClouds";
  #fieldsByTopic = new Map<string, string[]>();
  #waitingScans = new Map<string, WaitingScan[]>();
  #cameraTimeout: ReturnType<typeof setTimeout> | undefined;

  public constructor(renderer: Renderer) {
    super(PointClouds.extensionId, renderer);
  }

  public override removeAllRenderables(): void {
    this.#clearWaitingScans();
    super.removeAllRenderables();
  }

  public override dispose(): void {
    this.#clearWaitingScans();
    super.dispose();
  }

  #clearWaitingScans(): void {
    this.#waitingScans.clear();
    clearTimeout(this.#cameraTimeout);
    this.#cameraTimeout = undefined;
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: ROS_POINTCLOUD_DATATYPES,
        subscription: {
          handler: this.#handleRosPointCloud,
          filterQueue: (msgs) => keepDecayingTopics(this.renderer, msgs),
        },
      },
      {
        type: "schema",
        schemaNames: FOXGLOVE_POINTCLOUD_DATATYPES,
        subscription: {
          handler: this.#handleFoxglovePointCloud,
          filterQueue: (msgs) => keepDecayingTopics(this.renderer, msgs),
        },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    const cameraTopics = (this.renderer.topics ?? [])
      .filter((topic) => topicIsConvertibleToSchema(topic, ALL_SUPPORTED_IMAGE_SCHEMAS))
      .map((topic) => topic.name)
      .sort();
    for (const topic of this.renderer.topics ?? []) {
      const isPointCloud = topicIsConvertibleToSchema(topic, ALL_POINTCLOUD_DATATYPES);
      if (!isPointCloud) {
        continue;
      }
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsPointClouds>;
      const messageFields = this.#fieldsByTopic.get(topic.name) ?? POINT_CLOUD_REQUIRED_FIELDS;
      const node: SettingsTreeNodeWithActionHandler = {
        ...pointCloudSettingsNode(topic, messageFields, config, { decayLimit: true, cameraTopics }),
        handler,
      };
      entries.push({ path: ["topics", topic.name], node });
    }
    return entries;
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    // Do not call super.startFrame() since we handle updatePose() manually.
    // Instead of updating the pose for each Renderable in this.renderables, we
    // update the pose of each THREE.Points object in the pointsHistory of each
    // renderable

    this.#flushWaitingScans();
    for (const [topic, renderable] of this.renderables) {
      if (!renderable.userData.settings.visible) {
        renderable.removeFromParent();
        renderable.dispose();
        this.renderables.delete(topic);
        continue;
      }
      if (renderable.waitingToRepaint) {
        const camera = this.#cameraFrame(renderable.userData.settings);
        if (camera) {
          renderable.repaintFromCamera(camera);
        }
      }
      renderable.startFrame(currentTime, renderFrameId, fixedFrameId);
    }
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    const topicName = path[1]!;
    const value = action.payload.value;
    if (path[2] === "colorMode") {
      this.renderer.updateConfig((draft) => {
        const config = draft.topics[topicName];
        draft.topics[topicName] = {
          ...config,
          colorFromCamera: value === "camera",
          ...(value !== "camera" && { colorMode: value }),
        } as Partial<LayerSettingsPointClouds>;
      });
      this.updateSettingsTree();
    } else if (path[2] === "cameraFallbackColorMode") {
      this.renderer.updateConfig((draft) => {
        draft.topics[topicName] = {
          ...draft.topics[topicName],
          hideUnpaintedCameraPoints: value === "hide",
          ...(value !== "hide" && { colorMode: value }),
        } as Partial<LayerSettingsPointClouds>;
      });
      this.updateSettingsTree();
    } else {
      this.saveSetting(path, value);
    }

    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const prevSettings = this.renderer.config.topics[topicName];
      const settings: LayerSettingsPointClouds = { ...DEFAULT_SETTINGS, ...prevSettings };
      renderable.applySettings(settings);
    }
  };

  #handleFoxglovePointCloud = (messageEvent: PartialMessageEvent<PointCloud>): void => {
    const { topic, schemaName } = messageEvent;
    const pointCloud = normalizePointCloud(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    const messageTime = toNanoSec(pointCloud.timestamp);
    const frameId = pointCloud.frame_id;

    this.#handlePointCloud(
      topic,
      schemaName,
      pointCloud,
      receiveTime,
      messageTime,
      messageEvent.message as RosObject,
      frameId,
      { recordId: messageEvent.recordId },
    );
  };

  #handleRosPointCloud = (messageEvent: PartialMessageEvent<PointCloud2>): void => {
    const { topic, schemaName } = messageEvent;
    const pointCloud = normalizePointCloud2(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    const messageTime = toNanoSec(pointCloud.header.stamp);
    const frameId = pointCloud.header.frame_id;

    this.#handlePointCloud(
      topic,
      schemaName,
      pointCloud,
      receiveTime,
      messageTime,
      messageEvent.message as RosObject,
      frameId,
      { recordId: messageEvent.recordId },
    );
  };

  #handlePointCloud(
    topic: string,
    schemaName: string,
    pointCloud: PointCloud | PointCloud2,
    receiveTime: bigint,
    messageTime: bigint,
    originalMessage: RosObject,
    frameId: string,
    options: { historyOnly?: true; recordId?: string },
  ): PointCloudHistoryRenderable {
    // Update the mapping of topic to point cloud field names if necessary
    let fields = this.#fieldsByTopic.get(topic);
    // Compare the supported fields by name, without allocating per message: another recording on
    // the same topic can have as many fields with other names (x,y,z,intensity vs x,y,z,rgb)
    let numSupportedFields = 0;
    let sameFields = fields != undefined;
    for (const field of pointCloud.fields) {
      if (isSupportedField(field)) {
        sameFields &&= fields?.[numSupportedFields] === field.name;
        numSupportedFields++;
      }
    }
    let fieldsForTopicUpdated = false;
    if (!sameFields || fields?.length !== numSupportedFields) {
      // Omit fields with count != 1 (only applies to ros pointclouds)
      // can't use filterMap here because of incompatible types
      fields = pointCloud.fields.filter(isSupportedField).map((field) => field.name);
      this.#fieldsByTopic.set(topic, fields);
      fieldsForTopicUpdated = true;
      this.updateSettingsTree();
    }

    let renderable = this.renderables.get(topic);
    if (!renderable) {
      // Set the initial settings from default values merged with any user settings
      const userSettings = (this.renderer.config.topics[topic] ??
        {}) as Partial<LayerSettingsPointClouds>;
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };

      // want to avoid setting this if fields didn't update
      if (settings.colorField == undefined && fieldsForTopicUpdated) {
        autoSelectColorSettings(settings, fields, {
          supportsPackedRgbModes: ROS_POINTCLOUD_DATATYPES.has(schemaName),
          supportsRgbaFieldsMode: FOXGLOVE_POINTCLOUD_DATATYPES.has(schemaName),
        });

        // Update user settings with the newly selected color field
        this.renderer.updateConfig((draft) => {
          const updatedUserSettings = { ...userSettings };
          updatedUserSettings.colorField = settings.colorField;
          updatedUserSettings.colorMode = settings.colorMode;
          updatedUserSettings.colorMap = settings.colorMap;
          draft.topics[topic] = updatedUserSettings;
        });
        this.updateSettingsTree();
      }

      const stixelMaterial = createStixelMaterial(settings);

      renderable = new PointCloudHistoryRenderable(topic, this.renderer, {
        receiveTime,
        messageTime,
        frameId: this.renderer.normalizeFrameId(frameId),
        pose: makePose(),
        settingsPath: ["topics", topic],
        settings,
        topic,
        latestPointCloud: pointCloud,
        latestOriginalMessage: originalMessage,
        stixelMaterial,
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    if (options.historyOnly === true) {
      renderable.userData.historyOnly = true;
      return renderable;
    }
    const { settings } = renderable.userData;

    if (pointCloudColorCamera(settings) == undefined && !this.#waitingScans.has(topic)) {
      this.#applyScan(renderable, pointCloud, originalMessage, receiveTime, options.recordId);
      return renderable;
    }
    let queue = this.#waitingScans.get(topic);
    if (!queue) {
      queue = [];
      this.#waitingScans.set(topic, queue);
    }
    queue.push({
      pointCloud,
      originalMessage,
      receiveTime,
      deadline: performance.now() + CAMERA_DECODE_WAIT_MS,
      recordId: options.recordId,
    });
    return renderable;
  }

  #cameraFrame(
    settings: LayerSettingsPointClouds,
    scanTime?: bigint,
  ): PointCloudCameraFrame | undefined {
    const cameraTopic = pointCloudColorCamera(settings);
    if (cameraTopic == undefined) {
      return undefined;
    }
    const images = this.renderer.sceneExtensions.get(Images.extensionId);
    const frame =
      images instanceof Images ? images.pointCloudCameraFrame(cameraTopic, scanTime) : undefined;
    return frame ? { ...frame, projection: settings.cameraColorProjection } : undefined;
  }

  #flushWaitingScans(): void {
    const now = performance.now();
    let nextDeadline = Infinity;
    for (const [topic, queue] of this.#waitingScans) {
      const renderable = this.renderables.get(topic);
      if (renderable?.userData.settings.visible !== true) {
        this.#waitingScans.delete(topic);
        continue;
      }
      const colorCameraTopic = pointCloudColorCamera(renderable.userData.settings);
      let processed = 0;
      for (const scan of queue) {
        const camera = this.#cameraFrame(
          renderable.userData.settings,
          toNanoSec(getTimestamp(scan.pointCloud)),
        );
        if (
          colorCameraTopic != undefined &&
          !camera &&
          scan.deadline > now &&
          queue.length - processed <= MAX_WAITING_SCANS
        ) {
          nextDeadline = Math.min(nextDeadline, scan.deadline);
          break;
        }
        this.#applyScan(
          renderable,
          scan.pointCloud,
          scan.originalMessage,
          scan.receiveTime,
          scan.recordId,
          camera,
        );
        ++processed;
      }
      queue.splice(0, processed);
      if (queue.length === 0) {
        this.#waitingScans.delete(topic);
      }
    }
    clearTimeout(this.#cameraTimeout);
    this.#cameraTimeout = Number.isFinite(nextDeadline)
      ? setTimeout(
          () => {
            this.renderer.queueAnimationFrame();
          },
          Math.max(1, nextDeadline - now),
        )
      : undefined;
  }

  #applyScan(
    renderable: PointCloudHistoryRenderable,
    cloud: PointCloud | PointCloud2,
    originalMessage: RosObject,
    receiveTime: bigint,
    recordId: string | undefined,
    camera?: PointCloudCameraFrame,
  ): void {
    const { settings } = renderable.userData;
    if (settings.decayTime > 0 && !renderable.isLatestScan(cloud, receiveTime, recordId)) {
      renderable.pushHistory(cloud, settings, receiveTime);
    }
    renderable.userData.historyOnly = undefined;
    renderable.userData.recordId = recordId;
    renderable.updatePointCloud(cloud, originalMessage, settings, receiveTime, camera);
  }

  public readonly historySchemas: ReadonlySet<string> = new Set([
    ...ROS_POINTCLOUD_DATATYPES,
    ...FOXGLOVE_POINTCLOUD_DATATYPES,
  ]);

  /** See {@link DecayHistoryIngest} */
  public addHistoricalMessage(messageEvent: MessageEvent): bigint | undefined {
    const ros = ROS_POINTCLOUD_DATATYPES.has(messageEvent.schemaName);
    let renderable = this.renderables.get(messageEvent.topic);
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    const { recordId } = messageEvent;
    if (!renderable && pointDecayTime(this.renderer.config.topics[messageEvent.topic]) <= 0) {
      return undefined;
    }
    // Playback owns anything newer than a drawn scan, if the seek drew one.
    if (
      renderable &&
      renderable.userData.historyOnly !== true &&
      receiveTime > renderable.userData.receiveTime
    ) {
      return undefined;
    }
    const pointCloud = ros
      ? normalizePointCloud2(messageEvent.message as PartialMessage<PointCloud2>)
      : normalizePointCloud(messageEvent.message as PartialMessage<PointCloud>);
    const stamp = toNanoSec(getTimestamp(pointCloud));
    renderable ??= this.#handlePointCloud(
      messageEvent.topic,
      messageEvent.schemaName,
      pointCloud,
      receiveTime,
      stamp,
      messageEvent.message as RosObject,
      getFrameId(pointCloud),
      { historyOnly: true },
    );
    const { settings, historyOnly } = renderable.userData;
    const sameAsDrawn =
      historyOnly !== true &&
      isSameRecord(
        { recordId, receiveTime, messageTime: stamp, payload: pointCloud.data },
        { ...renderable.userData, payload: renderable.userData.latestPointCloud.data },
      );
    if (settings.decayTime <= 0 || sameAsDrawn) {
      return undefined;
    }
    renderable.addOlderScan(
      pointCloud,
      settings,
      receiveTime,
      recordId,
      this.#cameraFrame(settings, stamp),
    );
    return stamp;
  }
}

/** Writes a 0-1 RGBA color as normalized uint8, same as BufferAttribute.setXYZW() */
function writeColor(
  colors: Uint8Array,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const c = i * 4;
  colors[c] = Math.round(r * 255);
  colors[c + 1] = Math.round(g * 255);
  colors[c + 2] = Math.round(b * 255);
  colors[c + 3] = Math.round(a * 255);
}

let colorValueScratchArray = new Float64Array(0);
/** Reused per-point color value buffer; only valid until the next call */
function colorValueScratch(pointCount: number): Float64Array {
  if (colorValueScratchArray.length < pointCount) {
    colorValueScratchArray = new Float64Array(pointCount);
  }
  return colorValueScratchArray;
}

// Large enough that neighboring entries differ by at most one 8-bit step
const COLOR_LUT_SIZE = 4096;

/** Samples `converter` over [min, max] into a COLOR_LUT_SIZE x RGBA8 table */
function buildColorLut(converter: ColorConverter, minValue: number, maxValue: number): Uint8Array {
  const lut = new Uint8Array(COLOR_LUT_SIZE * 4);
  const valueDelta = Math.max(maxValue - minValue, Number.EPSILON);
  for (let i = 0; i < COLOR_LUT_SIZE; i++) {
    converter(tempColor, minValue + (i / (COLOR_LUT_SIZE - 1)) * valueDelta);
    writeColor(lut, i, tempColor.r, tempColor.g, tempColor.b, tempColor.a);
  }
  return lut;
}

function pointFieldTypeName(type: PointFieldType): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return PointFieldType[type] ?? `${type}`;
}

function pointFieldWidth(type: PointFieldType): number {
  switch (type) {
    case PointFieldType.INT8:
    case PointFieldType.UINT8:
      return 1;
    case PointFieldType.INT16:
    case PointFieldType.UINT16:
    case PointFieldType.FLOAT16:
      return 2;
    case PointFieldType.INT32:
    case PointFieldType.UINT32:
    case PointFieldType.FLOAT32:
      return 4;
    case PointFieldType.FLOAT64:
      return 8;
    default:
      return 0;
  }
}

function zeroReader(): number {
  return 0;
}

function normalizePointField(field: PartialMessage<PointField> | undefined): PointField {
  if (!field) {
    return { name: "", offset: 0, datatype: PointFieldType.UNKNOWN, count: 0 };
  }
  return {
    name: field.name ?? "",
    offset: field.offset ?? 0,
    datatype: field.datatype ?? PointFieldType.UNKNOWN,
    count: field.count ?? 0,
  };
}

function normalizePackedElementField(
  field: PartialMessage<PackedElementField> | undefined,
): PackedElementField {
  return {
    name: field?.name ?? "",
    offset: field?.offset ?? 0,
    type: field?.type ?? 0,
  };
}

function normalizePointCloud(message: PartialMessage<PointCloud>): PointCloud {
  return {
    timestamp: normalizeTime(message.timestamp),
    frame_id: message.frame_id ?? "",
    pose: normalizePose(message.pose),
    point_stride: message.point_stride ?? 0,
    fields: message.fields?.map(normalizePackedElementField) ?? [],
    data: normalizeByteArray(message.data),
  };
}

function normalizePointCloud2(message: PartialMessage<PointCloud2>): PointCloud2 {
  return {
    header: normalizeHeader(message.header),
    height: message.height ?? 0,
    width: message.width ?? 0,
    fields: message.fields?.map(normalizePointField) ?? [],
    is_bigendian: message.is_bigendian ?? false,
    point_step: message.point_step ?? 0,
    row_step: message.row_step ?? 0,
    data: normalizeByteArray(message.data),
    is_dense: message.is_dense ?? false,
  };
}

function getTimestamp(pointCloud: PointCloud | PointCloud2): Time {
  return "header" in pointCloud ? pointCloud.header.stamp : pointCloud.timestamp;
}

function getFrameId(pointCloud: PointCloud | PointCloud2): string {
  return "header" in pointCloud ? pointCloud.header.frame_id : pointCloud.frame_id;
}

function getStride(pointCloud: PointCloud | PointCloud2): number {
  return "point_step" in pointCloud ? pointCloud.point_step : pointCloud.point_stride;
}

function getPose(pointCloud: PointCloud | PointCloud2): Pose {
  return "pose" in pointCloud ? pointCloud.pose : makePose();
}

export function createStixelMaterial(settings: LayerSettingsPointClouds): THREE.LineBasicMaterial {
  const hide = hideUnpaintedPoints(settings);
  const transparent = colorHasTransparency(settings) || hide;
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent,
    alphaTest: hide ? 1 / 255 : 0,
    depthWrite: true,
  });
  return material;
}

function createStixelGeometry(topic: string, usage: THREE.Usage): DynamicBufferGeometry {
  const geometry = new DynamicBufferGeometry(usage);
  geometry.name = `${topic}:PointCloud:stixelGeometry`;
  geometry.createAttribute("position", Float32Array, 3);
  geometry.createAttribute("color", Uint8Array, 4, true);
  return geometry;
}

type StixelsUserData = ChildUserData & {
  /** The scan's frame, used when painting with a camera */
  frameId: string;
};

class StixelsRenderable extends Renderable<StixelsUserData, /*TRenderer=*/ undefined> {
  #stixels: THREE.LineSegments<DynamicBufferGeometry, THREE.LineBasicMaterial>;
  public readonly geometry: DynamicBufferGeometry;
  #cameraOriginalColors: Uint8Array | undefined;
  #cameraPaintedPoints: Uint8Array | undefined;
  #originalOpacity: Uint8Array | undefined;

  public constructor(
    name: string,
    userData: StixelsUserData,
    geometry: DynamicBufferGeometry,
    material: THREE.LineBasicMaterial,
  ) {
    super(name, undefined, userData);
    this.geometry = geometry;
    const stixels = new THREE.LineSegments<DynamicBufferGeometry, THREE.LineBasicMaterial>(
      geometry,
      material,
    );
    // We don't calculate the bounding sphere for points, so frustum culling is disabled
    stixels.frustumCulled = false;
    stixels.name = `${userData.topic}:PointCloud:stixels`;
    this.#stixels = stixels;
    this.add(stixels);
  }

  public releaseMessage(): void {
    // Holds no message data.
  }

  public override dispose(): void {
    this.#stixels.geometry.dispose();
  }

  public setCameraCoverage(
    original: Uint8Array | undefined,
    painted: Uint8Array | undefined,
  ): void {
    this.#cameraOriginalColors = original;
    this.#cameraPaintedPoints = painted;
    this.#originalOpacity = undefined;
  }

  public recolor(
    paint?: (
      positions: Float32Array,
      colors: Uint8Array,
      count: number,
      painted: Uint8Array,
    ) => void,
  ): void {
    const attribute = this.geometry.attributes.color!;
    const count = Math.min(this.geometry.drawRange.count, attribute.count) / 2;
    const original = this.#cameraOriginalColors;
    if (count === 0 || (!paint && !original)) {
      this.updateCameraFallback({ hide: false });
      return;
    }
    this.updateCameraFallback({ hide: false });
    const target = new Uint32Array(attribute.array.buffer, attribute.array.byteOffset, count * 2);
    const colors = original?.slice() ?? new Uint8Array(count * 4);
    const packed = new Uint32Array(colors.buffer, colors.byteOffset, count);
    if (!original) {
      for (let i = 0; i < count; i++) {
        packed[i] = target[i * 2]!;
      }
    }
    if (paint) {
      const vertices = this.geometry.attributes.position!.array as Float32Array;
      const tops = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        tops.set(vertices.subarray(i * 6, i * 6 + 3), i * 3);
      }
      const baseline = original ?? colors.slice();
      const painted = new Uint8Array(count);
      paint(tops, colors, count, painted);
      this.setCameraCoverage(baseline, painted);
    } else {
      this.setCameraCoverage(undefined, undefined);
    }
    for (let i = 0; i < count; i++) {
      target[i * 2] = target[i * 2 + 1] = packed[i]!;
    }
    attribute.needsUpdate = true;
  }

  public updateCameraFallback({ hide }: { hide: boolean }): void {
    const attribute = this.geometry.attributes.color!;
    const colors = attribute.array as Uint8Array;
    const count = Math.min(this.geometry.drawRange.count, attribute.count) / 2;
    const original = this.#cameraOriginalColors;
    if (original == undefined && this.#originalOpacity == undefined && !hide) {
      return;
    }
    const hadSaved = this.#originalOpacity != undefined;
    const saved = (this.#originalOpacity ??= new Uint8Array(count));
    for (let i = 0; i < count; i++) {
      const offset = i * 8 + 3;
      if (hide && !original && !hadSaved) {
        saved[i] = colors[offset]!;
      }
      const alpha =
        hide && this.#cameraPaintedPoints?.[i] !== 1 ? 0 : (original?.[i * 4 + 3] ?? saved[i]!);
      colors[offset] = colors[offset + 4] = alpha;
    }
    if (!hide) {
      this.#originalOpacity = undefined;
    }
    attribute.needsUpdate = true;
  }

  public updateMaterial(material: THREE.LineBasicMaterial) {
    this.#stixels.material = material;
  }
}
