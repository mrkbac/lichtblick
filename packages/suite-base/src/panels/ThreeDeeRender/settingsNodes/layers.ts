// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Settings nodes for the 3D panel's custom layers (grids, URDFs, maps), shared by the scene
// extensions and the panel guide. Kept free of three.js.

import { t } from "i18next";

import type { UrdfJoint } from "@lichtblick/den/urdf";
import type { SettingsTreeNodeAction } from "@lichtblick/suite";
import {
  layerStackActions,
  layerStackChildren,
  MAP_SOURCE_KINDS,
} from "@lichtblick/suite-base/panels/Map/layerSettings";
import type { MapLayer, SourceKind, SourceParams } from "@lichtblick/suite-base/panels/Map/layers";
import type {
  DocumentedField,
  DocumentedFields,
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";
import isDesktopApp from "@lichtblick/suite-base/util/isDesktopApp";

import type { LayerSettingsGrid } from "../renderables/Grids";
import type { LayerSettingsMap } from "../renderables/Maps";
import type { LayerSettingsCustomUrdf, LayerSettingsUrdf } from "../renderables/Urdfs";
import { PRECISION_DEGREES, PRECISION_DISTANCE } from "../settings";

type SelectOption = { label: string; value: string | undefined };

function deleteAction(): SettingsTreeNodeAction {
  return { type: "action", id: "delete", label: t("threeDee:delete") };
}

// ---- Grid ----

export const GRID_LAYER_ID = "foxglove.Grid";
export const MAX_GRID_DIVISIONS = 4096; // The JS heap size is a limiting factor

export const GRID_DEFAULTS: LayerSettingsGrid = {
  visible: true,
  frameLocked: true,
  label: "Grid",
  instanceId: "invalid",
  layerId: GRID_LAYER_ID,
  frameId: undefined,
  size: 10,
  divisions: 10,
  lineWidth: 1,
  color: "#248eff",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
};

export function gridSettingsNode(
  config: Partial<LayerSettingsGrid>,
  frameOptions: SelectOption[],
): DocumentedNode {
  return {
    label: config.label ?? t("threeDee:grid"),
    icon: "Grid",
    fields: {
      frameId: {
        label: t("threeDee:frame"),
        help: t("threeDee:gridFrameHelp"),
        input: "select",
        options: [{ label: "<Display frame>", value: undefined }, ...frameOptions],
        value: config.frameId,
      },
      size: {
        label: t("threeDee:size"),
        help: t("threeDee:gridSizeHelp"),
        input: "number",
        min: 0,
        step: 0.5,
        precision: PRECISION_DISTANCE,
        value: config.size,
        placeholder: String(GRID_DEFAULTS.size),
      },
      divisions: {
        label: t("threeDee:divisions"),
        help: t("threeDee:gridDivisionsHelp"),
        input: "number",
        min: 1,
        max: MAX_GRID_DIVISIONS,
        step: 1,
        precision: 0,
        value: config.divisions,
        placeholder: String(GRID_DEFAULTS.divisions),
      },
      lineWidth: {
        label: t("threeDee:lineWidth"),
        help: t("threeDee:gridLineWidthHelp"),
        input: "number",
        min: 0,
        step: 0.5,
        precision: 1,
        value: config.lineWidth,
        placeholder: String(GRID_DEFAULTS.lineWidth),
      },
      color: {
        label: t("threeDee:color"),
        help: t("threeDee:gridColorHelp"),
        input: "rgba",
        value: config.color ?? GRID_DEFAULTS.color,
      },
      position: {
        label: t("threeDee:position"),
        help: t("threeDee:gridPositionHelp"),
        input: "vec3",
        labels: ["X", "Y", "Z"],
        precision: PRECISION_DISTANCE,
        value: config.position ?? [0, 0, 0],
      },
      rotation: {
        label: t("threeDee:rotation"),
        help: t("threeDee:gridRotationHelp"),
        input: "vec3",
        labels: ["R", "P", "Y"],
        precision: PRECISION_DEGREES,
        value: config.rotation ?? [0, 0, 0],
      },
    },
    visible: config.visible ?? GRID_DEFAULTS.visible,
    actions: [deleteAction()],
    order: config.order,
  };
}

// ---- URDF ----

export const URDF_LAYER_ID = "foxglove.Urdf";
const URDF_DEFAULT_COLOR_STR = "#ffffff";

const URDF_ROBOT_DEFAULTS = {
  controlMode: "transforms",
  opacity: 1,
  showOutlines: true,
  showAxis: false,
  axisScale: 1,
} as const;

export const URDF_DEFAULTS: LayerSettingsUrdf = {
  visible: false,
  frameLocked: true,
  instanceId: "invalid",
  displayMode: "auto",
  label: "URDF",
  fallbackColor: URDF_DEFAULT_COLOR_STR,
  ...URDF_ROBOT_DEFAULTS,
};

export const CUSTOM_URDF_DEFAULTS: LayerSettingsCustomUrdf = {
  visible: true,
  frameLocked: true,
  label: "URDF",
  instanceId: "invalid",
  layerId: URDF_LAYER_ID,
  sourceType: "url",
  url: "",
  filePath: "",
  parameter: "",
  topic: "",
  framePrefix: "",
  displayMode: "auto",
  fallbackColor: URDF_DEFAULT_COLOR_STR,
  ...URDF_ROBOT_DEFAULTS,
};

/** Settings shared by robot descriptions from a topic, a parameter or a custom layer. */
export type UrdfRobotSettings = Pick<
  LayerSettingsUrdf,
  | "displayMode"
  | "fallbackColor"
  | "controlMode"
  | "jointStatesTopic"
  | "opacity"
  | "showOutlines"
  | "showAxis"
  | "axisScale"
>;

/**
 * The joint states topic a robot follows in joint states mode: the configured one, else the first
 * `sensor_msgs/JointState` topic. `jointStateTopics`: the available ones.
 */
export function resolveJointStatesTopic(
  config: Partial<UrdfRobotSettings>,
  jointStateTopics: readonly string[],
): string | undefined {
  const topic = config.jointStatesTopic;
  return topic != undefined && topic !== "" ? topic : jointStateTopics[0];
}

/** `jointStateTopics`: topics with joint states, offered in the joint states picker. */
function urdfRobotFields(
  config: Partial<UrdfRobotSettings>,
  jointStateTopics: readonly string[],
): DocumentedFields {
  const controlMode = config.controlMode ?? URDF_DEFAULTS.controlMode;
  const showAxis = config.showAxis ?? false;
  return {
    controlMode: {
      label: "Control mode",
      help: "Transforms places each link from the transform tree. Joint states computes the link poses from joint positions on a topic, starting at the root link's transform.",
      input: "select",
      options: [
        { label: "Transforms", value: "transforms" },
        { label: "Joint states", value: "jointStates" },
      ],
      value: controlMode,
    },
    jointStatesTopic:
      controlMode === "jointStates"
        ? {
            label: "Joint states",
            help: "Topic with joint positions (sensor_msgs/JointState). Empty uses the first one available. Joints it does not list use their manual value, or zero.",
            input: "autocomplete",
            items: [...jointStateTopics],
            value: resolveJointStatesTopic(config, jointStateTopics) ?? "",
          }
        : undefined,
    displayMode: {
      label: "Display mode",
      help: "Visual draws the visual meshes, Collision the collision geometry. Auto draws visuals, and collision geometry for links without visuals.",
      input: "select",
      options: [
        { label: "Auto", value: "auto" },
        { label: "Visual", value: "visual" },
        { label: "Collision", value: "collision" },
      ],
      value: config.displayMode ?? URDF_DEFAULTS.displayMode,
    },
    fallbackColor: {
      label: "Color",
      help: "Fallback color used in case a link does not specify any color itself",
      input: "rgb",
      value: config.fallbackColor ?? URDF_DEFAULTS.fallbackColor,
    },
    opacity: {
      label: "Opacity",
      help: "Multiplies the transparency of every link, including meshes with their own materials.",
      input: "number",
      min: 0,
      max: 1,
      step: 0.1,
      precision: 2,
      value: config.opacity ?? URDF_DEFAULTS.opacity,
    },
    showOutlines: {
      label: "Show outlines",
      help: "Draws edges around the link geometry.",
      input: "boolean",
      value: config.showOutlines ?? URDF_DEFAULTS.showOutlines,
    },
    showAxis: {
      label: "Show axis",
      help: "Draws the coordinate axes of every link.",
      input: "boolean",
      value: showAxis,
    },
    axisScale: showAxis
      ? {
          label: "Axis scale",
          help: "Size of the link axes; 1 draws them at the default length.",
          input: "number",
          min: 0,
          step: 0.1,
          precision: 2,
          value: config.axisScale ?? URDF_DEFAULTS.axisScale,
        }
      : undefined,
  };
}

/** A robot description from a topic or parameter. `children`: its joints, see `urdfJointsNodes`. */
export function urdfSettingsNode(
  label: string,
  config: Partial<LayerSettingsUrdf>,
  jointStateTopics: readonly string[],
  children: DocumentedNodes,
): DocumentedNode {
  return {
    label,
    icon: "PrecisionManufacturing",
    fields: urdfRobotFields(config, jointStateTopics),
    visible: config.visible ?? URDF_DEFAULTS.visible,
    children,
  };
}

/**
 * `topics`/`parameters`: names that hold a robot description, offered in the source pickers.
 * `jointStateTopics`: topics with joint states, offered in joint states mode.
 */
export function customUrdfSettingsNode(
  config: Partial<LayerSettingsCustomUrdf>,
  topics: string[],
  parameters: string[],
  jointStateTopics: readonly string[],
  children: DocumentedNodes,
): DocumentedNode {
  const sourceType = config.sourceType ?? CUSTOM_URDF_DEFAULTS.sourceType;
  const fields: DocumentedFields = {
    sourceType: {
      label: "Source",
      help: "Where the robot description comes from.",
      input: "select",
      value: sourceType,
      options: [
        { label: "URL", value: "url" },
        { label: "File path (Desktop only)", value: "filePath", disabled: !isDesktopApp() },
        { label: "Parameter", value: "param" },
        { label: "Topic", value: "topic" },
      ],
    },
    url:
      sourceType === "url"
        ? {
            label: "URL",
            input: "string",
            placeholder: "package://",
            help: "package:// URL or http(s) URL pointing to a Unified Robot Description Format (URDF) XML file",
            value: config.url ?? CUSTOM_URDF_DEFAULTS.url,
          }
        : undefined,
    filePath:
      sourceType === "filePath"
        ? {
            label: "File path",
            input: "string",
            help: "Absolute file path (desktop app only)",
            value: config.filePath ?? CUSTOM_URDF_DEFAULTS.filePath,
            disabled: !isDesktopApp(),
          }
        : undefined,
    topic:
      sourceType === "topic"
        ? {
            label: "Topic",
            help: "Topic that publishes the robot description.",
            input: "autocomplete",
            value: config.topic ?? CUSTOM_URDF_DEFAULTS.topic,
            items: topics,
          }
        : undefined,
    parameter:
      sourceType === "param"
        ? {
            label: "Parameter",
            help: "String parameter that holds the robot description.",
            input: "autocomplete",
            value: config.parameter ?? CUSTOM_URDF_DEFAULTS.parameter,
            items: parameters,
          }
        : undefined,
    label: {
      label: "Label",
      help: "Name of this layer in the settings.",
      input: "string",
      value: config.label ?? CUSTOM_URDF_DEFAULTS.label,
    },
    framePrefix: {
      label: "Frame prefix",
      input: "string",
      help: "Prefix to apply to all frame names (also often called tfPrefix)",
      placeholder: "Frame prefix",
      value: config.framePrefix ?? "",
    },
    ...urdfRobotFields(config, jointStateTopics),
  };
  return {
    label: config.label ?? CUSTOM_URDF_DEFAULTS.label,
    icon: "PrecisionManufacturing",
    fields,
    visible: config.visible ?? CUSTOM_URDF_DEFAULTS.visible,
    actions: [
      { type: "action", id: "duplicate", label: "Duplicate" },
      { type: "action", id: "delete", label: "Delete" },
    ],
    order: config.order,
    children,
  };
}

const RAD2DEG = 180 / Math.PI;
const XYZ_LABEL: [string, string, string] = ["X", "Y", "Z"];
const RPY_LABEL: [string, string, string] = ["R", "P", "Y"];

function readonlyNumber(label: string, help: string, value: number): DocumentedField {
  return { label, help, input: "number", precision: PRECISION_DISTANCE, readonly: true, value };
}

/**
 * One joint's node. `manual`: the manually set angle (degrees) or position (m), if any;
 * `jointState`: the latest JointState position (radians or m), if any.
 */
export function urdfJointNode(
  joint: UrdfJoint,
  manual: number | undefined,
  jointState: number | undefined,
): DocumentedNode {
  const { x, y, z } = joint.origin.xyz;
  const { x: roll, y: pitch, z: yaw } = joint.origin.rpy;
  const { x: aX, y: aY, z: aZ } = joint.axis;
  const fields: DocumentedFields = {};
  fields.jointType = {
    label: "Type",
    help: "URDF joint type.",
    input: "string",
    readonly: true,
    value: joint.jointType,
  };

  switch (joint.jointType) {
    case "fixed":
      break;
    case "continuous":
    case "revolute": {
      const min = joint.limit ? joint.limit.lower * RAD2DEG : -180;
      const max = joint.limit ? joint.limit.upper * RAD2DEG : 180;
      fields.manual = {
        label: "Manual angle",
        help: "Sets the joint angle in degrees by hand, for robots without JointState messages.",
        input: "number",
        precision: PRECISION_DEGREES,
        step: 1,
        min,
        max,
        value: manual,
      };
      if (jointState != undefined) {
        fields.jointState = {
          label: "JointState angle",
          help: "Latest angle from JointState messages, in degrees.",
          input: "number",
          precision: PRECISION_DEGREES,
          min,
          max,
          readonly: true,
          value: jointState * RAD2DEG,
        };
      }
      break;
    }
    case "prismatic": {
      const min = joint.limit?.lower;
      const max = joint.limit?.upper;
      fields.manual = {
        label: "Manual position",
        help: "Sets the joint position in meters by hand, for robots without JointState messages.",
        input: "number",
        precision: PRECISION_DISTANCE,
        step: 0.01,
        min,
        max,
        value: manual,
      };
      if (jointState != undefined) {
        fields.jointState = {
          label: "JointState position",
          help: "Latest position from JointState messages, in meters.",
          input: "number",
          precision: PRECISION_DISTANCE,
          min,
          max,
          readonly: true,
          value: jointState,
        };
      }
      break;
    }
    case "floating":
    case "planar":
      // Motion could be supported for these types in the future
      break;
  }

  fields.position = {
    label: "Position",
    help: "Joint origin in the parent link, in meters.",
    input: "vec3",
    labels: XYZ_LABEL,
    precision: PRECISION_DISTANCE,
    readonly: true,
    value: [x, y, z],
  };
  fields.rotation = {
    label: "Rotation",
    help: "Joint origin rotation (roll, pitch, yaw) in degrees.",
    input: "vec3",
    labels: RPY_LABEL,
    precision: PRECISION_DEGREES,
    readonly: true,
    value: [roll * RAD2DEG, pitch * RAD2DEG, yaw * RAD2DEG],
  };
  fields.parent = {
    label: "Parent",
    help: "Parent link.",
    input: "string",
    readonly: true,
    value: joint.parent,
  };
  fields.child = {
    label: "Child",
    help: "Child link.",
    input: "string",
    readonly: true,
    value: joint.child,
  };
  if (joint.jointType !== "fixed") {
    fields.axis = {
      label: "Axis",
      help: "Axis the joint rotates around or moves along.",
      input: "vec3",
      labels: XYZ_LABEL,
      precision: PRECISION_DISTANCE,
      readonly: true,
      value: [aX, aY, aZ],
    };
  }
  if (joint.calibration) {
    const { rising, falling } = joint.calibration;
    fields.calibration = {
      label: "Calibration",
      help: "Rising and falling edge reference positions from the URDF.",
      input: "vec2",
      labels: ["↑", "↓"],
      readonly: true,
      value: [rising, falling],
    };
  }
  if (joint.dynamics) {
    const { damping, friction } = joint.dynamics;
    fields.damping = readonlyNumber("Damping", "Damping from the URDF.", damping);
    fields.friction = readonlyNumber("Friction", "Friction from the URDF.", friction);
  }
  if (joint.limit) {
    const { effort, velocity } = joint.limit;
    if (joint.jointType !== "continuous" && joint.jointType !== "fixed") {
      const { upper, lower } = joint.limit;
      const isAngular = joint.jointType === "revolute";
      fields.limit = {
        label: "Limit",
        help: "Upper and lower limit from the URDF (degrees or meters).",
        input: "vec2",
        labels: ["↑", "↓"],
        readonly: true,
        precision: isAngular ? PRECISION_DEGREES : PRECISION_DISTANCE,
        value: isAngular ? [upper * RAD2DEG, lower * RAD2DEG] : [upper, lower],
      };
    }
    fields.effort = readonlyNumber("Limit effort", "Maximum effort from the URDF.", effort);
    fields.velocity = readonlyNumber("Limit velocity", "Maximum velocity from the URDF.", velocity);
  }
  if (joint.mimic) {
    const { joint: mimicJoint, multiplier, offset } = joint.mimic;
    fields.mimicJoint = {
      label: "Mimic joint",
      help: "Joint this joint follows.",
      input: "string",
      readonly: true,
      value: mimicJoint,
    };
    fields.mimicMultiplier = readonlyNumber(
      "Mimic multiplier",
      "Factor applied to the mimicked joint's position.",
      multiplier,
    );
    fields.mimicOffset = readonlyNumber(
      "Mimic offset",
      "Offset added to the mimicked joint's position.",
      offset,
    );
  }
  if (joint.safetyController) {
    const { softUpperLimit, softLowerLimit, kPosition, kVelocity } = joint.safetyController;
    fields.softLimit = {
      label: "Soft limit",
      help: "Safety controller's upper and lower soft limits.",
      input: "vec2",
      labels: ["↑", "↓"],
      readonly: true,
      value: [softUpperLimit, softLowerLimit],
    };
    fields.kPosition = readonlyNumber("k_position", "Safety controller position gain.", kPosition);
    fields.kVelocity = readonlyNumber("k_velocity", "Safety controller velocity gain.", kVelocity);
  }
  return { label: joint.name, fields, defaultExpansionState: "collapsed" };
}

/** The "Joints" child of a robot node. */
export function urdfJointsNodes(joints: DocumentedNodes): DocumentedNodes {
  return { joints: { label: "Joints", defaultExpansionState: "collapsed", children: joints } };
}

/** Per-link overrides, keyed by the link name without the frame prefix. */
export type UrdfLinkSettings = {
  visible?: boolean;
  /** Offset in the link frame, meters */
  position?: [number, number, number];
  /** Offset rotation (roll, pitch, yaw) in the link frame, degrees */
  rotation?: [number, number, number];
};

/** One link's node: its visibility toggle and offset. */
export function urdfLinkNode(name: string, settings: UrdfLinkSettings | undefined): DocumentedNode {
  return {
    label: name,
    defaultExpansionState: "collapsed",
    visible: settings?.visible ?? true,
    fields: {
      position: {
        label: "Offset",
        help: "Moves the link's geometry and axis within the link frame, in meters. Links attached below are not moved.",
        input: "vec3",
        labels: XYZ_LABEL,
        precision: PRECISION_DISTANCE,
        step: 0.01,
        value: settings?.position ?? [0, 0, 0],
      },
      rotation: {
        label: "Rotation",
        help: "Rotates the link's geometry and axis within the link frame (roll, pitch, yaw) in degrees.",
        input: "vec3",
        labels: RPY_LABEL,
        precision: PRECISION_DEGREES,
        step: 1,
        value: settings?.rotation ?? [0, 0, 0],
      },
    },
  };
}

/** The links section of a URDF node. `links`: one `urdfLinkNode` per link. */
export function urdfLinksNodes(links: DocumentedNodes): DocumentedNodes {
  return { links: { label: "Links", defaultExpansionState: "collapsed", children: links } };
}

// ---- Map ----

export const MAP_LAYER_ID = "lichtblick.Map";

/** The 3D panel renders 3D Tiles on top of what the Map panel offers. */
export const MAP_LAYER_SOURCE_KINDS: readonly SourceKind[] = [...MAP_SOURCE_KINDS, "3dtiles"];

export const MAP_DEFAULTS: LayerSettingsMap = {
  visible: true,
  frameLocked: true,
  label: "Map",
  instanceId: "invalid",
  layerId: MAP_LAYER_ID,
  layers: [{ id: "base", source: "ofm-liberty", visible: true, opacity: 1 }],
  zOffset: 0,
};

/** `layerError`: the error of one map layer, if any. */
export function mapSettingsNode(
  config: LayerSettingsMap,
  locationTopics: string[],
  frameOptions: SelectOption[],
  saved: readonly SourceParams[],
  sourceKinds: readonly SourceKind[],
  layerError: (layer: MapLayer) => string | undefined,
): DocumentedNode {
  return {
    label: config.label,
    icon: "Map",
    fields: {
      locationTopic: {
        label: "Location topic",
        input: "select",
        options: [
          { label: "Auto", value: undefined },
          ...locationTopics.map((topic) => ({ label: topic, value: topic })),
        ],
        value: config.locationTopic,
        help: "NavSatFix or LocationFix topic that places the map. For fixes without a frame_id, select the location frame; otherwise the fix is placed at the ENU frame's origin.",
      },
      locationFrame: {
        label: t("threeDee:locationFrame"),
        input: "select",
        options: [
          { label: t("threeDee:locationFrameFromMessage"), value: undefined },
          ...frameOptions,
        ],
        value: config.locationFrame,
        help: t("threeDee:locationFrameHelp"),
      },
      enuFrame: {
        label: "ENU frame",
        input: "select",
        options: [{ label: "<Fixed frame>", value: undefined }, ...frameOptions],
        value: config.enuFrame,
        help: "Frame whose X axis points east, Y north and Z up.",
      },
      zOffset: {
        label: "Z offset",
        input: "number",
        step: 0.1,
        precision: PRECISION_DISTANCE,
        value: config.zOffset,
        help: "Height of the map's ground in meters above the location fix's frame",
      },
    },
    visible: config.visible,
    actions: [...layerStackActions(saved), deleteAction()],
    children: layerStackChildren(config.layers, saved, sourceKinds, layerError),
    order: config.order,
  };
}
