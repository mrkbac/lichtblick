// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import type {
  JointState as FoxgloveJointState,
  JointStates as FoxgloveJointStates,
} from "@foxglove/schemas";
import { vec3 } from "gl-matrix";
import i18next from "i18next";
import * as _ from "lodash-es";
import * as THREE from "three";

import { filterMap } from "@lichtblick/den/collection";
import {
  UrdfGeometryMesh,
  UrdfRobot,
  UrdfVisual,
  parseRobot,
  UrdfJoint,
} from "@lichtblick/den/urdf";
import Logger from "@lichtblick/log";
import { SettingsTreeAction } from "@lichtblick/suite";
import { makeRgba, stringToRgba } from "@lichtblick/suite-base/panels/ThreeDeeRender/color";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";
import { eulerToQuaternion } from "@lichtblick/suite-base/util/geometry";
import { isValidUrl } from "@lichtblick/suite-base/util/isValidURL";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";
import { toError } from "@lichtblick/suite-base/util/toError";

import { BaseUserData, Renderable } from "../Renderable";
import { Axis } from "./Axis";
import { RenderableCube } from "./markers/RenderableCube";
import { RenderableCylinder } from "./markers/RenderableCylinder";
import { RenderableMarker } from "./markers/RenderableMarker";
import { MESH_FETCH_FAILED, RenderableMeshResource } from "./markers/RenderableMeshResource";
import { RenderableSphere } from "./markers/RenderableSphere";
import { missingTransformMessage, MISSING_TRANSFORM } from "./transforms";
import { forwardKinematics, LinkPose } from "./urdfKinematics";
import type { AnyRendererSubscription } from "../IRenderer";
import type { Renderer } from "../Renderer";
import {
  PartialMessage,
  PartialMessageEvent,
  SceneExtension,
  onlyLastByTopicMessage,
} from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { JOINT_STATES_DATATYPES } from "../foxglove";
import {
  ColorRGBA,
  JointState,
  JOINTSTATE_DATATYPES,
  Marker,
  MarkerAction,
  MarkerType,
  Quaternion,
  Vector3,
  URDF_TOPIC_SCHEMAS,
} from "../ros";
import { BaseSettings, CustomLayerSettings } from "../settings";
import {
  CUSTOM_URDF_DEFAULTS,
  customUrdfSettingsNode,
  resolveJointStatesTopic,
  URDF_DEFAULTS,
  URDF_LAYER_ID,
  UrdfLinkSettings,
  urdfJointNode,
  urdfJointsNodes,
  urdfLinkNode,
  urdfLinksNodes,
  urdfSettingsNode,
} from "../settingsNodes/layers";
import { CoordinateFrame, Pose, makePose, TransformTree } from "../transforms";

const log = Logger.getLogger(__filename);

const LAYER_ID = URDF_LAYER_ID;
const TOPIC_NAME = "/robot_description";

/** ID of fake "topic" used to represent the /robot_description parameter */
const PARAM_KEY = "param:/robot_description";
/** Standard parameter name used for URDF data in ROS */
const PARAM_NAME = "/robot_description";
const PARAM_DISPLAY_NAME = "/robot_description (parameter)";

const VALID_SRC_ERR = "ValidSrc";
const FETCH_URDF_ERR = "FetchUrdf";
const PARSE_URDF_ERR = "ParseUrdf";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const DEFAULT_COLOR_STR = "#ffffff";
const DEFAULT_COLOR = stringToRgba(makeRgba(), DEFAULT_COLOR_STR);
const VEC3_ONE = { x: 1, y: 1, z: 1 };

/** Options every robot description has, wherever it comes from. Optional for older layouts. */
type UrdfRobotOptions = {
  /** Where link poses come from: the transform tree, or forward kinematics from joint states */
  controlMode?: "transforms" | "jointStates";
  /** Joint states topic for `controlMode: "jointStates"`; empty picks the first one */
  jointStatesTopic?: string;
  /** 0-1, multiplies every link's alpha */
  opacity?: number;
  showOutlines?: boolean;
  /** Draws each link's coordinate axes */
  showAxis?: boolean;
  axisScale?: number;
  /** Per-link overrides, keyed by link name without the frame prefix */
  links?: Record<string, UrdfLinkSettings>;
};

export type LayerSettingsUrdf = BaseSettings &
  UrdfRobotOptions & {
    instanceId: string; // This will be set to the topic name
    displayMode: "auto" | "visual" | "collision";
    label: string;
    fallbackColor?: string;
  };

export type LayerSettingsCustomUrdf = CustomLayerSettings &
  UrdfRobotOptions & {
    layerId: "foxglove.Urdf";
    sourceType: "url" | "filePath" | "param" | "topic";
    url?: string;
    filePath?: string;
    parameter?: string;
    topic?: string;
    framePrefix: string;
    displayMode: "auto" | "visual" | "collision";
    fallbackColor?: string;
  };

const DEFAULT_SETTINGS = URDF_DEFAULTS;

/** Settings applied to the loaded robot in place, without reloading it */
const APPEARANCE_FIELDS = new Set([
  "opacity",
  "showOutlines",
  "showAxis",
  "axisScale",
  "controlMode",
  "jointStatesTopic",
]);

const DEFAULT_CUSTOM_SETTINGS = CUSTOM_URDF_DEFAULTS;

/** ROS `sensor_msgs/JointState`, `foxglove.JointStates`, and `foxglove.JointState` (one joint). */
const ALL_JOINT_STATE_DATATYPES = new Set([...JOINTSTATE_DATATYPES, ...JOINT_STATES_DATATYPES]);

/** Any joint state message: ROS (parallel arrays), `foxglove.JointStates` or `foxglove.JointState`. */
type AnyJointState = Omit<PartialMessage<JointState>, "name" | "position"> &
  PartialMessage<FoxgloveJointStates> & { name?: unknown; position?: unknown };

/** Joint names and positions from any joint state message, as parallel arrays. */
export function jointPositions(msg: AnyJointState): {
  names: readonly (string | undefined)[];
  positions: readonly (number | undefined)[];
} {
  if (msg.joints != undefined) {
    return {
      names: msg.joints.map((joint) => joint?.name),
      positions: msg.joints.map((joint) => joint?.position),
    };
  }
  if (typeof msg.name === "string") {
    // foxglove.JointState: a single joint
    const joint = msg as PartialMessage<FoxgloveJointState>;
    return { names: [joint.name], positions: [joint.position] };
  }
  return {
    names: Array.isArray(msg.name) ? (msg.name as (string | undefined)[]) : [],
    positions: Array.isArray(msg.position) ? (msg.position as (number | undefined)[]) : [],
  };
}

const tempVec3a = new THREE.Vector3();
const tempVec3b = new THREE.Vector3();
const tempQuaternion1 = new THREE.Quaternion();
const tempQuaternion2 = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const tempMatrix = new THREE.Matrix4();
const tempMatrix2 = new THREE.Matrix4();
const tempPose = makePose();
const tempOutPose = makePose();

/** Something drawn in a link's frame: one of its visuals/colliders, or its axis. */
type UrdfPart = {
  object: THREE.Object3D;
  /** Link frame */
  frameId: string;
  /** Key into `links` settings: the link name without the frame prefix */
  linkKey: string;
  /** Pose in the link frame */
  pose: Pose;
  /** Marker as loaded, before opacity is applied */
  baseMarker?: Marker;
};

type UrdfLink = { frameId: string; linkKey: string };

export type UrdfUserData = BaseUserData & {
  settings: LayerSettingsUrdf | LayerSettingsCustomUrdf;
  fetching?: { url: string; control: AbortController };
  referenceUrl?: string;
  loadGeneration: number;
  urdf: string | undefined;
  sourceType: LayerSettingsCustomUrdf["sourceType"] | undefined;
  parameter: string | undefined;
  renderables: Map<string, Renderable>;
  /** Visuals/colliders and axes of every link, posed in `startFrame` */
  parts: UrdfPart[];
  axes: UrdfPart[];
  links: UrdfLink[];
  joints: UrdfJoint[];
  jointsByName: Map<string, UrdfJoint>;
  /** Reused forward kinematics output */
  linkPoses: Map<string, LinkPose>;
};

enum EmbeddedMaterialUsage {
  Use,
  Ignore,
}

type TransformData = {
  parent: string;
  child: string;
  translation: Vector3;
  rotation: Quaternion;
  joint: UrdfJoint;
};

type ParsedUrdf = {
  robot: UrdfRobot;
  frames: string[];
  transforms: TransformData[];
};

type JointPosition = {
  timestamp: bigint;
  position: number;
};

export class UrdfRenderable extends Renderable<UrdfUserData> {
  public override dispose(): void {
    this.userData.fetching?.control.abort();
    this.removeChildren();
    this.userData.urdf = undefined;
    super.dispose();
  }

  public removeChildren(): void {
    for (const childRenderable of this.userData.renderables.values()) {
      childRenderable.dispose();
    }
    this.removeAxes();
    this.children.length = 0;
    this.userData.renderables.clear();
    this.userData.parts = [];
    this.userData.links = [];
  }

  public removeAxes(): void {
    for (const { object } of this.userData.axes) {
      this.remove(object);
      (object as Axis).dispose();
    }
    this.userData.axes = [];
  }
}

export class Urdfs extends SceneExtension<UrdfRenderable> {
  public static extensionId = "foxglove.Urdfs";
  #framesByInstanceId = new Map<string, string[]>();
  #transformsByInstanceId = new Map<string, TransformData[]>();
  /** Latest position of each joint, by joint states topic */
  #jointStates = new Map<string, Map<string, JointPosition>>();
  #jointStateTopicsCache: { topics: unknown; names: string[] } = { topics: undefined, names: [] };
  #textDecoder = new TextDecoder();
  #urdfsByTopic = new Map<string, string>();

  public constructor(renderer: Renderer, name: string = Urdfs.extensionId) {
    super(name, renderer);

    renderer.on("parametersChange", this.#handleParametersChange);
    renderer.addCustomLayerAction({
      layerId: LAYER_ID,
      label: i18next.t("threeDee:addURDF"),
      icon: "PrecisionManufacturing",
      handler: this.#handleAddUrdf,
    });

    // Load existing URDF layers from the config
    for (const [instanceId, entry] of Object.entries(renderer.config.layers)) {
      if (entry?.layerId === LAYER_ID) {
        this.#loadUrdf({ instanceId, urdf: undefined });
      }
    }
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "topic",
        topicName: TOPIC_NAME,
        subscription: {
          handler: this.#handleRobotDescription,
          filterQueue: onlyLastByTopicMessage,
        },
      },

      {
        type: "schema",
        schemaNames: ALL_JOINT_STATE_DATATYPES,
        subscription: {
          shouldSubscribe: this.#jointStatesShouldSubscribe,
          handler: this.#handleJointState,
          filterQueue: onlyLastByTopicMessage,
        },
      },

      {
        type: "schema",
        schemaNames: URDF_TOPIC_SCHEMAS,
        subscription: {
          shouldSubscribe: this.#shouldSubscribe,
          handler: this.#handleRobotDescription,
          filterQueue: onlyLastByTopicMessage,
        },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const entries: SettingsTreeEntry[] = [];
    const jointStateTopics = this.#jointStateTopics();
    const children = (key: string, config: Partial<LayerSettingsUrdf>) => {
      const jointStatesTopic = resolveJointStatesTopic(config, jointStateTopics);
      return {
        ...urdfChildren(
          this.#transformsByInstanceId.get(key),
          this.renderer.transformTree,
          jointStatesTopic != undefined ? this.#jointStates.get(jointStatesTopic) : undefined,
        ),
        ...urdfLinksNodes(
          Object.fromEntries(
            (this.renderables.get(key)?.userData.links ?? []).map(({ linkKey }) => [
              linkKey,
              urdfLinkNode(linkKey, config.links?.[linkKey]),
            ]),
          ),
        ),
      };
    };

    // /robot_description topic entry
    const topic = this.renderer.topicsByName?.get(TOPIC_NAME);
    if (topic != undefined) {
      const config = (this.renderer.config.topics[TOPIC_NAME] ?? {}) as Partial<LayerSettingsUrdf>;
      entries.push({
        path: ["topics", TOPIC_NAME],
        node: {
          ...urdfSettingsNode(TOPIC_NAME, config, jointStateTopics, children(TOPIC_NAME, config)),
          handler: this.#handleTopicSettingsAction,
        },
      });
    }

    // /robot_description parameter entry
    const parameter = this.renderer.parameters?.get(PARAM_NAME);
    if (parameter != undefined) {
      const config = (this.renderer.config.topics[PARAM_KEY] ?? {}) as Partial<LayerSettingsUrdf>;
      entries.push({
        path: ["topics", PARAM_KEY],
        node: {
          ...urdfSettingsNode(
            PARAM_DISPLAY_NAME,
            config,
            jointStateTopics,
            children(PARAM_KEY, config),
          ),
          handler: this.#handleTopicSettingsAction,
        },
      });
    }

    // Custom layer entries
    const urdfTopics = filterMap(this.renderer.topics ?? [], (_topic) =>
      URDF_TOPIC_SCHEMAS.has(_topic.schemaName) ? _topic.name : undefined,
    );
    const urdfParameters = filterMap(this.renderer.parameters ?? [], ([paramName, value]) =>
      typeof value === "string" ? paramName : undefined,
    );
    for (const [instanceId, layerConfig] of Object.entries(this.renderer.config.layers)) {
      if (layerConfig?.layerId === LAYER_ID) {
        const config = layerConfig as Partial<LayerSettingsCustomUrdf>;
        entries.push({
          path: ["layers", instanceId],
          node: {
            ...customUrdfSettingsNode(
              config,
              urdfTopics,
              urdfParameters,
              jointStateTopics,
              children(instanceId, config),
            ),
            handler: this.#handleLayerSettingsAction,
          },
        });
      }
    }

    return entries;
  }

  public override removeAllRenderables(): void {
    // Re-add coordinate frames and transforms since the scene has been cleared
    this.#refreshTransforms();
  }

  /**
   * Re-add coordinate frames and transforms corresponding to existing custom URDFs
   */
  #refreshTransforms() {
    for (const [instanceId, frames] of this.#framesByInstanceId) {
      this.#loadFrames(instanceId, frames);
    }
    for (const [instanceId, transforms] of this.#transformsByInstanceId) {
      this.#loadTransforms(instanceId, transforms);
    }
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    for (const renderable of this.renderables.values()) {
      const { settingsPath: path, settings } = renderable.userData;
      let hasTfError = false;

      renderable.visible = settings.visible;
      if (!renderable.visible) {
        this.renderer.settings.errors.clearPath(path);
        continue;
      }

      const linkPoses =
        settings.controlMode === "jointStates" ? this.#forwardKinematics(renderable) : undefined;

      // UrdfRenderables always stay at the origin. Their parts are individually updated since
      // each one exists in a different frame
      for (const parts of [renderable.userData.parts, renderable.userData.axes]) {
        for (const part of parts) {
          const linkSettings = settings.links?.[part.linkKey];
          const missingFrame = this.#updatePart(
            part,
            linkSettings,
            linkPoses?.get(part.frameId),
            renderFrameId,
            fixedFrameId,
            currentTime,
          );
          if (missingFrame != undefined) {
            const message = missingTransformMessage(renderFrameId, fixedFrameId, missingFrame);
            this.renderer.settings.errors.add(path, MISSING_TRANSFORM, message);
            hasTfError = true;
          }
          if (linkSettings?.visible === false) {
            part.object.visible = false;
          }
        }
      }

      if (!hasTfError) {
        this.renderer.settings.errors.remove(path, MISSING_TRANSFORM);
      }
    }
  }

  /**
   * Places a part: its pose in the link frame, after the link's offset, and in joint states mode
   * the link's pose from forward kinematics. Returns the frame it could not resolve, if any.
   */
  #updatePart(
    part: UrdfPart,
    linkSettings: UrdfLinkSettings | undefined,
    linkPose: LinkPose | undefined,
    renderFrameId: string,
    fixedFrameId: string,
    currentTime: bigint,
  ): string | undefined {
    let srcFrameId = part.frameId;
    let srcPose: Pose = part.pose;
    const offset = linkSettings?.position != undefined || linkSettings?.rotation != undefined;
    if (linkPose || offset) {
      if (linkPose) {
        tempMatrix.copy(linkPose.matrix);
        srcFrameId = linkPose.root;
      } else {
        tempMatrix.identity();
      }
      if (offset) {
        tempMatrix.multiply(offsetMatrix(linkSettings, tempMatrix2));
      }
      tempMatrix.multiply(poseToMatrix(part.pose, tempMatrix2));
      srcPose = matrixToPose(tempMatrix, tempPose);
    }
    const applied = this.renderer.transformTree.apply(
      tempOutPose,
      srcPose,
      renderFrameId,
      fixedFrameId,
      srcFrameId,
      currentTime,
      currentTime,
    );
    part.object.visible = applied != undefined;
    if (!applied) {
      return srcFrameId;
    }
    const { position: p, orientation: q } = tempOutPose;
    part.object.position.set(p.x, p.y, p.z);
    part.object.quaternion.set(q.x, q.y, q.z, q.w);
    return undefined;
  }

  /** Link poses relative to the root link, from the robot's joint states topic */
  #forwardKinematics(renderable: UrdfRenderable): Map<string, LinkPose> {
    const { settings, joints, jointsByName, linkPoses } = renderable.userData;
    const topic = resolveJointStatesTopic(settings, this.#jointStateTopics());
    const positions = topic != undefined ? this.#jointStates.get(topic) : undefined;
    const transformTree = this.renderer.transformTree;
    return forwardKinematics(
      joints,
      (name) => {
        const position = positions?.get(name)?.position;
        if (position != undefined) {
          return position;
        }
        const joint = jointsByName.get(name);
        return (joint && manualJointValue(joint, transformTree.frame(joint.child))) ?? 0;
      },
      linkPoses,
    );
  }

  /** Topics with joint states, recomputed only when the topic list changes */
  #jointStateTopics(): string[] {
    const topics = this.renderer.topics;
    if (this.#jointStateTopicsCache.topics !== topics) {
      const names = filterMap(topics ?? [], (topic) =>
        ALL_JOINT_STATE_DATATYPES.has(topic.schemaName) ? topic.name : undefined,
      );
      this.#jointStateTopicsCache = { topics, names };
    }
    return this.#jointStateTopicsCache.names;
  }

  #jointStatesShouldSubscribe = (topic: string): boolean => {
    const jointStateTopics = this.#jointStateTopics();
    const configs = [
      this.renderer.config.topics[TOPIC_NAME],
      this.renderer.config.topics[PARAM_KEY],
      ...Object.values(this.renderer.config.layers).filter((layer) => layer?.layerId === LAYER_ID),
    ] as (Partial<LayerSettingsUrdf> | undefined)[];
    return configs.some(
      (config) =>
        config?.controlMode === "jointStates" &&
        resolveJointStatesTopic(config, jointStateTopics) === topic,
    );
  };

  /** Applies opacity and outline settings to the loaded link geometry */
  #applyAppearance(renderable: UrdfRenderable): void {
    const { opacity = 1, showOutlines = true } = renderable.userData.settings;
    for (const { object, baseMarker } of renderable.userData.parts) {
      if (!(object instanceof RenderableMarker) || !baseMarker) {
        continue;
      }
      object.settingsOverride = { showOutlines };
      const alpha = baseMarker.color.a * _.clamp(opacity, 0, 1);
      object.update({ ...baseMarker, color: { ...baseMarker.color, a: alpha } }, undefined);
    }
  }

  /** Creates, scales or removes the per-link axes */
  #syncAxes(renderable: UrdfRenderable): void {
    const { showAxis = false, axisScale = 1 } = renderable.userData.settings;
    if (!showAxis) {
      renderable.removeAxes();
      return;
    }
    if (renderable.userData.axes.length === 0) {
      renderable.userData.axes = renderable.userData.links.map(({ frameId, linkKey }) => {
        const axis = new Axis(`${frameId}-axis`, this.renderer);
        renderable.add(axis);
        return { object: axis, frameId, linkKey, pose: makePose() };
      });
    }
    for (const { object } of renderable.userData.axes) {
      object.scale.setScalar(axisScale);
    }
  }

  #handleTopicSettingsAction = (action: SettingsTreeAction): void => {
    if (action.action === "update") {
      this.#handleSettingsUpdate(action);
      return;
    }
  };

  #handleLayerSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    // Handle menu actions (duplicate / delete)
    if (action.action === "perform-node-action" && path.length === 2) {
      const instanceId = path[1]!;
      if (action.payload.id === "delete") {
        // Remove this instance from the config
        this.renderer.updateConfig((draft) => {
          delete draft.layers[instanceId];
        });

        // Remove the renderable
        const renderable = this.renderables.get(instanceId);
        if (renderable) {
          renderable.dispose();
          this.remove(renderable);
          this.renderables.delete(instanceId);
        }

        // Remove transforms from the TF tree
        const transforms = this.#transformsByInstanceId.get(instanceId);
        if (transforms) {
          for (const { parent, child } of transforms) {
            this.renderer.removeTransform(child, parent, 0n);
          }
        }
        this.#framesByInstanceId.delete(instanceId);
        this.#transformsByInstanceId.delete(instanceId);

        // Re-add coordinate frames in case the deleted URDF shared frame names with other URDFs
        this.#refreshTransforms();

        // Update the settings tree
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      } else if (action.payload.id === "duplicate") {
        const newInstanceId = randomUUID();
        const config = {
          ...this.renderer.config.layers[instanceId],
          instanceId: newInstanceId,
        };

        // Add the new instance to the config
        this.renderer.updateConfig((draft) => {
          draft.layers[newInstanceId] = config;
        });

        // Add the URDF renderable
        const renderable = this.renderables.get(instanceId);
        this.#loadUrdf({ instanceId: newInstanceId, urdf: renderable?.userData.urdf });

        // Update the settings tree
        this.updateSettingsTree();
        this.renderer.updateCustomLayersCount();
      }
    } else if (action.action === "update") {
      this.#handleSettingsUpdate(action);
    }
  };

  #handleSettingsUpdate = (action: { action: "update" } & SettingsTreeAction): void => {
    const path = action.payload.path;

    if (path.length === 5 && path[2] === "joints") {
      // ["layers", instanceId, "joints", jointName, "manual"]
      const instanceId = path[1]!;
      const jointName = path[3]!;
      const transforms = this.#transformsByInstanceId.get(instanceId);
      if (!transforms) {
        return;
      }

      const transformData = transforms.find((t) => t.joint.name === jointName);
      if (!transformData) {
        return;
      }

      const joint = transformData.joint;
      const frame = this.renderer.transformTree.getOrCreateFrame(transformData.child);
      const frameKey = `frame:${frame.id}`;
      const isAngular = joint.jointType === "revolute" || joint.jointType === "continuous";
      const axis = tempVec3a.set(joint.axis.x, joint.axis.y, joint.axis.z);

      if (action.payload.input !== "number") {
        return;
      }
      // undefined when the field is cleared: drop the manual offset
      const value = action.payload.value;
      if (isAngular) {
        if (value == undefined) {
          frame.offsetEulerDegrees = undefined;
        } else {
          const quaternion = tempQuaternion1.setFromAxisAngle(axis, value * DEG2RAD);
          const euler = tempEuler.setFromQuaternion(quaternion);
          frame.offsetEulerDegrees = [euler.x * RAD2DEG, euler.y * RAD2DEG, euler.z * RAD2DEG];
        }
        this.saveSetting(["transforms", frameKey, "rpyCoefficient"], frame.offsetEulerDegrees);
      } else {
        if (value == undefined) {
          frame.offsetPosition = undefined;
        } else {
          axis.multiplyScalar(value);
          frame.offsetPosition = [axis.x, axis.y, axis.z];
        }
        this.saveSetting(["transforms", frameKey, "xyzOffset"], frame.offsetPosition);
      }
    } else if (path.length === 5 && path[2] === "links") {
      // [layers|topics, instanceId, "links", linkKey, "visible" | "position" | "rotation"]
      const { input, value } = action.payload;
      // A cleared vec3 component counts as 0
      this.saveSetting(path, input === "vec3" ? value?.map((v) => v ?? 0) : value);
      const renderable = this.renderables.get(path[1]!);
      if (renderable) {
        renderable.userData.settings = this.#getCurrentSettings(path[1]!);
      }
    } else if (path.length === 3) {
      // ["layers", instanceId, field]
      this.saveSetting(path, action.payload.value);
      const [_layers, instanceId, field] = path as [string, string, string];
      const renderable = this.renderables.get(instanceId);
      let urdf = renderable?.userData.urdf;

      if (field === "url" || field === "filePath") {
        this.#debouncedLoadUrdf({ instanceId, urdf: undefined });
      } else if (field === "parameter") {
        urdf = this.renderer.parameters?.get(action.payload.value as string) as string | undefined;
        this.#debouncedLoadUrdf({ instanceId, urdf, forceReload: true });
      } else if (field === "framePrefix") {
        this.#debouncedLoadUrdf({ instanceId, urdf, forceReload: true });
      } else if (field === "displayMode" || field === "visible" || field === "fallbackColor") {
        this.#loadUrdf({ instanceId, urdf, forceReload: true });
      } else if (field === "sourceType") {
        const sourceType = action.payload.value as LayerSettingsCustomUrdf["sourceType"];
        if (sourceType === "topic") {
          urdf = renderable?.userData.topic
            ? this.#urdfsByTopic.get(renderable.userData.topic)
            : undefined;
        } else if (sourceType === "param") {
          urdf = renderable?.userData.parameter
            ? (this.renderer.parameters?.get(renderable.userData.parameter) as string | undefined)
            : undefined;
        } else {
          urdf = undefined;
        }
        this.#loadUrdf({ instanceId, urdf, forceReload: true });
      } else if (field === "topic") {
        urdf = this.#urdfsByTopic.get(action.payload.value as string);
        this.#loadUrdf({ instanceId, urdf });
      } else if (APPEARANCE_FIELDS.has(field)) {
        // Applied in place: reloading would refetch every mesh
        if (renderable) {
          renderable.userData.settings = this.#getCurrentSettings(instanceId);
          this.#applyAppearance(renderable);
          this.#syncAxes(renderable);
        }
      } else {
        this.#loadUrdf({ instanceId, urdf });
      }
    }
  };

  #handleRobotDescription = (messageEvent: PartialMessageEvent<{ data: string }>): void => {
    const topic = messageEvent.topic;
    const robotDescription = messageEvent.message.data;
    if (typeof robotDescription !== "string") {
      return;
    }
    this.#urdfsByTopic.set(topic, robotDescription);

    if (topic === TOPIC_NAME) {
      this.#loadUrdf({ instanceId: TOPIC_NAME, urdf: robotDescription });
    }

    // Update custom layer URDFs that subscribe to this topic.
    const subscribedInstanceIds = filterMap(this.renderables, ([instanceId, renderable]) =>
      renderable.userData.sourceType === "topic" && renderable.userData.topic === topic
        ? instanceId
        : undefined,
    );
    for (const instanceId of subscribedInstanceIds) {
      this.#loadUrdf({ instanceId, urdf: robotDescription });
    }
  };

  #shouldSubscribe = (topic: string): boolean => {
    return Array.from(this.renderables.values()).some(
      (renderable) =>
        renderable.userData.sourceType === "topic" && renderable.userData.topic === topic,
    );
  };

  #handleJointState = (
    messageEvent: PartialMessageEvent<JointState | FoxgloveJointStates | FoxgloveJointState>,
  ): void => {
    const { names, positions } = jointPositions(messageEvent.message as AnyJointState);
    const timestamp = toNanoSec(messageEvent.receiveTime);
    let jointStates = this.#jointStates.get(messageEvent.topic);
    if (!jointStates) {
      jointStates = new Map();
      this.#jointStates.set(messageEvent.topic, jointStates);
    }

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const position = positions[i];
      if (name == undefined || position == undefined || !Number.isFinite(position)) {
        continue;
      }

      const prevTimestamp = jointStates.get(name)?.timestamp;
      if (prevTimestamp == undefined || timestamp >= prevTimestamp) {
        jointStates.set(name, { timestamp, position });
      }
    }
  };

  #handleParametersChange = (parameters: ReadonlyMap<string, unknown> | undefined): void => {
    const robotDescription = parameters?.get(PARAM_NAME);
    if (typeof robotDescription === "string") {
      this.#loadUrdf({ instanceId: PARAM_KEY, urdf: robotDescription });
    }

    // Update custom layer URDFs that use parameters.
    for (const [instanceId, renderable] of this.renderables.entries()) {
      const settings = renderable.userData.settings;
      if (
        "sourceType" in settings &&
        settings.sourceType === "param" &&
        settings.parameter != undefined
      ) {
        const urdf = parameters?.get(settings.parameter);
        if (typeof urdf === "string") {
          this.#loadUrdf({ instanceId, urdf });
        }
      }
    }
  };

  #handleAddUrdf = (instanceId: string): void => {
    log.info(`Creating ${LAYER_ID} layer ${instanceId}`);

    const config: LayerSettingsCustomUrdf = { ...DEFAULT_CUSTOM_SETTINGS, instanceId };

    // Add this instance to the config
    this.renderer.updateConfig((draft) => {
      const maxOrderLayer = _.maxBy(Object.values(draft.layers), (layer) => layer?.order);
      const order = 1 + (maxOrderLayer?.order ?? 0);
      draft.layers[instanceId] = { ...config, order };
    });

    // Add the URDF renderable
    this.#loadUrdf({ instanceId, urdf: undefined });

    // Update the settings tree
    this.updateSettingsTree();
  };

  #fetchUrdf(instanceId: string, url: string): void {
    const renderable = this.renderables.get(instanceId);
    if (!renderable) {
      throw new Error(`_fetchUrdf() should only be called for existing renderables`);
    }

    // Check if a valid URL was provided
    if (!isValidUrl(url)) {
      const path = renderable.userData.settingsPath;
      this.renderer.settings.errors.add(path, VALID_SRC_ERR, `Invalid URDF URL: "${url}"`);
      return;
    }
    this.renderer.settings.errors.remove(renderable.userData.settingsPath, VALID_SRC_ERR);

    if (renderable.userData.fetching) {
      // Check if this fetch is already in progress
      if (renderable.userData.fetching.url === url) {
        return;
      }

      // Cancel the previous fetch
      renderable.userData.fetching.control.abort();
    }

    log.debug(`Fetching URDF from ${url}`);
    const fetching = {
      url,
      control: new AbortController(),
    };
    renderable.userData.fetching = fetching;
    this.renderer
      .fetchAsset(url, { signal: renderable.userData.fetching.control.signal })
      .then((urdf) => {
        if (fetching.control.signal.aborted || renderable.userData.fetching !== fetching) {
          return;
        }
        log.debug(`Fetched ${urdf.data.length} byte URDF from ${url}`);
        this.renderer.settings.errors.remove(["layers", instanceId], FETCH_URDF_ERR);
        this.#loadUrdf({
          instanceId,
          urdf: this.#textDecoder.decode(urdf.data),
          referenceUrl: urdf.uri,
        });
      })
      .catch((e: unknown) => {
        if (fetching.control.signal.aborted || renderable.userData.fetching !== fetching) {
          return;
        }
        const err = toError(e);
        const hasError = !err.message.startsWith("Failed to fetch");
        const errMessage = `Failed to load URDF from "${url}"${hasError ? `: ${err.message}` : ""}`;
        this.renderer.settings.errors.add(["layers", instanceId], FETCH_URDF_ERR, errMessage);
      });
  }

  #getCurrentSettings(instanceId: string) {
    const isTopicOrParam = instanceId === TOPIC_NAME || instanceId === PARAM_KEY;
    const baseSettings = isTopicOrParam ? DEFAULT_SETTINGS : DEFAULT_CUSTOM_SETTINGS;
    const userSettings = isTopicOrParam
      ? this.renderer.config.topics[instanceId]
      : this.renderer.config.layers[instanceId];
    const settings = { ...baseSettings, ...userSettings, instanceId };
    return settings;
  }

  #loadUrdf(args: {
    instanceId: string;
    urdf?: string;
    forceReload?: boolean;
    referenceUrl?: string;
  }): void {
    const { instanceId, urdf } = args;
    const forceReload = args.forceReload ?? false;
    let renderable = this.renderables.get(instanceId);
    const referenceUrl = args.referenceUrl ?? renderable?.userData.referenceUrl;
    const settings = this.#getCurrentSettings(instanceId);
    if (
      renderable &&
      urdf &&
      !forceReload &&
      renderable.userData.urdf === urdf &&
      renderable.userData.referenceUrl === referenceUrl
    ) {
      renderable.userData.settings = settings;
      return;
    }

    // Clear any previous parsed data for this instanceId
    const transforms = this.#transformsByInstanceId.get(instanceId) ?? [];
    for (const transform of transforms) {
      this.renderer.removeTransform(transform.child, transform.parent, 0n);
    }
    this.#transformsByInstanceId.delete(instanceId);
    this.#framesByInstanceId.delete(instanceId);
    this.updateSettingsTree();

    const isTopicOrParam = instanceId === TOPIC_NAME || instanceId === PARAM_KEY;
    const frameId = this.renderer.fixedFrameId ?? ""; // Unused
    const settingsPath = isTopicOrParam ? ["topics", instanceId] : ["layers", instanceId];
    const sourceType = (settings as Partial<LayerSettingsCustomUrdf>).sourceType;
    const url = (settings as Partial<LayerSettingsCustomUrdf>).url;
    const filePath = (settings as Partial<LayerSettingsCustomUrdf>).filePath;
    const parameter = (settings as Partial<LayerSettingsCustomUrdf>).parameter;
    const topic = (settings as Partial<LayerSettingsCustomUrdf>).topic;
    const framePrefix = (settings as Partial<LayerSettingsCustomUrdf>).framePrefix;
    const label =
      (settings as Partial<LayerSettingsCustomUrdf>).label ?? DEFAULT_CUSTOM_SETTINGS.label;

    if (label !== renderable?.userData.settings.label) {
      // Label has changed, update the config
      this.renderer.updateConfig((draft) => {
        const config = draft.layers[instanceId];
        if (config) {
          config.label = label;
        }
      });
    }

    // Create a UrdfRenderable if it does not already exist
    if (!renderable) {
      renderable = new UrdfRenderable(instanceId, this.renderer, {
        urdf,
        fetching: undefined,
        loadGeneration: 0,
        renderables: new Map(),
        parts: [],
        axes: [],
        links: [],
        joints: [],
        jointsByName: new Map(),
        linkPoses: new Map(),
        receiveTime: 0n,
        messageTime: 0n,
        frameId,
        pose: makePose(),
        settingsPath,
        settings,
        sourceType,
        topic,
        parameter,
      });
      this.add(renderable);
      this.renderables.set(instanceId, renderable);
    }

    const loadGeneration = ++renderable.userData.loadGeneration;
    renderable.userData.referenceUrl = urdf ? referenceUrl : undefined;
    renderable.userData.urdf = urdf;
    renderable.userData.sourceType = sourceType;
    renderable.userData.topic = topic;
    renderable.userData.parameter = parameter;
    renderable.userData.settings = settings;
    renderable.userData.fetching = undefined;

    if (!urdf || forceReload) {
      renderable.removeChildren();
    }

    if (!urdf) {
      const path = renderable.userData.settingsPath;
      this.renderer.settings.errors.remove(path, PARSE_URDF_ERR);
      this.renderer.settings.errors.remove(path, MISSING_TRANSFORM);
      if (sourceType === "url") {
        if (url != undefined) {
          this.#fetchUrdf(instanceId, url);
        } else {
          this.renderer.settings.errors.add(path, VALID_SRC_ERR, `Invalid URDF URL: "${url}"`);
        }
      } else if (sourceType === "filePath") {
        if (filePath != undefined) {
          this.#fetchUrdf(instanceId, `file://${filePath}`);
        } else {
          const errMsg = `Invalid File Path: "${filePath}"`;
          this.renderer.settings.errors.add(path, VALID_SRC_ERR, errMsg);
        }
      } else if (sourceType === "param") {
        this.renderer.settings.errors.add(path, VALID_SRC_ERR, `Invalid Parameter: "${parameter}"`);
      } else if (sourceType === "topic") {
        this.renderer.settings.errors.add(path, VALID_SRC_ERR, `Invalid Topic: "${topic}"`);
      }
      return;
    } else {
      this.renderer.settings.errors.remove(renderable.userData.settingsPath, VALID_SRC_ERR);
    }

    let baseUrl: string | undefined;
    if (sourceType === "url") {
      baseUrl = renderable.userData.referenceUrl ?? url;
    } else if (sourceType === "filePath") {
      baseUrl = renderable.userData.referenceUrl ?? `file://${filePath}`;
    }

    // Parse the URDF
    const loadedRenderable = renderable;
    parseUrdf(urdf, async (uri) => await this.#getFileFetch(uri, baseUrl), framePrefix ?? "")
      .then((parsed) => {
        if (
          this.renderables.get(instanceId) !== loadedRenderable ||
          loadedRenderable.userData.loadGeneration !== loadGeneration
        ) {
          return;
        }
        this.#loadRobot(loadedRenderable, parsed, baseUrl);
        this.renderer.settings.errors.remove(
          loadedRenderable.userData.settingsPath,
          PARSE_URDF_ERR,
        );
        // the frame from the settings update is called before the robot is loaded
        // need to queue another animation frame after robot has been loaded
        this.renderer.queueAnimationFrame();
      })
      .catch((e: unknown) => {
        if (
          this.renderables.get(instanceId) !== loadedRenderable ||
          loadedRenderable.userData.loadGeneration !== loadGeneration
        ) {
          return;
        }
        const err = toError(e);
        log.error(`Failed to parse URDF: ${err.message}`);
        this.renderer.settings.errors.add(
          settingsPath,
          PARSE_URDF_ERR,
          `Failed to parse URDF: ${err.message}`,
        );
      });
  }

  #debouncedLoadUrdf = _.debounce(this.#loadUrdf.bind(this), 500);

  #loadRobot(
    renderable: UrdfRenderable,
    { robot, frames, transforms }: ParsedUrdf,
    baseUrl: string | undefined,
  ): void {
    const renderer = this.renderer;
    const settings = renderable.userData.settings;
    const instanceId = settings.instanceId;
    const displayMode = settings.displayMode;
    const fallbackColor = settings.fallbackColor
      ? stringToRgba(makeRgba(), settings.fallbackColor)
      : undefined;

    this.#loadFrames(instanceId, frames);
    this.#loadTransforms(instanceId, transforms);

    // Dispose any existing renderables
    renderable.removeChildren();
    // Children share the URDF settings path, so clear the previous load's mesh error once here
    renderer.settings.errors.remove(renderable.userData.settingsPath, MESH_FETCH_FAILED);

    const framePrefix = (settings as Partial<LayerSettingsCustomUrdf>).framePrefix ?? "";
    const links: UrdfLink[] = [];
    const parts: UrdfPart[] = [];
    renderable.userData.links = links;
    renderable.userData.parts = parts;
    renderable.userData.joints = transforms.map(({ joint }) => joint);
    renderable.userData.jointsByName = new Map(transforms.map(({ joint }) => [joint.name, joint]));
    renderable.userData.linkPoses = new Map();

    const createChild = (link: UrdfLink, i: number, visual: UrdfVisual): void => {
      const frameId = link.frameId;
      const childRenderable = createRenderable({
        visual,
        robot,
        id: i,
        frameId,
        renderer,
        baseUrl,
        fallbackColor,
      });
      // Set the childRenderable settingsPath so errors route to the correct place
      childRenderable.userData.settingsPath = renderable.userData.settingsPath;
      renderable.userData.renderables.set(childRenderable.name, childRenderable);
      renderable.add(childRenderable);
      parts.push({
        object: childRenderable,
        frameId,
        linkKey: link.linkKey,
        pose: childRenderable.userData.pose,
        baseMarker:
          childRenderable instanceof RenderableMarker ? childRenderable.userData.marker : undefined,
      });
    };

    // Create a renderable for each link
    for (const link of robot.links.values()) {
      const urdfLink = { frameId: link.name, linkKey: link.name.slice(framePrefix.length) };
      links.push(urdfLink);
      const renderVisual = displayMode !== "collision";
      const renderCollision =
        displayMode === "collision" || (displayMode === "auto" && link.visuals.length === 0);

      if (renderVisual) {
        for (let i = 0; i < link.visuals.length; i++) {
          createChild(urdfLink, i, link.visuals[i]!);
        }
      }

      if (renderCollision) {
        for (let i = 0; i < link.colliders.length; i++) {
          createChild(urdfLink, i, link.colliders[i]!);
        }
      }
    }

    const { opacity = 1, showOutlines = true } = settings;
    if (opacity !== 1 || !showOutlines) {
      this.#applyAppearance(renderable);
    }
    this.#syncAxes(renderable);
    // The joints and links sections list what was just loaded
    this.updateSettingsTree();
  }

  #loadFrames(instanceId: string, frames: string[]): void {
    this.#framesByInstanceId.set(instanceId, frames);

    // Import all coordinate frames from the URDF into the scene
    for (const frameId of frames) {
      this.renderer.addCoordinateFrame(frameId);
    }
  }

  #loadTransforms(instanceId: string, transforms: TransformData[]): void {
    this.#transformsByInstanceId.set(instanceId, transforms);

    // Import all transforms from the URDF into the scene
    const isTopicOrParam = instanceId === TOPIC_NAME || instanceId === PARAM_KEY;
    const settingsPath = isTopicOrParam ? ["topics", instanceId] : ["layers", instanceId];
    for (const { parent, child, translation, rotation } of transforms) {
      this.renderer.addTransform(parent, child, 0n, translation, rotation, settingsPath);
    }
  }

  async #getFileFetch(url: string, referenceUrl?: string): Promise<string> {
    try {
      log.debug(`fetch(${url}) requested`);
      const asset = await this.renderer.fetchAsset(url, { referenceUrl });
      return this.#textDecoder.decode(asset.data);
    } catch (err: unknown) {
      throw new Error(`Failed to fetch "${url}": ${err}`);
    }
  }
}

async function parseUrdf(
  text: string,
  getFileContents: (url: string) => Promise<string>,
  framePrefix?: string,
): Promise<ParsedUrdf> {
  const applyFramePrefix = (name: string) => `${framePrefix}${name}`;
  try {
    log.debug(`Parsing ${text.length} byte URDF`);
    const robot = await parseRobot(text, getFileContents);

    if (framePrefix) {
      robot.links = new Map(
        [...robot.links].map(([name, link]) => [
          applyFramePrefix(name),
          { ...link, name: applyFramePrefix(link.name) },
        ]),
      );
      robot.joints = new Map(
        [...robot.joints].map(([name, joint]) => [
          name,
          {
            ...joint,
            parent: applyFramePrefix(joint.parent),
            child: applyFramePrefix(joint.child),
          },
        ]),
      );
    }

    const frames = Array.from(robot.links.values(), (link) => link.name);
    const transforms = Array.from(robot.joints.values(), (joint) => {
      const translation = joint.origin.xyz;
      const rotation = eulerToQuaternion(joint.origin.rpy);
      const transform: TransformData = {
        parent: joint.parent,
        child: joint.child,
        translation,
        rotation,
        joint,
      };
      return transform;
    });

    return { robot, frames, transforms };
  } catch (err: unknown) {
    throw new Error(`Failed to parse ${text.length} byte URDF: ${err}`);
  }
}

export function createRenderable(args: {
  visual: UrdfVisual;
  robot: UrdfRobot;
  id: number;
  frameId: string;
  renderer: Renderer;
  baseUrl?: string;
  fallbackColor?: ColorRGBA;
}): Renderable {
  const { visual, robot, id, frameId, renderer, baseUrl, fallbackColor } = args;
  const name = `${frameId}-${id}-${visual.geometry.geometryType}`;
  const orientation = eulerToQuaternion(visual.origin.rpy);
  const pose = { position: visual.origin.xyz, orientation };
  const color = getColor(visual, robot) ?? fallbackColor ?? DEFAULT_COLOR;
  const type = visual.geometry.geometryType;
  switch (type) {
    case "box": {
      const scale = visual.geometry.size;
      const marker = createMarker(frameId, MarkerType.CUBE, pose, scale, color);
      return new RenderableCube(name, marker, undefined, renderer);
    }
    case "cylinder": {
      const cylinder = visual.geometry;
      const scale = { x: cylinder.radius * 2, y: cylinder.radius * 2, z: cylinder.length };
      const marker = createMarker(frameId, MarkerType.CUBE, pose, scale, color);
      return new RenderableCylinder(name, marker, undefined, renderer);
    }
    case "sphere": {
      const sphere = visual.geometry;
      const scale = { x: sphere.radius * 2, y: sphere.radius * 2, z: sphere.radius * 2 };
      const marker = createMarker(frameId, MarkerType.CUBE, pose, scale, color);
      return new RenderableSphere(name, marker, undefined, renderer);
    }
    case "mesh": {
      // Collada, glTF and OBJ/MTL carry their own materials; STL gets the URDF color
      const hasMaterials = /\.(dae|gltf|glb|obj)$/i.test(
        visual.geometry.filename.split(/[?#]/)[0]!,
      );
      const embedded = hasMaterials ? EmbeddedMaterialUsage.Use : EmbeddedMaterialUsage.Ignore;
      const marker = createMeshMarker(frameId, pose, embedded, visual.geometry, baseUrl, color);
      return new RenderableMeshResource(name, marker, undefined, renderer, {
        referenceUrl: baseUrl,
        alphaFadesModelMaterials: true,
      });
    }
    default:
      throw new Error(`Unrecognized visual geometryType: ${type}`);
  }
}

function getColor(visual: UrdfVisual, robot: UrdfRobot): ColorRGBA | undefined {
  if (!visual.material) {
    return undefined;
  }
  if (visual.material.color) {
    return visual.material.color;
  }
  if (visual.material.name) {
    return robot.materials.get(visual.material.name)?.color;
  }
  return undefined;
}

function createMarker(
  frameId: string,
  type: MarkerType,
  pose: Pose,
  scale: Vector3,
  color: ColorRGBA,
): Marker {
  return {
    header: { frame_id: frameId, stamp: { sec: 0, nsec: 0 } },
    ns: "",
    id: 0,
    type,
    action: MarkerAction.ADD,
    pose,
    scale,
    color,
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: true,
    points: [],
    colors: [],
    text: "",
    mesh_resource: "",
    mesh_use_embedded_materials: false,
  };
}

function createMeshMarker(
  frameId: string,
  pose: Pose,
  embeddedMaterialUsage: EmbeddedMaterialUsage,
  mesh: UrdfGeometryMesh,
  baseUrl: string | undefined,
  color: ColorRGBA,
): Marker {
  const scale = mesh.scale ?? VEC3_ONE;
  return {
    header: { frame_id: frameId, stamp: { sec: 0, nsec: 0 } },
    ns: "",
    id: 0,
    type: MarkerType.MESH_RESOURCE,
    action: MarkerAction.ADD,
    pose,
    scale,
    color,
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: true,
    points: [],
    colors: [],
    text: "",
    mesh_resource: new URL(mesh.filename, baseUrl).toString(),
    mesh_use_embedded_materials: embeddedMaterialUsage === EmbeddedMaterialUsage.Use,
  };
}

/** `jointStates`: latest joint positions from the robot's joint states topic, if any */
function urdfChildren(
  transforms: TransformData[] | undefined,
  transformTree: TransformTree,
  jointStates: Map<string, JointPosition> | undefined,
): DocumentedNodes {
  if (!transforms) {
    return {};
  }

  const jointChildren: DocumentedNodes = {};
  for (const { joint } of transforms) {
    const frame = transformTree.getOrCreateFrame(joint.child);
    const value = manualJointValue(joint, frame);
    const isAngular = joint.jointType === "continuous" || joint.jointType === "revolute";
    const manual = value != undefined && isAngular ? value * RAD2DEG : value;
    jointChildren[joint.name] = urdfJointNode(
      joint,
      manual,
      jointStates?.get(joint.name)?.position,
    );
  }
  return urdfJointsNodes(jointChildren);
}

/** The joint value set by hand through the child frame's offset, in radians or meters */
function manualJointValue(
  joint: UrdfJoint,
  frame: CoordinateFrame | undefined,
): number | undefined {
  if (joint.jointType === "continuous" || joint.jointType === "revolute") {
    if (!frame?.offsetEulerDegrees) {
      return undefined;
    }
    return signedAngleAroundAxis(eulerDegreesToQuaternion(frame.offsetEulerDegrees), joint.axis);
  } else if (joint.jointType === "prismatic" && frame?.offsetPosition) {
    return signedDistanceAlongAxis(frame.offsetPosition, joint.axis);
  }
  return undefined;
}

const tempPosition = new THREE.Vector3();
const tempScale = new THREE.Vector3();

/** A link's offset: translation (m) and rotation (roll, pitch, yaw in degrees) */
function offsetMatrix(link: UrdfLinkSettings | undefined, out: THREE.Matrix4): THREE.Matrix4 {
  const [r = 0, p = 0, y = 0] = link?.rotation ?? [];
  const [x = 0, yy = 0, z = 0] = link?.position ?? [];
  out.makeRotationFromEuler(tempEuler.set(r * DEG2RAD, p * DEG2RAD, y * DEG2RAD, "ZYX"));
  return out.setPosition(x, yy, z);
}

function poseToMatrix(pose: Readonly<Pose>, out: THREE.Matrix4): THREE.Matrix4 {
  const { position: p, orientation: q } = pose;
  return out.compose(
    tempPosition.set(p.x, p.y, p.z),
    tempQuaternion1.set(q.x, q.y, q.z, q.w),
    tempScale.set(1, 1, 1),
  );
}

function matrixToPose(matrix: THREE.Matrix4, out: Pose): Pose {
  matrix.decompose(tempPosition, tempQuaternion1, tempScale);
  out.position.x = tempPosition.x;
  out.position.y = tempPosition.y;
  out.position.z = tempPosition.z;
  out.orientation.x = tempQuaternion1.x;
  out.orientation.y = tempQuaternion1.y;
  out.orientation.z = tempQuaternion1.z;
  out.orientation.w = tempQuaternion1.w;
  return out;
}

function eulerDegreesToQuaternion(eulerDegrees: vec3): THREE.Quaternion {
  tempEuler.set(eulerDegrees[0] * DEG2RAD, eulerDegrees[1] * DEG2RAD, eulerDegrees[2] * DEG2RAD);
  return tempQuaternion1.setFromEuler(tempEuler);
}

function signedDistanceAlongAxis(position: Readonly<vec3>, axis: Readonly<Vector3>): number {
  const p = tempVec3a.set(position[0], position[1], position[2]);
  const targetAxis = tempVec3b.set(axis.x, axis.y, axis.z);

  // Project the position on to axis
  p.projectOnVector(targetAxis);
  const distance = p.length();

  // Calculate the sign
  const dotProduct = p.dot(targetAxis);
  const sign = dotProduct < 0 ? -1 : 1;

  return sign * distance;
}

// Find the signed angle of a rotation around a given axis
function signedAngleAroundAxis(rotation: Readonly<Quaternion>, axis: Readonly<Vector3>): number {
  const rotationAxis = tempVec3a.set(rotation.x, rotation.y, rotation.z);
  const targetAxis = tempVec3b.set(axis.x, axis.y, axis.z);

  // Project the rotation axis onto the given axis
  const p = rotationAxis.projectOnVector(targetAxis);

  // Create a twist quaternion from the projected axis and original rotation angle
  const twist = tempQuaternion2.set(p.x, p.y, p.z, rotation.w);
  twist.normalize();

  // Calculate the twist angle ([0, PI])
  const angle = 2 * Math.acos(twist.w);

  // Calculate the sign of the twist angle
  const dotProduct = tempVec3a.set(twist.x, twist.y, twist.z).dot(targetAxis);
  const sign = dotProduct < 0 ? -1 : 1;

  return sign * angle;
}
