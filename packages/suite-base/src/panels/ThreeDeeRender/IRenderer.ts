// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { Immutable, MessageEvent, ParameterValue } from "@lichtblick/suite";

import { MeshUpAxis } from "./ModelCache";
import { PickedRenderable } from "./Picker";
import type { Renderer } from "./Renderer";
import { CameraState } from "./camera";
import { LayerSettingsTransform } from "./renderables/FrameAxes";
import { PublishClickType } from "./renderables/PublishClickTool";
import { ColorModeSettings } from "./renderables/colorMode";
import { BaseSettings, CustomLayerSettings } from "./settings";

export type RendererEvents = {
  startFrame: (currentTime: bigint, renderer: Renderer) => void;
  endFrame: (currentTime: bigint, renderer: Renderer) => void;
  cameraMove: (renderer: Renderer) => void;
  renderablesClicked: (
    selections: PickedRenderable[],
    cursorCoords: { x: number; y: number },
    renderer: Renderer,
  ) => void;
  selectedRenderable: (selection: PickedRenderable | undefined, renderer: Renderer) => void;
  renderableHovered: (
    selections: PickedRenderable[],
    cursorCoords: { x: number; y: number },
    renderer: Renderer,
  ) => void;
  hoverMoved: (cursorCoords: { x: number; y: number }, renderer: Renderer) => void;
  parametersChange: (
    parameters: ReadonlyMap<string, ParameterValue> | undefined,
    renderer: Renderer,
  ) => void;
  /** Fired when the structure of the transform tree changes ie: new frame added/removed or frame assigned new parent */
  transformTreeUpdated: (renderer: Renderer) => void;
  settingsTreeChange: (renderer: Renderer) => void;
  configChange: (renderer: Renderer) => void;
  schemaSubscriptionsChanged: (renderer: Renderer) => void;
  topicSubscriptionsChanged: (renderer: Renderer) => void;
  topicsChanged: (renderer: Renderer) => void;
  resetViewChanged: (renderer: Renderer) => void;
  resetAllFramesCursor: (renderer: Renderer) => void;
  hudItemsChanged: (renderer: Renderer) => void;
  clearPreloadBuffer: (renderer: Renderer) => void;
};

export type FollowMode = "follow-pose" | "follow-position" | "follow-none";

export type ImageAnnotationSettings = {
  visible: boolean;
};

/** Arguments that can be passed to the renderer for local testing */
export type TestOptions = {
  /** Override default downloading behavior, used for Storybook */
  onDownloadImage?: (blob: Blob, fileName: string) => void;
  debugPicking?: boolean;
};

/** Settings pertaining to Image mode */
export type ImageModeConfig = Partial<ColorModeSettings> & {
  /** Image topic to display */
  imageTopic?: string;
  /** Topic containing CameraCalibration or CameraInfo */
  calibrationTopic?: string;
  /** Annotation topicName -> settings, analogous to {@link RendererConfig.topics} */
  annotations?: Record<string, Partial<ImageAnnotationSettings> | undefined>;
  synchronize?: boolean;
  /** Rotation */
  rotation?: 0 | 90 | 180 | 270;
  brightness?: number;
  contrast?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  /** Minimum (black) value for single-channel images */
  minValue?: number;
  /** Maximum (white) value for single-channel images */
  maxValue?: number;
};

export type RendererConfig = {
  /** Camera settings for the currently rendering scene */
  cameraState: CameraState;
  /** Coordinate frameId of the rendering frame */
  followTf: string | undefined;
  /** Camera follow mode */
  followMode: FollowMode;
  scene: {
    /** Show rendering metrics in a DOM overlay */
    enableStats?: boolean;
    /** Background color override for the scene, sent to `glClearColor()` */
    backgroundColor?: string;
    /* Scale factor to apply to all labels */
    labelScaleFactor?: number;
    /** Ignore the <up_axis> tag in COLLADA files (matching rviz behavior) */
    ignoreColladaUpAxis?: boolean;
    meshUpAxis?: MeshUpAxis;
    /**
     * Fixed world-space directional light vs camera-attached headlight (RViz-style).
     * Defaults to "fixed".
     */
    mainLightMode?: "fixed" | "headlight";
    /** Intensity of the main directional scene light (default: Math.PI) */
    directionalLightIntensity?: number;
    /** Intensity of the ambient hemisphere light (default: 0.5 * Math.PI) */
    hemisphereLightIntensity?: number;
    transforms?: {
      /** Toggles translation and rotation offset controls for frames */
      editable?: boolean;
      /** Toggles visibility of frame axis labels */
      showLabel?: boolean;
      /** Size of frame axis labels */
      labelSize?: number;
      /** Size of coordinate frame axes */
      axisScale?: number;
      /** Width of the connecting line between child and parent frames */
      lineWidth?: number;
      /** Color of the connecting line between child and parent frames */
      lineColor?: string;
      /** Enable transform preloading */
      enablePreloading?: boolean;
      /** Maximum number of transform messages to keep when preloading (default: 10000) */
      maxPreloadMessages?: number;
    };
    /** Sync camera with other 3d panels */
    syncCamera?: boolean;
    /** Toggles visibility of all topics */
    topicsVisible?: boolean;
  };
  publish: {
    /** The type of message to publish when clicking in the scene */
    type: PublishClickType;
    /** The topic on which to publish poses */
    poseTopic: string;
    /** The topic on which to publish points */
    pointTopic: string;
    /** The topic on which to publish pose estimates */
    poseEstimateTopic: string;
    /** The X standard deviation to publish with poses */
    poseEstimateXDeviation: number;
    /** The Y standard deviation to publish with poses */
    poseEstimateYDeviation: number;
    /** The theta standard deviation to publish with poses */
    poseEstimateThetaDeviation: number;
  };
  /** frameId -> settings */
  transforms: Record<string, Partial<LayerSettingsTransform> | undefined>;
  /** topicName -> settings */
  topics: Record<string, Partial<BaseSettings> | undefined>;
  /** instanceId -> settings */
  layers: Record<string, Partial<CustomLayerSettings> | undefined>;

  /** Settings pertaining to Image mode */
  imageMode: ImageModeConfig;
};

export type RendererSubscription<T = unknown> = {
  /** Preload the full history of topic messages as a best effort */
  preload?: boolean;
  /**
   * By default, topic subscriptions are only created when the topic visibility
   * has been toggled on by the user in the settings sidebar. Override this
   * behavior with a custom shouldSubscribe callback. This callback will be
   * called whenever the list of available topics changes or when any 3D panel
   * settings are changed.
   */
  shouldSubscribe?: (topic: string) => boolean;
  /** Callback that will be fired for each matching incoming message */
  handler: (messageEvent: MessageEvent<T>) => void;
  /** Queue of messages to be handled since last frame. Will be reassigned to new empty array each frame. */
  queue?: MessageEvent<T>[] | undefined;
  /** Optional callback to be called on `queue` to filter. Returns new queue. */
  filterQueue?: (queue: MessageEvent<T>[]) => MessageEvent<T>[];
  /**
   * True when only the latest message per frame is used, so the player may skip decoding the
   * others. Defaults to true when `filterQueue` is `onlyLastByTopicMessage`.
   */
  latestOnly?: () => boolean;
};

export type AnyRendererSubscription = Immutable<
  | {
      type: "schema";
      schemaNames: Set<string>;
      // any is used here to allow storing heterogeneous arrays of subscriptions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscription: RendererSubscription<any>;
    }
  | {
      type: "topic";
      topicName: string;
      // any is used here to allow storing heterogeneous arrays of subscriptions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscription: RendererSubscription<any>;
    }
>;

export class InstancedLineMaterial extends THREE.LineBasicMaterial {
  public constructor(...args: ConstructorParameters<typeof THREE.LineBasicMaterial>) {
    super(...args);
    this.defines ??= {};
    this.defines.USE_INSTANCING = true;
  }
}

export type AddMessageEventOptions = {
  inBatch: boolean;
};
