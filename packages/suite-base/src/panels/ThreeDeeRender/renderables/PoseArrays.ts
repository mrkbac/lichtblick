// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import { PosesInFrame } from "@foxglove/schemas";
import * as _ from "lodash-es";
import * as THREE from "three";

import { SettingsTreeAction } from "@lichtblick/suite";
import { AXIS_LENGTH } from "@lichtblick/suite-base/panels/ThreeDeeRender/settings";
import type { RosValue } from "@lichtblick/suite-base/players/types";

import { Axis } from "./Axis";
import { createArrowMarker } from "./Poses";
import type { AnyRendererSubscription } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import type { Renderer } from "../Renderer";
import {
  onlyLastByTopicMessage,
  PartialMessage,
  PartialMessageEvent,
  SceneExtension,
} from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { makeRgba, rgbaGradient, stringToRgba } from "../color";
import { POSES_IN_FRAME_DATATYPES } from "../foxglove";
import { normalizeHeader, normalizePose, normalizeTime } from "../normalizeMessages";
import {
  PoseArray,
  POSE_ARRAY_DATATYPES,
  ColorRGBA,
  NAV_PATH_DATATYPES,
  Marker,
  NavPath,
  MarkerType,
} from "../ros";
import { BaseSettings } from "../settings";
import {
  POSE_ARRAY_DEFAULTS,
  poseArrayDefaultType as getDefaultType,
  poseArraySettingsNode,
} from "../settingsNodes/topics";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose, Pose } from "../transforms";
import { normalizeMarker } from "./Markers";
import { RenderableArrow } from "./markers/RenderableArrow";
import { RenderableLineStrip } from "./markers/RenderableLineStrip";

type Gradient = [string, string];
type DisplayType = "axis" | "arrow" | "line";

export type LayerSettingsPoseArray = BaseSettings & {
  type: DisplayType;
  axisScale: number;
  arrowScale: [number, number, number];
  lineWidth: number;
  gradient: Gradient;
};

const MISMATCHED_FRAME_ID = "MISMATCHED_FRAME_ID";

const COLOR_WHITE = { r: 1, g: 1, b: 1, a: 1 };

const DEFAULT_SETTINGS = POSE_ARRAY_DEFAULTS;

const tempColor1 = makeRgba();
const tempColor2 = makeRgba();
const tempColor3 = makeRgba();

export type PoseArrayUserData = BaseUserData & {
  settings: LayerSettingsPoseArray;
  topic: string;
  poseArrayMessage: PoseArray;
  originalMessage: Record<string, RosValue>;
  axes: Axis[];
  arrows: RenderableArrow[];
  lineStrip?: RenderableLineStrip;
};

export class PoseArrayRenderable extends Renderable<PoseArrayUserData> {
  public override dispose(): void {
    this.userData.axes.forEach((axis) => {
      axis.dispose();
    });
    this.userData.arrows.forEach((arrow) => {
      arrow.dispose();
    });
    this.userData.lineStrip?.dispose();
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    return this.userData.originalMessage;
  }

  public removeArrows(): void {
    for (const arrow of this.userData.arrows) {
      this.remove(arrow);
      arrow.dispose();
    }
    this.userData.arrows.length = 0;
  }

  public removeAxes(): void {
    for (const axis of this.userData.axes) {
      this.remove(axis);
      axis.dispose();
    }
    this.userData.axes.length = 0;
  }

  public removeLineStrip(): void {
    if (this.userData.lineStrip) {
      this.remove(this.userData.lineStrip);
      this.userData.lineStrip.dispose();
      this.userData.lineStrip = undefined;
    }
  }
}

export class PoseArrays extends SceneExtension<PoseArrayRenderable> {
  public static extensionId = "foxglove.PoseArrays";
  public constructor(renderer: Renderer) {
    super(PoseArrays.extensionId, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: POSE_ARRAY_DATATYPES,
        subscription: { handler: this.#handlePoseArray, filterQueue: onlyLastByTopicMessage },
      },
      {
        type: "schema",
        schemaNames: POSES_IN_FRAME_DATATYPES,
        subscription: { handler: this.#handlePosesInFrame, filterQueue: onlyLastByTopicMessage },
      },
      {
        type: "schema",
        schemaNames: NAV_PATH_DATATYPES,
        subscription: { handler: this.#handleNavPath, filterQueue: onlyLastByTopicMessage },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (
        !(
          topicIsConvertibleToSchema(topic, POSE_ARRAY_DATATYPES) ||
          topicIsConvertibleToSchema(topic, NAV_PATH_DATATYPES) ||
          topicIsConvertibleToSchema(topic, POSES_IN_FRAME_DATATYPES)
        )
      ) {
        continue;
      }
      const config = (configTopics[topic.name] ?? {}) as Partial<LayerSettingsPoseArray>;
      entries.push({
        path: ["topics", topic.name],
        node: { ...poseArraySettingsNode(topic, config), handler },
      });
    }
    return entries;
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
      const settings = this.renderer.config.topics[topicName];
      const defaultType = { type: getDefaultType(this.renderer.topicsByName?.get(topicName)) };
      this.#updatePoseArrayRenderable(
        renderable,
        renderable.userData.poseArrayMessage,
        renderable.userData.originalMessage,
        renderable.userData.receiveTime,
        { ...DEFAULT_SETTINGS, ...defaultType, ...settings },
      );
    }
  };

  #handlePoseArray = (messageEvent: PartialMessageEvent<PoseArray>): void => {
    const poseArrayMessage = normalizePoseArray(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    this.#addPoseArray(messageEvent.topic, poseArrayMessage, messageEvent.message, receiveTime);
  };

  #handleNavPath = (messageEvent: PartialMessageEvent<NavPath>): void => {
    if (!validateNavPath(messageEvent, this.renderer)) {
      return;
    }

    const poseArrayMessage = normalizeNavPathToPoseArray(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    this.#addPoseArray(messageEvent.topic, poseArrayMessage, messageEvent.message, receiveTime);
  };

  #handlePosesInFrame = (messageEvent: PartialMessageEvent<PosesInFrame>): void => {
    const poseArrayMessage = normalizePosesInFrameToPoseArray(messageEvent.message);
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    this.#addPoseArray(messageEvent.topic, poseArrayMessage, messageEvent.message, receiveTime);
  };

  #addPoseArray(
    topic: string,
    poseArrayMessage: PoseArray,
    originalMessage: Record<string, RosValue>,
    receiveTime: bigint,
  ): void {
    let renderable = this.renderables.get(topic);
    if (!renderable) {
      // Set the initial settings from default values merged with any user settings
      const userSettings = this.renderer.config.topics[topic];
      const defaultType = { type: getDefaultType(this.renderer.topicsByName?.get(topic)) };
      const settings = { ...DEFAULT_SETTINGS, ...defaultType, ...userSettings };

      renderable = new PoseArrayRenderable(topic, this.renderer, {
        receiveTime,
        messageTime: toNanoSec(poseArrayMessage.header.stamp),
        frameId: this.renderer.normalizeFrameId(poseArrayMessage.header.frame_id),
        pose: makePose(),
        settingsPath: ["topics", topic],
        settings,
        topic,
        poseArrayMessage,
        originalMessage,
        axes: [],
        arrows: [],
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    this.#updatePoseArrayRenderable(
      renderable,
      poseArrayMessage,
      originalMessage,
      receiveTime,
      renderable.userData.settings,
    );
  }

  #createAxesToMatchPoses(
    renderable: PoseArrayRenderable,
    poseArray: PoseArray,
    topic: string,
  ): void {
    const scale = renderable.userData.settings.axisScale * (1 / AXIS_LENGTH);

    // Update the scale and visibility of existing AxisRenderables as needed
    const existingUpdateCount = Math.min(renderable.userData.axes.length, poseArray.poses.length);
    for (let i = 0; i < existingUpdateCount; i++) {
      const axis = renderable.userData.axes[i]!;
      axis.visible = true;
      axis.scale.set(scale, scale, scale);
    }

    // Create any AxisRenderables as needed
    for (let i = renderable.userData.axes.length; i < poseArray.poses.length; i++) {
      const axis = new Axis(topic, this.renderer);
      renderable.userData.axes.push(axis);
      renderable.add(axis);

      // Set the scale for each new axis
      axis.scale.set(scale, scale, scale);
    }

    // Hide any AxisRenderables as needed
    for (let i = poseArray.poses.length; i < renderable.userData.axes.length; i++) {
      const axis = renderable.userData.axes[i]!;
      axis.visible = false;
    }
  }

  #createArrowsToMatchPoses(
    renderable: PoseArrayRenderable,
    poseArray: PoseArray,
    topic: string,
    colorStart: ColorRGBA,
    colorEnd: ColorRGBA,
  ): void {
    // Generate a Marker with the right scale and color
    const createArrowMarkerFromIndex = (i: number): Marker => {
      const color = rgbaGradient(
        tempColor3,
        colorStart,
        colorEnd,
        i / Math.max(1, poseArray.poses.length - 1),
      );
      return createArrowMarker(renderable.userData.settings.arrowScale, color);
    };

    // Update the arrowMarker of existing RenderableArrow as needed
    const existingUpdateCount = Math.min(renderable.userData.arrows.length, poseArray.poses.length);
    for (let i = 0; i < existingUpdateCount; i++) {
      const arrowMarker = createArrowMarkerFromIndex(i);
      const arrow = renderable.userData.arrows[i]!;
      arrow.visible = true;
      arrow.update(arrowMarker, undefined);
    }

    // Create any RenderableArrow as needed
    for (let i = renderable.userData.arrows.length; i < poseArray.poses.length; i++) {
      const arrowMarker = createArrowMarkerFromIndex(i);
      const arrow = new RenderableArrow(topic, arrowMarker, undefined, this.renderer);
      renderable.userData.arrows.push(arrow);
      renderable.add(arrow);
    }

    // Hide any RenderableArrow as needed
    for (let i = poseArray.poses.length; i < renderable.userData.arrows.length; i++) {
      const arrow = renderable.userData.arrows[i]!;
      arrow.visible = false;
    }
  }

  #updatePoseArrayRenderable(
    renderable: PoseArrayRenderable,
    poseArrayMessage: PoseArray,
    originalMessage: Record<string, RosValue>,
    receiveTime: bigint,
    settings: LayerSettingsPoseArray,
  ): void {
    renderable.userData.receiveTime = receiveTime;
    renderable.userData.messageTime = toNanoSec(poseArrayMessage.header.stamp);
    renderable.userData.frameId = this.renderer.normalizeFrameId(poseArrayMessage.header.frame_id);
    renderable.userData.poseArrayMessage = poseArrayMessage;
    renderable.userData.originalMessage = originalMessage;

    const { topic, settings: prevSettings } = renderable.userData;
    const axisOrArrowSettingsChanged =
      settings.type !== prevSettings.type ||
      settings.axisScale !== prevSettings.axisScale ||
      !_.isEqual(settings.arrowScale, prevSettings.arrowScale) ||
      !_.isEqual(settings.gradient, prevSettings.gradient) ||
      (renderable.userData.arrows.length === 0 && renderable.userData.axes.length === 0);

    renderable.userData.settings = settings;

    const colorStart = stringToRgba(tempColor1, settings.gradient[0]);
    const colorEnd = stringToRgba(tempColor2, settings.gradient[1]);

    if (axisOrArrowSettingsChanged) {
      switch (renderable.userData.settings.type) {
        case "axis":
          renderable.removeArrows();
          renderable.removeLineStrip();
          break;
        case "arrow":
          renderable.removeAxes();
          renderable.removeLineStrip();
          break;
        case "line":
          {
            renderable.removeArrows();
            renderable.removeAxes();

            const lineStripMarker = createLineStripMarker(
              poseArrayMessage,
              settings.lineWidth,
              colorStart,
              colorEnd,
            );

            // Create a RenderableLineStrip if needed
            if (!renderable.userData.lineStrip) {
              const lineStrip = new RenderableLineStrip(
                topic,
                lineStripMarker,
                undefined,
                this.renderer,
              );
              renderable.userData.lineStrip = lineStrip;
              renderable.add(lineStrip);
            }

            renderable.userData.lineStrip.update(lineStripMarker, undefined);
          }
          break;
      }
    }

    // Update the pose for each pose renderable
    switch (settings.type) {
      case "axis":
        this.#createAxesToMatchPoses(renderable, poseArrayMessage, topic);
        for (let i = 0; i < poseArrayMessage.poses.length; i++) {
          setObjectPose(renderable.userData.axes[i]!, poseArrayMessage.poses[i]!);
        }
        break;
      case "arrow":
        this.#createArrowsToMatchPoses(renderable, poseArrayMessage, topic, colorStart, colorEnd);
        for (let i = 0; i < poseArrayMessage.poses.length; i++) {
          setObjectPose(renderable.userData.arrows[i]!, poseArrayMessage.poses[i]!);
        }
        break;
      case "line": {
        const lineStripMarker = createLineStripMarker(
          poseArrayMessage,
          settings.lineWidth,
          colorStart,
          colorEnd,
        );
        renderable.userData.lineStrip?.update(lineStripMarker, undefined);
        break;
      }
    }
  }
}

function setObjectPose(object: THREE.Object3D, pose: Pose): void {
  const p = pose.position;
  const q = pose.orientation;
  object.position.set(p.x, p.y, p.z);
  object.quaternion.set(q.x, q.y, q.z, q.w);
  object.updateMatrix();
}

function createLineStripMarker(
  message: PoseArray,
  lineWidth: number,
  colorStart: ColorRGBA,
  colorEnd: ColorRGBA,
): Marker {
  // Create a gradient of colors for the line strip
  const colors: ColorRGBA[] = [];
  for (let i = 0; i < message.poses.length; i++) {
    colors.push(
      rgbaGradient(makeRgba(), colorStart, colorEnd, i / Math.max(1, message.poses.length - 1)),
    );
  }

  return normalizeMarker({
    header: message.header,
    type: MarkerType.LINE_STRIP,
    scale: { x: lineWidth, y: 1, z: 1 },
    color: COLOR_WHITE,
    frame_locked: true,
    points: message.poses.map((pose) => pose.position),
    colors,
  });
}

function normalizePoseArray(poseArray: PartialMessage<PoseArray>): PoseArray {
  return {
    header: normalizeHeader(poseArray.header),
    poses: poseArray.poses?.map((p) => normalizePose(p)) ?? [],
  };
}

function normalizeNavPathToPoseArray(navPath: PartialMessage<NavPath>): PoseArray {
  return {
    header: normalizeHeader(navPath.header),
    poses: navPath.poses?.map((p) => normalizePose(p?.pose)) ?? [],
  };
}

function normalizePosesInFrameToPoseArray(poseArray: PartialMessage<PosesInFrame>): PoseArray {
  return {
    header: { stamp: normalizeTime(poseArray.timestamp), frame_id: poseArray.frame_id ?? "" },
    poses: poseArray.poses?.map(normalizePose) ?? [],
  };
}

function validateNavPath(messageEvent: PartialMessageEvent<NavPath>, renderer: Renderer): boolean {
  const { topic, message: navPath } = messageEvent;
  if (navPath.poses) {
    const baseFrameId = renderer.normalizeFrameId(navPath.header?.frame_id ?? "");
    for (const pose of navPath.poses) {
      const curFrameId = renderer.normalizeFrameId(pose?.header?.frame_id ?? "");
      if (baseFrameId !== curFrameId) {
        renderer.settings.errors.addToTopic(
          topic,
          MISMATCHED_FRAME_ID,
          `Path poses must all have the same frame_id. "${baseFrameId}" != "${curFrameId}"`,
        );
        return false;
      }
    }
  }
  return true;
}
