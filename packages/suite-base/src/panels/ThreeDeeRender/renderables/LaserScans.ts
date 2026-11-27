// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, toNanoSec } from "@foxglove/rostime";
import { LaserScan as FoxgloveLaserScan } from "@foxglove/schemas";
import * as THREE from "three/webgpu";

import { SettingsTreeAction } from "@lichtblick/suite";
import {
  createGeometry,
  PointsRenderable,
  DECAY_HISTORY_LIMITS,
  DECAY_LIMITED,
  keepDecayingTopics,
  pointDecayTime,
  updateDecayRing,
  isSameRecord,
  pointStyle,
  RenderObjectHistory,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/pointExtensionUtils";
import {
  DEFAULT_POINT_SETTINGS,
  LayerSettingsPointExtension,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import type { MessageEvent, RosObject, RosValue } from "@lichtblick/suite-base/players/types";
import { emptyPose } from "@lichtblick/suite-base/util/Pose";

import { getColorConverter } from "./colorMode";
import type { DynamicBufferGeometry } from "../DynamicBufferGeometry";
import type { AnyRendererSubscription } from "../IRenderer";
import { BaseUserData, ChildUserData, Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import { PartialMessage, PartialMessageEvent, SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry, SettingsTreeNodeWithActionHandler } from "../SettingsManager";
import { LASERSCAN_DATATYPES as FOXGLOVE_LASERSCAN_DATATYPES } from "../foxglove";
import { normalizeFloat32Array, normalizeTime, normalizePose } from "../normalizeMessages";
import { LASERSCAN_DATATYPES as ROS_LASERSCAN_DATATYPES, LaserScan as RosLaserScan } from "../ros";
import { laserScanSettingsNode } from "../settingsNodes/topics";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { Pose } from "../transforms";
import { DecayPointRing, type RingStyle } from "./pointClouds/DecayPointRing";
import { MISSING_TRANSFORM } from "./transforms";

type LayerSettingsLaserScan = LayerSettingsPointExtension;
const DEFAULT_SETTINGS = DEFAULT_POINT_SETTINGS;

type NormalizedLaserScan = {
  timestamp: Time;
  frame_id: string;
  pose: Pose;
  start_angle: number;
  end_angle: number;
  range_min: number;
  range_max: number;
  /** ROS scans give the beam spacing; others spread the beams evenly from start to end */
  angle_increment?: number;
  ranges: Float32Array;
  intensities: Float32Array;
};

type LaserScanHistoryUserData = BaseUserData & {
  settings: LayerSettingsLaserScan;
  topic: string;
  latestLaserScan: NormalizedLaserScan;
  historyOnly?: boolean;
  recordId?: string;
  latestOriginalMessage: Record<string, RosValue> | undefined;
};

const ALL_LASERSCAN_DATATYPES = new Set<string>([
  ...FOXGLOVE_LASERSCAN_DATATYPES,
  ...ROS_LASERSCAN_DATATYPES,
]);

const EMPTY_RANGES = new Float32Array(0);
const INVALID_LASERSCAN = "INVALID_LASERSCAN";

const tempColor = { r: 0, g: 0, b: 0, a: 0 };

type LaserScanUserData = ChildUserData & {
  /** The scan's frame, set with each scan for the decay history */
  frameId: string;
  /** Undefined once a newer decay entry exists (see releaseMessage) */
  laserScan: NormalizedLaserScan | undefined;
  originalMessage: Record<string, RosValue> | undefined;
};

class LaserScanRenderable extends PointsRenderable<LaserScanUserData> {
  public override details(): Record<string, RosValue> {
    return this.userData.originalMessage ?? {};
  }

  public releaseMessage(): void {
    this.userData.laserScan = undefined;
    this.userData.originalMessage = undefined;
  }

  public override instanceDetails(instanceId: number): Record<string, RosValue> | undefined {
    const laserScan = this.userData.laserScan;
    if (!laserScan) {
      return undefined;
    }
    const range =
      instanceId >= 0 && instanceId < laserScan.ranges.length
        ? laserScan.ranges[instanceId]
        : undefined;
    const intensity =
      instanceId >= 0 && instanceId < laserScan.intensities.length
        ? laserScan.intensities[instanceId]
        : undefined;
    return { range, intensity };
  }
}

class LaserScanHistoryRenderable extends Renderable<LaserScanHistoryUserData> {
  public override pickable = false; // Picking happens on child renderables
  #pointsHistory: RenderObjectHistory<LaserScanRenderable>;
  /** With a decay time, scans older than the latest accumulate here */
  #decayRing: DecayPointRing | undefined;
  /** Decodes scans older than the latest before they are copied into the ring */
  #scratch: DynamicBufferGeometry | undefined;

  public constructor(topic: string, renderer: Renderer, userData: LaserScanHistoryUserData) {
    super(topic, renderer, userData);

    const geometry = createGeometry(topic, THREE.DynamicDrawUsage);
    geometry.resize(0);
    const points = new LaserScanRenderable(
      topic,
      {
        frameId: "",
        pose: userData.latestLaserScan.pose,
        topic,
        laserScan: userData.latestLaserScan,
        originalMessage: userData.latestOriginalMessage,
      },
      geometry,
    );

    this.#pointsHistory = new RenderObjectHistory({
      initial: {
        messageTime: userData.receiveTime,
        receiveTime: userData.receiveTime,
        renderable: points,
      },
      parentRenderable: this,
      renderer,
      limits: DECAY_HISTORY_LIMITS,
    });
    this.add(points);
  }
  public override dispose(): void {
    this.userData.latestOriginalMessage = undefined;
    this.#pointsHistory.dispose();
    this.#decayRing?.dispose();
    this.#scratch?.dispose();
    this.renderer.settings.errors.remove(this.userData.settingsPath, DECAY_LIMITED);
    super.dispose();
  }

  public updateLaserScan(
    laserScan: NormalizedLaserScan,
    originalMessage: RosObject | undefined,
    settings: LayerSettingsLaserScan,
    receiveTime: bigint,
  ): void {
    const messageTime = toNanoSec(laserScan.timestamp);
    this.userData.receiveTime = receiveTime;
    this.userData.messageTime = messageTime;
    this.userData.frameId = this.renderer.normalizeFrameId(laserScan.frame_id);
    this.userData.latestLaserScan = laserScan;
    this.userData.latestOriginalMessage = originalMessage;

    this.userData.settings = settings;
    const invalid = laserScanError(laserScan, settings);
    if (invalid != undefined) {
      invalidLaserScanError(this.renderer, this, invalid);
      return;
    }
    this.renderer.settings.errors.removeFromTopic(this.userData.topic, INVALID_LASERSCAN);

    const pointsHistory = this.#pointsHistory;
    const latestEntry = pointsHistory.latest();
    const latest = latestEntry.renderable;
    const style = pointStyle(settings);
    latest.setStyle(style);
    this.#decayRing?.setStyle(style);

    // With a decay time, the previous scan moves into the ring before it is overwritten. A settings
    // change redraws the same scan, which must not add it to the history
    const previousCount = latest.geometry.drawRange.count;
    // (the same message read back after a seek and played counts as the same scan)
    const sameScan =
      laserScan === latest.userData.laserScan ||
      isSameRecord(
        { recordId: this.userData.recordId, receiveTime, messageTime, payload: laserScan.ranges },
        { ...latestEntry, payload: latest.userData.laserScan?.ranges ?? EMPTY_RANGES },
      );
    if (settings.decayTime > 0 && previousCount > 0 && !sameScan) {
      const { position, color } = latest.geometry.attributes;
      this.#ring(style).push(
        {
          receiveTime: latestEntry.receiveTime,
          messageTime: latestEntry.messageTime,
          recordId: latestEntry.recordId,
          frameId: latest.userData.frameId,
          pose: latest.userData.pose,
        },
        (position!.array as Float32Array).subarray(0, previousCount * 3),
        (color!.array as Uint8Array).subarray(0, previousCount * 4),
      );
    }

    if (this.userData.recordId != undefined) {
      this.#decayRing?.removeRecord(this.userData.recordId);
    }
    latestEntry.receiveTime = receiveTime;
    latestEntry.messageTime = messageTime;
    latestEntry.recordId = this.userData.recordId;
    latest.userData.frameId = this.userData.frameId;
    latest.userData.pose = laserScan.pose;
    latest.userData.laserScan = laserScan;
    latest.userData.originalMessage = originalMessage;

    decodeLaserScan(laserScan, settings, latest.geometry);
  }

  /**
   * Decodes a scan older than the latest one (e.g. read back after a seek) straight into the decay
   * ring, leaving the latest scan as it is
   */
  public addOlderScan(
    laserScan: NormalizedLaserScan,
    settings: LayerSettingsLaserScan,
    receiveTime: bigint,
    recordId?: string,
  ): void {
    if (recordId != undefined && this.#decayRing?.holdsRecord(recordId) === true) {
      return;
    }
    // (a scan the ring already holds, e.g. played and then read back, is skipped by its push)
    if (laserScanError(laserScan, settings) != undefined) {
      return;
    }
    this.#scratch ??= createGeometry(`${this.userData.topic}:older`, THREE.StaticDrawUsage);
    decodeLaserScan(laserScan, settings, this.#scratch);
    const { position, color } = this.#scratch.attributes;
    const count = laserScan.ranges.length;
    this.#ring(pointStyle(settings)).push(
      {
        receiveTime,
        messageTime: toNanoSec(laserScan.timestamp),
        recordId,
        frameId: this.renderer.normalizeFrameId(laserScan.frame_id),
        pose: laserScan.pose,
      },
      (position!.array as Float32Array).subarray(0, count * 3),
      (color!.array as Uint8Array).subarray(0, count * 4),
    );
  }

  #ring(style: RingStyle): DecayPointRing {
    if (!this.#decayRing) {
      this.#decayRing = new DecayPointRing(this.userData.topic, style, DECAY_HISTORY_LIMITS);
      this.add(this.#decayRing);
    }
    return this.#decayRing;
  }

  public invalidateLastEntry() {
    const lastEntry = this.#pointsHistory.latest();
    lastEntry.renderable.geometry.resize(0);
  }

  public startFrame(currentTime: bigint, renderFrameId: string, fixedFrameId: string): void {
    let resolved = this.#pointsHistory.updatePoses(currentTime, renderFrameId, fixedFrameId, {
      skipLatest: this.userData.historyOnly,
    });
    this.#pointsHistory.forEach((entry) => {
      entry.renderable.syncPoints();
    });
    resolved = this.#updateDecayRing(currentTime, renderFrameId, fixedFrameId) && resolved;
    if (resolved) {
      this.renderer.settings.errors.remove(this.userData.settingsPath, MISSING_TRANSFORM);
    }
  }

  /** Expires, budgets and poses the decay ring; returns whether all its scans resolved */
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
      DECAY_HISTORY_LIMITS.maxPoints,
      this.#pointsHistory.latest().renderable.geometry.drawRange.count,
      currentTime,
      renderFrameId,
      fixedFrameId,
    );
  }
}

export class LaserScans extends SceneExtension<LaserScanHistoryRenderable> {
  public static extensionId = "foxglove.LaserScans";
  public constructor(renderer: Renderer) {
    super(LaserScans.extensionId, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: ROS_LASERSCAN_DATATYPES,
        subscription: {
          handler: this.#handleLaserScan,
          filterQueue: (msgs) => keepDecayingTopics(this.renderer, msgs),
        },
      },
      {
        type: "schema",
        schemaNames: FOXGLOVE_LASERSCAN_DATATYPES,
        subscription: {
          handler: this.#handleLaserScan,
          filterQueue: (msgs) => keepDecayingTopics(this.renderer, msgs),
        },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      const isLaserScan = topicIsConvertibleToSchema(topic, ALL_LASERSCAN_DATATYPES);
      if (!isLaserScan) {
        continue;
      }
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsLaserScan>;
      const node: SettingsTreeNodeWithActionHandler = {
        ...laserScanSettingsNode(topic, config),
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

      if (renderable.userData.historyOnly === true) {
        renderable.userData.settings = settings;
      } else {
        renderable.updateLaserScan(
          renderable.userData.latestLaserScan,
          renderable.userData.latestOriginalMessage,
          settings,
          renderable.userData.receiveTime,
        );
      }
    }
  };

  #handleLaserScan = (
    messageEvent: PartialMessageEvent<RosLaserScan | FoxgloveLaserScan>,
  ): void => {
    const laserScan =
      "header" in messageEvent.message
        ? normalizeRosLaserScan(messageEvent.message)
        : normalizeFoxgloveLaserScan(messageEvent.message as PartialMessage<FoxgloveLaserScan>);
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    const renderable = this.#getOrCreateRenderable(messageEvent, laserScan);
    renderable.userData.historyOnly = undefined;
    renderable.userData.recordId = messageEvent.recordId;
    renderable.updateLaserScan(
      laserScan,
      messageEvent.message as RosObject,
      renderable.userData.settings,
      receiveTime,
    );
  };

  #getOrCreateRenderable(
    messageEvent: MessageEvent,
    laserScan: NormalizedLaserScan,
  ): LaserScanHistoryRenderable {
    const { topic, receiveTime } = messageEvent;
    let renderable = this.renderables.get(topic);
    if (!renderable) {
      // Set the initial settings from default values merged with any user settings
      const userSettings = (this.renderer.config.topics[topic] ??
        {}) as Partial<LayerSettingsLaserScan>;
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };
      if (settings.colorField == undefined) {
        settings.colorField = "intensity";
        settings.colorMode = "colormap";
        settings.colorMap = "turbo";

        // Update user settings with the newly selected color field
        this.renderer.updateConfig((draft) => {
          const updatedUserSettings = { ...userSettings };
          updatedUserSettings.colorField = settings.colorField;
          updatedUserSettings.colorMode = settings.colorMode;
          updatedUserSettings.colorMap = settings.colorMap;
          draft.topics[topic] = updatedUserSettings;
        });
      }

      const messageTime = toNanoSec(laserScan.timestamp);
      renderable = new LaserScanHistoryRenderable(topic, this.renderer, {
        receiveTime: toNanoSec(receiveTime),
        messageTime,
        frameId: this.renderer.normalizeFrameId(laserScan.frame_id),
        pose: laserScan.pose,
        settingsPath: ["topics", topic],
        settings,
        topic,
        latestLaserScan: laserScan,
        latestOriginalMessage: messageEvent.message as RosObject,
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    return renderable;
  }

  public readonly historySchemas: ReadonlySet<string> = new Set([
    ...ROS_LASERSCAN_DATATYPES,
    ...FOXGLOVE_LASERSCAN_DATATYPES,
  ]);

  /** See {@link DecayHistoryIngest} */
  public addHistoricalMessage(messageEvent: MessageEvent): bigint | undefined {
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
    const message = messageEvent.message as PartialMessage<RosLaserScan | FoxgloveLaserScan>;
    const laserScan =
      "header" in message
        ? normalizeRosLaserScan(message)
        : normalizeFoxgloveLaserScan(message as PartialMessage<FoxgloveLaserScan>);
    if (!renderable) {
      renderable = this.#getOrCreateRenderable(messageEvent, laserScan);
      renderable.userData.historyOnly = true;
    }
    const { settings, historyOnly } = renderable.userData;
    const sameAsDrawn =
      historyOnly !== true &&
      isSameRecord(
        {
          recordId,
          receiveTime,
          messageTime: toNanoSec(laserScan.timestamp),
          payload: laserScan.ranges,
        },
        { ...renderable.userData, payload: renderable.userData.latestLaserScan.ranges },
      );
    if (settings.decayTime <= 0 || sameAsDrawn) {
      return undefined;
    }
    renderable.addOlderScan(laserScan, settings, receiveTime, recordId);
    return toNanoSec(laserScan.timestamp);
  }
}

/** Why a scan can't be drawn with these settings, or undefined if it can */
function laserScanError(
  laserScan: NormalizedLaserScan,
  settings: LayerSettingsLaserScan,
): string | undefined {
  const { intensities, ranges } = laserScan;
  if (intensities.length !== 0 && intensities.length !== ranges.length) {
    return `LaserScan intensities length (${intensities.length}) does not match ranges length (${ranges.length})`;
  }
  const { colorField } = settings;
  if (colorField !== "intensity" && colorField !== "range") {
    return `LaserScan color field must be either 'intensity' or 'range', found '${colorField}'`;
  }
  return undefined;
}

/** Writes a scan's points and colors into `geometry` */
function decodeLaserScan(
  laserScan: NormalizedLaserScan,
  settings: LayerSettingsLaserScan,
  geometry: DynamicBufferGeometry,
): void {
  const { colorField } = settings;
  const { intensities, ranges } = laserScan;
  geometry.resize(ranges.length);
  const positions = geometry.attributes.position!.array as Float32Array;
  const colorAttribute = geometry.attributes.color!;

  // Determine min/max color values (if needed)
  let minColorValue = settings.minValue ?? Number.POSITIVE_INFINITY;
  let maxColorValue = settings.maxValue ?? Number.NEGATIVE_INFINITY;
  if (settings.minValue == undefined || settings.maxValue == undefined) {
    for (let i = 0; i < ranges.length; i++) {
      const colorValue = colorField === "range" ? ranges[i] : intensities[i];
      if (Number.isFinite(colorValue)) {
        minColorValue = Math.min(minColorValue, colorValue!);
        maxColorValue = Math.max(maxColorValue, colorValue!);
      }
    }
    minColorValue = settings.minValue ?? minColorValue;
    maxColorValue = settings.maxValue ?? maxColorValue;
  }

  // Build a method to convert raw color field values to RGBA
  const colorConverter =
    settings.colorMode === "rgba-fields"
      ? () => NaN // should never happen: rgba-fields is not supported for LaserScans
      : getColorConverter(
          settings as typeof settings & { colorMode: typeof settings.colorMode },
          minColorValue,
          maxColorValue,
        );

  // Ranges to points in the scan plane; out-of-range returns are NaN, which is never drawn
  const { start_angle: angleMin, range_min: rangeMin, range_max: rangeMax } = laserScan;
  // The beam spacing a ROS scan states: its beam count need not fit (angle_max - angle_min)
  // exactly, e.g. when it is rounded up. A single beam is at the start angle (and would divide
  // 0 by 0).
  const angleIncrement =
    laserScan.angle_increment != undefined &&
    Number.isFinite(laserScan.angle_increment) &&
    laserScan.angle_increment !== 0
      ? laserScan.angle_increment
      : ranges.length > 1
        ? (laserScan.end_angle - angleMin) / (ranges.length - 1)
        : 0;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    const inRange = range >= rangeMin && range <= rangeMax;
    const angle = angleMin + angleIncrement * i;
    positions[i * 3] = inRange ? range * Math.cos(angle) : NaN;
    positions[i * 3 + 1] = inRange ? range * Math.sin(angle) : NaN;
    positions[i * 3 + 2] = 0;
    const colorValue = colorField === "range" ? range : (intensities[i] ?? 0);
    colorConverter(tempColor, colorValue);
    colorAttribute.setXYZW(i, tempColor.r, tempColor.g, tempColor.b, tempColor.a);
  }

  geometry.attributes.position!.needsUpdate = true;
  colorAttribute.needsUpdate = true;
}

function invalidLaserScanError(
  renderer: Renderer,
  renderable: LaserScanHistoryRenderable,
  message: string,
): void {
  renderer.settings.errors.addToTopic(renderable.userData.topic, INVALID_LASERSCAN, message);
  renderable.invalidateLastEntry();
}

function normalizeFoxgloveLaserScan(
  message: PartialMessage<FoxgloveLaserScan>,
): NormalizedLaserScan {
  return {
    timestamp: normalizeTime(message.timestamp),
    frame_id: message.frame_id ?? "",
    pose: normalizePose(message.pose),
    start_angle: message.start_angle ?? 0,
    end_angle: message.end_angle ?? 0,
    range_min: -Infinity,
    range_max: Infinity,
    ranges: normalizeFloat32Array(message.ranges),
    intensities: normalizeFloat32Array(message.intensities),
  };
}

function normalizeRosLaserScan(message: PartialMessage<RosLaserScan>): NormalizedLaserScan {
  return {
    timestamp: normalizeTime(message.header?.stamp),
    frame_id: message.header?.frame_id ?? "",
    pose: emptyPose(),
    start_angle: message.angle_min ?? 0,
    end_angle: message.angle_max ?? 0,
    range_min: message.range_min ?? -Infinity,
    range_max: message.range_max ?? Infinity,
    angle_increment: message.angle_increment,
    ranges: normalizeFloat32Array(message.ranges),
    intensities: normalizeFloat32Array(message.intensities),
  };
}
