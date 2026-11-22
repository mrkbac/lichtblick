// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, toNanoSec } from "@foxglove/rostime";
import { LaserScan as FoxgloveLaserScan } from "@foxglove/schemas";
import * as THREE from "three/webgpu";

import { SettingsTreeAction, MessageEvent } from "@lichtblick/suite";
import {
  createGeometry,
  PointsRenderable,
  DECAY_HISTORY_LIMITS,
  DECAY_LIMITED,
  updateDecayNotice,
  pointStyle,
  RenderObjectHistory,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/pointExtensionUtils";
import {
  DEFAULT_POINT_SETTINGS,
  LayerSettingsPointExtension,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/settingsNodes/topics";
import type { RosObject, RosValue } from "@lichtblick/suite-base/players/types";
import { emptyPose } from "@lichtblick/suite-base/util/Pose";

import { getColorConverter } from "./colorMode";
import type { AnyRendererSubscription } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import { PartialMessage, PartialMessageEvent, SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry, SettingsTreeNodeWithActionHandler } from "../SettingsManager";
import { LASERSCAN_DATATYPES as FOXGLOVE_LASERSCAN_DATATYPES } from "../foxglove";
import { normalizeFloat32Array, normalizeTime, normalizePose } from "../normalizeMessages";
import { LASERSCAN_DATATYPES as ROS_LASERSCAN_DATATYPES, LaserScan as RosLaserScan } from "../ros";
import { laserScanSettingsNode } from "../settingsNodes/topics";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { Pose } from "../transforms";
import { DecayPointRing } from "./pointClouds/DecayPointRing";
import { MISSING_TRANSFORM, missingTransformMessage } from "./transforms";

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
  ranges: Float32Array;
  intensities: Float32Array;
};

type LaserScanHistoryUserData = BaseUserData & {
  settings: LayerSettingsLaserScan;
  topic: string;
  latestLaserScan: NormalizedLaserScan;
  latestOriginalMessage: Record<string, RosValue> | undefined;
};

const ALL_LASERSCAN_DATATYPES = new Set<string>([
  ...FOXGLOVE_LASERSCAN_DATATYPES,
  ...ROS_LASERSCAN_DATATYPES,
]);

const INVALID_LASERSCAN = "INVALID_LASERSCAN";

const tempColor = { r: 0, g: 0, b: 0, a: 0 };

type LaserScanUserData = BaseUserData & {
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
  /** Key of the shown decay limit notice, see updateDecayNotice */
  #decayNoticeKey: string | undefined;

  public constructor(topic: string, renderer: Renderer, userData: LaserScanHistoryUserData) {
    super(topic, renderer, userData);

    const geometry = createGeometry(topic, THREE.DynamicDrawUsage);
    const points = new LaserScanRenderable(
      topic,
      {
        receiveTime: -1n, // unused
        messageTime: -1n, // unused
        frameId: "", // the scan's frame, set with each scan for the decay history
        pose: userData.latestLaserScan.pose,
        settingsPath: [], //unused
        settings: { visible: true }, //unused
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
    const { colorField } = settings;
    const { intensities, ranges } = laserScan;

    // Invalid laser scan checks
    if (intensities.length !== 0 && intensities.length !== ranges.length) {
      const message = `LaserScan intensities length (${intensities.length}) does not match ranges length (${ranges.length})`;
      invalidLaserScanError(this.renderer, this, message);
      return;
    }
    if (colorField !== "intensity" && colorField !== "range") {
      const message = `LaserScan color field must be either 'intensity' or 'range', found '${colorField}'`;
      invalidLaserScanError(this.renderer, this, message);
      return;
    }

    const topic = this.userData.topic;
    const pointsHistory = this.#pointsHistory;
    const latestEntry = pointsHistory.latest();
    const latest = latestEntry.renderable;
    const style = pointStyle(settings);
    latest.setStyle(style);
    this.#decayRing?.setStyle(style);

    // With a decay time, the previous scan moves into the ring before it is overwritten. A settings
    // change redraws the same scan, which must not add it to the history
    const previousCount = latest.geometry.drawRange.count;
    if (settings.decayTime > 0 && previousCount > 0 && laserScan !== latest.userData.laserScan) {
      if (!this.#decayRing) {
        this.#decayRing = new DecayPointRing(topic, style, DECAY_HISTORY_LIMITS);
        this.add(this.#decayRing);
      }
      const { position, color } = latest.geometry.attributes;
      this.#decayRing.push(
        {
          receiveTime: latestEntry.receiveTime,
          messageTime: latestEntry.messageTime,
          frameId: latest.userData.frameId,
          pose: latest.userData.pose,
        },
        (position!.array as Float32Array).subarray(0, previousCount * 3),
        (color!.array as Uint8Array).subarray(0, previousCount * 4),
      );
    }

    latestEntry.receiveTime = receiveTime;
    latestEntry.messageTime = messageTime;
    latest.userData.frameId = this.userData.frameId;
    latest.userData.pose = laserScan.pose;
    latest.userData.laserScan = laserScan;
    latest.userData.originalMessage = originalMessage;

    const geometry = latest.geometry;
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
    // A single beam is at the start angle (and would divide 0 by 0)
    const angleIncrement =
      ranges.length > 1 ? (laserScan.end_angle - angleMin) / (ranges.length - 1) : 0;
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

  public invalidateLastEntry() {
    const lastEntry = this.#pointsHistory.latest();
    lastEntry.renderable.geometry.resize(0);
  }

  public startFrame(currentTime: bigint, renderFrameId: string, fixedFrameId: string): void {
    let resolved = this.#pointsHistory.updatePoses(currentTime, renderFrameId, fixedFrameId);
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
    const { settings, settingsPath } = this.userData;
    if (!ring) {
      return true;
    }
    if (settings.decayTime <= 0) {
      ring.removeFromParent();
      ring.dispose();
      this.#decayRing = undefined;
      this.renderer.settings.errors.remove(settingsPath, DECAY_LIMITED);
      return true;
    }
    const windowStart = currentTime - BigInt(Math.round(settings.decayTime * 1e9));
    ring.expire(windowStart);
    const latestPoints = this.#pointsHistory.latest().renderable.geometry.drawRange.count;
    ring.enforceLimits({ maxPoints: DECAY_HISTORY_LIMITS.maxPoints, reservePoints: latestPoints });
    this.#decayNoticeKey = updateDecayNotice({
      renderer: this.renderer,
      settingsPath,
      ring,
      maxPoints: DECAY_HISTORY_LIMITS.maxPoints,
      latestPoints,
      windowStart,
      shownKey: this.#decayNoticeKey,
    });
    const missingFrame = ring.updatePoses(
      this.renderer.transformTree,
      currentTime,
      renderFrameId,
      fixedFrameId,
    );
    if (ring.posesPending()) {
      // Paused redraws stop on their own: draw again until every scan is placed
      this.renderer.queueAnimationFrame();
    }
    if (missingFrame != undefined) {
      this.renderer.settings.errors.add(
        settingsPath,
        MISSING_TRANSFORM,
        missingTransformMessage(renderFrameId, fixedFrameId, missingFrame),
      );
      return false;
    }
    return true;
  }
}

export class LaserScans extends SceneExtension<LaserScanHistoryRenderable> {
  public static extensionId = "foxglove.LaserScans";
  public constructor(renderer: Renderer, name: string = LaserScans.extensionId) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: ROS_LASERSCAN_DATATYPES,
        subscription: {
          handler: this.#handleLaserScan,
          filterQueue: this.#processMessageQueue.bind(this),
        },
      },
      {
        type: "schema",
        schemaNames: FOXGLOVE_LASERSCAN_DATATYPES,
        subscription: {
          handler: this.#handleLaserScan,
          filterQueue: this.#processMessageQueue.bind(this),
        },
      },
    ];
  }

  #processMessageQueue<T>(msgs: MessageEvent<T>[]): MessageEvent<T>[] {
    if (msgs.length === 0) {
      return msgs;
    }
    const msgsByTopic = Map.groupBy(msgs, (msg) => msg.topic);
    const finalQueue: MessageEvent<T>[] = [];
    for (const [topic, topicMsgs] of msgsByTopic) {
      const userSettings = (this.renderer.config.topics[topic] ??
        {}) as Partial<LayerSettingsLaserScan>;
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

      renderable.updateLaserScan(
        renderable.userData.latestLaserScan,
        renderable.userData.latestOriginalMessage,
        settings,
        renderable.userData.receiveTime,
      );
    }
  };

  #handleLaserScan = (
    messageEvent: PartialMessageEvent<RosLaserScan | FoxgloveLaserScan>,
  ): void => {
    const topic = messageEvent.topic;
    const laserScan =
      "header" in messageEvent.message
        ? normalizeRosLaserScan(messageEvent.message)
        : normalizeFoxgloveLaserScan(messageEvent.message as PartialMessage<FoxgloveLaserScan>);
    const receiveTime = toNanoSec(messageEvent.receiveTime);

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
        receiveTime,
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

    renderable.updateLaserScan(
      laserScan,
      messageEvent.message as RosObject,
      renderable.userData.settings,
      receiveTime,
    );
  };
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
    ranges: normalizeFloat32Array(message.ranges),
    intensities: normalizeFloat32Array(message.intensities),
  };
}
