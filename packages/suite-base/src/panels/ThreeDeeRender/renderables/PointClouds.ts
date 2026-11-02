// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { NumericType, PackedElementField, PointCloud } from "@foxglove/schemas";
import * as _ from "lodash-es";
import * as THREE from "three";

import { Time, toNanoSec } from "@lichtblick/rostime";
import { SettingsTreeAction, MessageEvent } from "@lichtblick/suite";
import { DynamicBufferGeometry } from "@lichtblick/suite-base/panels/ThreeDeeRender/DynamicBufferGeometry";
import {
  createCubeMaterials,
  createGeometry,
  CubeMaterials,
  disposeCubeMaterials,
  createInstancePickingMaterial,
  createPickingMaterial,
  DEFAULT_POINT_SETTINGS,
  LayerSettingsPointExtension,
  pointSettingsNode,
  pointCloudMaterial,
  pointCloudColorEncoding,
  POINT_CLOUD_REQUIRED_FIELDS,
  RenderObjectHistory,
  PointsRenderable,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/pointExtensionUtils";
import type { RosObject, RosValue } from "@lichtblick/suite-base/players/types";

import {
  autoSelectColorSettings,
  ColorConverter,
  colorHasTransparency,
  getColorConverter,
  colorFieldComputedPrefix,
} from "./colorMode";
import type { AnyRendererSubscription, IRenderer } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import { PartialMessage, PartialMessageEvent, SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry, SettingsTreeNodeWithActionHandler } from "../SettingsManager";
import { POINTCLOUD_DATATYPES as FOXGLOVE_POINTCLOUD_DATATYPES } from "../foxglove";
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
import { FieldReader, getReader, isSupportedField } from "./pointClouds/fieldReaders";

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

type LayerSettingsPointClouds = LayerSettingsPointExtension & {
  stixelsEnabled: boolean;
  colorFieldComputed: "distance" | undefined;
};

const DEFAULT_SETTINGS = {
  ...DEFAULT_POINT_SETTINGS,
  stixelsEnabled: false,
  colorFieldComputed: undefined,
};

type PointCloudHistoryUserData = BaseUserData & {
  settings: LayerSettingsPointClouds;
  topic: string;
  latestPointCloud: PointCloud | PointCloud2;
  latestOriginalMessage: Record<string, RosValue> | undefined;
  material: THREE.PointsMaterial;
  pickingMaterial: THREE.ShaderMaterial;
  instancePickingMaterial: THREE.ShaderMaterial;
  stixelMaterial: THREE.LineBasicMaterial;
};

const ALL_POINTCLOUD_DATATYPES = new Set<string>([
  ...FOXGLOVE_POINTCLOUD_DATATYPES,
  ...ROS_POINTCLOUD_DATATYPES,
]);

const INVALID_POINTCLOUD = "INVALID_POINTCLOUD";

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

type PointCloudUserData = BaseUserData & {
  pointCloud: PointCloud | PointCloud2;
  originalMessage: Record<string, RosValue> | undefined;
};

class PointCloudRenderable extends PointsRenderable<PointCloudUserData> {
  /** What the geometry buffers currently hold, to skip re-decoding unchanged data */
  public decoded: { pointCloud: PointCloud | PointCloud2; key: string } | undefined;

  public override details(): Record<string, RosValue> {
    return this.userData.originalMessage ?? {};
  }

  public override instanceDetails(instanceId: number): Record<string, RosValue> | undefined {
    const pointCloud = this.userData.pointCloud;
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
  #cubeMaterials: CubeMaterials;

  public constructor(topic: string, renderer: IRenderer, userData: PointCloudHistoryUserData) {
    super(topic, renderer, userData);

    const isDecay = userData.settings.decayTime > 0;
    const geometry = createGeometry(
      topic,
      isDecay ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage,
    );

    const points = new PointCloudRenderable(
      topic,
      {
        receiveTime: -1n, // unused
        messageTime: -1n, // unused
        frameId: "", //unused
        pose: getPose(userData.latestPointCloud),
        settingsPath: [], //unused
        settings: { visible: true }, //unused
        topic,
        pointCloud: userData.latestPointCloud,
        originalMessage: userData.latestOriginalMessage,
      },
      geometry,
      userData.material,
      userData.pickingMaterial,
      userData.instancePickingMaterial,
    );
    this.#cubeMaterials = createCubeMaterials(userData.settings);
    this.#applyShape(points);
    this.#pointsHistory = new RenderObjectHistory({
      initial: {
        messageTime: userData.messageTime,
        receiveTime: userData.receiveTime,
        renderable: points,
      },
      parentRenderable: this,
      renderer,
    });
    this.add(points);

    const stixelGeometry = createStixelGeometry(
      topic,
      isDecay ? THREE.StaticDrawUsage : THREE.DynamicDrawUsage,
    );
    const stixels = new StixelsRenderable(
      topic,
      {
        receiveTime: -1n, // unused
        messageTime: -1n, // unused
        frameId: "", //unused
        pose: getPose(userData.latestPointCloud),
        settingsPath: [], //unused
        settings: { visible: true }, //unused
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
    });

    this.add(stixels);
  }

  public override dispose(): void {
    this.userData.latestOriginalMessage = undefined;
    this.userData.material.dispose();
    this.userData.pickingMaterial.dispose();
    this.userData.instancePickingMaterial.dispose();
    this.userData.stixelMaterial.dispose();
    disposeCubeMaterials(this.#cubeMaterials);
    this.#pointsHistory.dispose();
    this.#stixelsHistory.dispose();
    super.dispose();
  }

  public updatePointCloud(
    this: PointCloudHistoryRenderable,
    pointCloud: PointCloud | PointCloud2,
    originalMessage: RosObject | undefined,
    settings: LayerSettingsPointClouds,
    receiveTime: bigint,
  ): void {
    const messageTime = toNanoSec(getTimestamp(pointCloud));
    this.userData.receiveTime = receiveTime;
    this.userData.messageTime = messageTime;
    this.userData.frameId = this.renderer.normalizeFrameId(getFrameId(pointCloud));
    this.userData.latestPointCloud = pointCloud;
    this.userData.latestOriginalMessage = originalMessage;

    const prevSettings = this.userData.settings;
    const prevIsDecay = prevSettings.decayTime > 0;
    this.userData.settings = settings;

    let material = this.userData.material;
    let stixelMaterial = this.userData.stixelMaterial;
    const needsRebuild =
      colorHasTransparency(settings) !== material.transparent ||
      pointCloudColorEncoding(settings) !== pointCloudColorEncoding(prevSettings) ||
      settings.pointShape !== prevSettings.pointShape;

    const pointsHistory = this.#pointsHistory;
    const stixelsHistory = this.#stixelsHistory;
    if (needsRebuild) {
      material.dispose();
      material = pointCloudMaterial(settings);
      this.userData.material = material;
      disposeCubeMaterials(this.#cubeMaterials);
      this.#cubeMaterials = createCubeMaterials(settings);
      pointsHistory.forEach((entry) => {
        entry.renderable.updateMaterial(material);
        this.#applyShape(entry.renderable);
      });

      stixelMaterial.dispose();
      stixelMaterial = createStixelMaterial(settings);
      this.userData.stixelMaterial = stixelMaterial;
      stixelsHistory.forEach((entry) => {
        entry.renderable.updateMaterial(stixelMaterial);
      });
    } else {
      material.size = settings.pointSize;
      this.#cubeMaterials.cubeSize.value = settings.cubeSize;
    }

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

    const latestPointsEntry = pointsHistory.latest();
    latestPointsEntry.receiveTime = receiveTime;
    latestPointsEntry.messageTime = messageTime;
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
      latestPointsEntry.renderable.geometry.setUsage(THREE.DynamicDrawUsage);
      latestStixelEntry.renderable.geometry.setUsage(THREE.DynamicDrawUsage);
    }

    latestStixelEntry.receiveTime = receiveTime;
    latestStixelEntry.messageTime = messageTime;
    latestStixelEntry.renderable.userData.pose = latestPointsEntry.renderable.userData.pose;
    if (settings.stixelsEnabled) {
      latestStixelEntry.renderable.geometry.resize(pointCount * 2);
    } else {
      latestStixelEntry.renderable.geometry.resize(0);
    }
    const stixelPositionAttribute = latestStixelEntry.renderable.geometry.attributes.position!;
    const stixelColorAttribute = latestStixelEntry.renderable.geometry.attributes.color!;
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
    ])!;
    const decoded = latestPoints.decoded;
    if (decoded?.pointCloud === pointCloud && decoded.key === decodeKey) {
      return;
    }
    latestPoints.decoded = { pointCloud, key: decodeKey };

    // Iterate the point cloud data to update position and color attributes
    this.#updatePointCloudBuffers(
      pointCloud,
      tempFieldReaders,
      pointCount,
      settings,
      positionAttribute,
      colorAttribute,
      stixelPositionAttribute,
      stixelColorAttribute,
    );
  }

  public startFrame(currentTime: bigint, renderFrameId: string, fixedFrameId: string): void {
    this.#pointsHistory.updateHistoryFromCurrentTime(currentTime);
    this.#pointsHistory.updatePoses(currentTime, renderFrameId, fixedFrameId);
    this.#pointsHistory.forEach((entry) => {
      entry.renderable.syncCubes();
    });
    if (this.userData.settings.stixelsEnabled) {
      this.#stixelsHistory.updateHistoryFromCurrentTime(currentTime);
      this.#stixelsHistory.updatePoses(currentTime, renderFrameId, fixedFrameId);
    }
  }

  public pushHistory(
    this: PointCloudHistoryRenderable,
    pointCloud: PointCloud | PointCloud2,
    originalMessage: RosObject | undefined,
    settings: LayerSettingsPointClouds,
    receiveTime: bigint,
  ): void {
    const messageTime = toNanoSec(getTimestamp(pointCloud));
    const pointsHistory = this.#pointsHistory;
    const stixelsHistory = this.#stixelsHistory;
    const material = this.userData.material;
    const stixelMaterial = this.userData.stixelMaterial;
    const topic = this.userData.topic;

    // Push a new (empty) entry to the history of points
    const geometry = createGeometry(topic, THREE.StaticDrawUsage);
    const points = new PointCloudRenderable(
      topic,
      {
        receiveTime: -1n, // unused
        messageTime: -1n, // unused
        frameId: "", //unused
        pose: getPose(pointCloud),
        settingsPath: [], //unused
        settings: { visible: true }, //unused
        topic,
        pointCloud,
        originalMessage,
      },
      geometry,
      material,
      this.userData.pickingMaterial,
      this.userData.instancePickingMaterial,
    );
    this.#applyShape(points);
    pointsHistory.addHistoryEntry({ receiveTime, messageTime, renderable: points });
    this.add(points);

    if (settings.stixelsEnabled) {
      const stixelGeometry = createStixelGeometry(topic, THREE.StaticDrawUsage);
      const stixels = new StixelsRenderable(
        topic,
        {
          receiveTime: -1n, // unused
          messageTime: -1n, // unused
          frameId: "", //unused
          pose: getPose(pointCloud),
          settingsPath: [], //unused
          settings: { visible: true }, //unused
          topic,
        },
        stixelGeometry,
        stixelMaterial,
      );
      stixelsHistory.addHistoryEntry({ receiveTime, messageTime, renderable: stixels });
      this.add(stixels);
    }
  }

  #applyShape(points: PointCloudRenderable): void {
    points.setCubeMaterials(
      this.userData.settings.pointShape === "cube" ? this.#cubeMaterials : undefined,
    );
  }

  #invalidError(message: string): void {
    this.renderer.settings.errors.addToTopic(this.userData.topic, INVALID_POINTCLOUD, message);
    const lastEntry = this.#pointsHistory.latest();
    lastEntry.renderable.geometry.resize(0);
    lastEntry.renderable.decoded = undefined;
  }

  #validatePointCloud(pointCloud: PointCloud | PointCloud2): boolean {
    const maybeRos = pointCloud as Partial<PointCloud2>;
    return maybeRos.header
      ? this.#validateRosPointCloud(pointCloud as PointCloud2)
      : this.#validateFoxglovePointCloud(pointCloud as PointCloud);
  }

  #validateFoxglovePointCloud(pointCloud: PointCloud): boolean {
    const data = pointCloud.data;

    if (data.length % pointCloud.point_stride !== 0) {
      const message = `PointCloud data length ${data.length} is not a multiple of point_stride ${pointCloud.point_stride}`;
      this.#invalidError(message);
      return false;
    }

    if (pointCloud.fields.length === 0) {
      const message = `PointCloud has no fields`;
      this.#invalidError(message);
      return false;
    }

    return true;
  }

  #validateRosPointCloud(pointCloud: PointCloud2): boolean {
    const data = pointCloud.data;

    if (pointCloud.is_bigendian) {
      const message = `PointCloud2 is_bigendian=true is not supported`;
      this.#invalidError(message);
      return false;
    }

    if (data.length % pointCloud.point_step !== 0) {
      const message = `PointCloud2 data length ${data.length} is not a multiple of point_step ${pointCloud.point_step}`;
      this.#invalidError(message);
      return false;
    }

    if (pointCloud.fields.length === 0) {
      const message = `PointCloud2 has no fields`;
      this.#invalidError(message);
      return false;
    }

    if (data.length < pointCloud.height * pointCloud.row_step) {
      const message = `PointCloud2 data length ${data.length} is less than height ${pointCloud.height} * row_step ${pointCloud.row_step}`;
      this.renderer.settings.errors.addToTopic(this.userData.topic, INVALID_POINTCLOUD, message);
      // Allow this error for now since we currently ignore row_step
    }

    if (pointCloud.width * pointCloud.point_step > pointCloud.row_step) {
      const message = `PointCloud2 width ${pointCloud.width} * point_step ${pointCloud.point_step} is greater than row_step ${pointCloud.row_step}`;
      this.renderer.settings.errors.addToTopic(this.userData.topic, INVALID_POINTCLOUD, message);
      // Allow this error for now since we currently ignore row_step
    }

    return true;
  }

  #getPointCloudFieldReaders(
    output: PointCloudFieldReaders,
    pointCloud: PointCloud | PointCloud2,
    settings: LayerSettingsPointClouds,
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
      const numericType = (field as Partial<PackedElementField>).type;
      const type =
        numericType != undefined
          ? numericTypeToPointFieldType(numericType)
          : (field as PointField).datatype;

      if (field.offset < 0) {
        const message = `PointCloud field "${field.name}" has invalid offset ${field.offset}. Must be >= 0`;
        this.#invalidError(message);
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
          this.#invalidError(message);
          return false;
        }
      } else if (field.name === "y") {
        yReader = getReader(field, stride);
        if (!yReader) {
          const typeName = pointFieldTypeName(type);
          const message = `PointCloud field "y" is invalid. type=${typeName}, offset=${field.offset}, stride=${stride}`;
          this.#invalidError(message);
          return false;
        }
      } else if (field.name === "z") {
        zReader = getReader(field, stride);
        if (!zReader) {
          const typeName = pointFieldTypeName(type);
          const message = `PointCloud field "z" is invalid. type=${typeName}, offset=${field.offset}, stride=${stride}`;
          this.#invalidError(message);
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
            ? numericType != undefined
              ? NumericType.UINT32
              : PointFieldType.UINT32
            : undefined;
        packedColorReader = getReader(field, stride, /*normalize*/ false, forceType);
        if (!packedColorReader) {
          const typeName = pointFieldTypeName(type);
          const message = `PointCloud field "${field.name}" is invalid. type=${typeName}, offset=${field.offset}, stride=${stride}`;
          this.#invalidError(message);
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
      this.#invalidError(message);
      return false;
    }

    const positionReaderCount = (xReader ? 1 : 0) + (yReader ? 1 : 0) + (zReader ? 1 : 0);
    if (positionReaderCount < 2) {
      const message = `PointCloud must contain at least two of x/y/z fields`;
      this.#invalidError(message);
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
  ): void {
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
      // Read each color value once, tracking the auto min/max in the same pass. Comparisons
      // (unlike Math.min/max) skip NaN, so one invalid point can't turn the whole cloud black.
      const values = colorValueScratch(pointCount);
      let minColorValue = Number.POSITIVE_INFINITY;
      let maxColorValue = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < pointCount; i++) {
        const value = packedColorReader(view, i * pointStep);
        values[i] = value;
        if (value < minColorValue) {
          minColorValue = value;
        }
        if (value > maxColorValue) {
          maxColorValue = value;
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
  }
}

export class PointClouds extends SceneExtension<PointCloudHistoryRenderable> {
  public static extensionId = "foxglove.PointClouds";
  #fieldsByTopic = new Map<string, string[]>();

  public constructor(renderer: IRenderer, name: string = PointClouds.extensionId) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: ROS_POINTCLOUD_DATATYPES,
        subscription: {
          handler: this.#handleRosPointCloud,
          filterQueue: this.#processMessageQueue.bind(this),
        },
      },
      {
        type: "schema",
        schemaNames: FOXGLOVE_POINTCLOUD_DATATYPES,
        subscription: {
          handler: this.#handleFoxglovePointCloud,
          filterQueue: this.#processMessageQueue.bind(this),
        },
      },
    ];
  }

  #processMessageQueue<T>(msgs: MessageEvent<T>[]): MessageEvent<T>[] {
    if (msgs.length === 0) {
      return msgs;
    }
    const msgsByTopic = _.groupBy(msgs, (msg) => msg.topic);
    const finalQueue: MessageEvent<T>[] = [];
    for (const topic in msgsByTopic) {
      const topicMsgs = msgsByTopic[topic]!;
      const userSettings = (this.renderer.config.topics[topic] ??
        {}) as Partial<LayerSettingsPointClouds>;
      // if the topic has a decaytime add all messages to queue for topic
      if ((userSettings.decayTime ?? DEFAULT_SETTINGS.decayTime) > 0) {
        finalQueue.push(...topicMsgs);
        continue;
      }
      const latestMsg = topicMsgs[topicMsgs.length - 1];
      if (latestMsg) {
        finalQueue.push(latestMsg);
      }
    }

    return finalQueue;
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      const isPointCloud = topicIsConvertibleToSchema(topic, ALL_POINTCLOUD_DATATYPES);
      if (!isPointCloud) {
        continue;
      }
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsPointClouds>;
      const messageFields = this.#fieldsByTopic.get(topic.name) ?? POINT_CLOUD_REQUIRED_FIELDS;
      const node: SettingsTreeNodeWithActionHandler = pointSettingsNode(
        topic,
        messageFields,
        config,
      );
      node.fields!.stixelsEnabled = {
        label: "Stixel view",
        input: "boolean",
        value: config.stixelsEnabled ?? DEFAULT_SETTINGS.stixelsEnabled,
      };
      node.handler = handler;
      node.icon = "Points";
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

    for (const [topic, renderable] of this.renderables) {
      if (!renderable.userData.settings.visible) {
        renderable.removeFromParent();
        renderable.dispose();
        this.renderables.delete(topic);
        continue;
      }
      renderable.startFrame(currentTime, renderFrameId, fixedFrameId);
    }
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    this.saveSetting(path, action.payload.value);

    // Update the renderable
    const topicName = path[1]!;
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const prevSettings = this.renderer.config.topics[topicName];
      const settings = { ...DEFAULT_SETTINGS, ...prevSettings };
      renderable.updatePointCloud(
        renderable.userData.latestPointCloud,
        renderable.userData.latestOriginalMessage,
        settings,
        renderable.userData.receiveTime,
      );
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
  ): void {
    // Update the mapping of topic to point cloud field names if necessary
    let fields = this.#fieldsByTopic.get(topic);
    // filter count to compare only supported fields
    const numSupportedFields = pointCloud.fields.reduce((numSupported, field) => {
      return numSupported + (isSupportedField(field) ? 1 : 0);
    }, 0);
    let fieldsForTopicUpdated = false;
    if (fields?.length !== numSupportedFields) {
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

      const material = pointCloudMaterial(settings);
      const pickingMaterial = createPickingMaterial(settings);
      const instancePickingMaterial = createInstancePickingMaterial(settings);
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
        material,
        pickingMaterial,
        instancePickingMaterial,
        stixelMaterial,
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    const { settings } = renderable.userData;

    if (settings.decayTime > 0) {
      renderable.pushHistory(pointCloud, originalMessage, settings, receiveTime);
    }

    renderable.updatePointCloud(pointCloud, originalMessage, settings, receiveTime);
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
  const maybeRos = pointCloud as Partial<PointCloud2>;
  return maybeRos.header ? maybeRos.header.stamp : (pointCloud as PointCloud).timestamp;
}

function getFrameId(pointCloud: PointCloud | PointCloud2): string {
  const maybeRos = pointCloud as Partial<PointCloud2>;
  return maybeRos.header ? maybeRos.header.frame_id : (pointCloud as PointCloud).frame_id;
}

function getStride(pointCloud: PointCloud | PointCloud2): number {
  const maybeRos = pointCloud as Partial<PointCloud2>;
  return maybeRos.point_step ?? (pointCloud as PointCloud).point_stride;
}

function getPose(pointCloud: PointCloud | PointCloud2): Pose {
  const maybeFoxglove = pointCloud as Partial<PointCloud>;
  return maybeFoxglove.pose ?? makePose();
}

export function createStixelMaterial(settings: LayerSettingsPointClouds): THREE.LineBasicMaterial {
  const transparent = colorHasTransparency(settings);
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent,
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

class StixelsRenderable extends Renderable<BaseUserData, /*TRenderer=*/ undefined> {
  #stixels: THREE.LineSegments<DynamicBufferGeometry, THREE.LineBasicMaterial>;
  public readonly geometry: DynamicBufferGeometry;

  public constructor(
    name: string,
    userData: BaseUserData,
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

  public override dispose(): void {
    this.#stixels.geometry.dispose();
  }

  public updateMaterial(material: THREE.LineBasicMaterial) {
    this.#stixels.material = material;
  }
}
