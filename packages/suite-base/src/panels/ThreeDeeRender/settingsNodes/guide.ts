// SPDX-License-Identifier: MPL-2.0

// The settings trees shown in the 3D and Image panel guides, built by the same builders the
// panels use. Topic layers get one representative node per kind; where fields depend on another
// setting (color mode, display type, …) the variants are merged so every field appears once.

import { t } from "i18next";

import type { Topic } from "@lichtblick/suite";
import type {
  DocumentedFields,
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import {
  customLayersRootNode,
  frameFields,
  frameSettingsNode,
  publishSettingsNode,
  sceneSettingsNode,
  topicsRootNode,
  transformSettingsNode,
  viewSettingsNode,
} from "./global";
import { DEFAULT_IMAGE_CONFIG, imageAnnotationsRootNode, imageModeSettingsNode } from "./imageMode";
import {
  customUrdfSettingsNode,
  gridSettingsNode,
  MAP_DEFAULTS,
  MAP_LAYER_SOURCE_KINDS,
  mapSettingsNode,
  urdfJointNode,
  urdfJointsNodes,
  urdfSettingsNode,
} from "./layers";
import {
  cameraInfoSettingsNode,
  foxgloveGridSettingsNode,
  imageProjectionSettingsNode,
  laserScanSettingsNode,
  markerSettingsNode,
  occupancyGridSettingsNode,
  pointCloudSettingsNode,
  polygonSettingsNode,
  poseArraySettingsNode,
  poseSettingsNode,
  sceneEntitySettingsNode,
} from "./topics";
import type { RendererConfig } from "../IRenderer";
import { DEFAULT_FOLLOW_MODE } from "../constants";
import { DEFAULT_CAMERA_STATE, DEFAULT_MESH_UP_AXIS, DEFAULT_PUBLISH_SETTINGS } from "../defaults";
import { POINTCLOUD_DATATYPES } from "../ros";

/** One node with the fields of all `variants`, labeled `label`. */
function merged(label: string, ...variants: DocumentedNode[]): DocumentedNode {
  const fields: DocumentedFields = {};
  for (const node of variants) {
    for (const [key, field] of Object.entries(node.fields ?? {})) {
      if (field != undefined) {
        fields[key] = field;
      }
    }
  }
  return { ...variants[0], label, fields };
}

const COLOR_MODES = ["flat", "gradient", "colormap"] as const;

const config: RendererConfig = {
  cameraState: DEFAULT_CAMERA_STATE,
  followTf: undefined,
  followMode: DEFAULT_FOLLOW_MODE,
  // Editable shows the adjustment fields, which are hidden by default.
  scene: { transforms: { editable: true } },
  transforms: {},
  topics: {},
  layers: {},
  publish: DEFAULT_PUBLISH_SETTINGS,
  imageMode: {},
};

function topicNodes(): DocumentedNodes {
  const topic = (schemaName: string): Topic => ({ name: "", schemaName });
  const pointCloud = topic([...POINTCLOUD_DATATYPES][0]!);
  const fields = ["x", "y", "z", "intensity"];
  const example = urdfJointNode(
    {
      name: "joint",
      jointType: "revolute",
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
      parent: "parent_link",
      child: "child_link",
      axis: { x: 0, y: 0, z: 1 },
      calibration: { rising: 0, falling: 0 },
      dynamics: { damping: 0, friction: 0 },
      limit: { lower: -1, upper: 1, effort: 0, velocity: 0 },
      mimic: { joint: "other_joint", multiplier: 1, offset: 0 },
      safetyController: { softLowerLimit: -1, softUpperLimit: 1, kPosition: 0, kVelocity: 0 },
    },
    undefined,
    0,
  );
  return {
    pointCloud: merged(
      "Point cloud",
      ...COLOR_MODES.map((colorMode) => pointCloudSettingsNode(pointCloud, fields, { colorMode })),
      pointCloudSettingsNode(pointCloud, fields, { pointShape: "cube" }),
    ),
    laserScan: { ...laserScanSettingsNode(topic(""), {}), label: "Laser scan" },
    marker: markerSettingsNode({ name: "Marker" }, {}),
    sceneEntity: sceneEntitySettingsNode({ name: "Scene entities" }, {}),
    pose: merged(
      "Pose",
      poseSettingsNode(topic(""), { type: "axis" }, { hasCovariance: true }),
      poseSettingsNode(topic(""), { type: "arrow" }, { hasCovariance: true }),
    ),
    poseArray: merged(
      "Pose array and path",
      ...(["axis", "arrow", "line"] as const).map((type) =>
        poseArraySettingsNode(topic(""), { type }),
      ),
    ),
    polygon: polygonSettingsNode({ name: "Polygon" }, {}),
    occupancyGrid: merged(
      "Occupancy grid",
      occupancyGridSettingsNode(topic(""), { colorMode: "custom" }),
      occupancyGridSettingsNode(topic(""), { colorMode: "map" }),
    ),
    grid: merged(
      "Grid",
      ...COLOR_MODES.map((colorMode) => foxgloveGridSettingsNode(topic(""), { colorMode }, fields)),
    ),
    cameraInfo: { ...cameraInfoSettingsNode(topic(""), {}), label: "Camera calibration" },
    image: merged(
      "Image",
      imageProjectionSettingsNode(topic(""), {}, []),
      imageProjectionSettingsNode(topic(""), { renderMode: "plane" }, []),
      ...COLOR_MODES.map((colorMode) =>
        imageProjectionSettingsNode(topic(""), { renderMode: "depth", colorMode }, []),
      ),
    ),
    urdf: urdfSettingsNode("Robot description", {}, urdfJointsNodes({ example })),
  };
}

function layerNodes(): DocumentedNodes {
  return {
    grid: gridSettingsNode({}, []),
    urdf: merged(
      "URDF",
      ...(["url", "filePath", "topic", "param"] as const).map((sourceType) =>
        customUrdfSettingsNode({ sourceType }, [], [], {}),
      ),
    ),
    map: mapSettingsNode(MAP_DEFAULTS, [], [], [], MAP_LAYER_SOURCE_KINDS, () => undefined),
  };
}

/** The 3D panel's settings for the panel guide. */
export function threeDeeGuideSettings(): DocumentedNodes {
  const frameNode = {
    label: t("threeDee:frame"),
    fields: frameFields(
      {
        parentFrameId: "parent",
        age: undefined,
        historySize: 1,
        adjusted: { offsetXyz: [0, 0, 0], offsetRpy: [0, 0, 0] },
      },
      config,
      undefined,
    ),
  };
  return {
    general: frameSettingsNode(config, [], undefined),
    cameraState: viewSettingsNode(config, undefined),
    scene: sceneSettingsNode(config.scene, {
      debugPicking: false,
      loaded: { ignoreColladaUpAxis: false, meshUpAxis: DEFAULT_MESH_UP_AXIS },
    }),
    transforms: {
      label: t("threeDee:transforms"),
      help: t("threeDee:transformsHelp"),
      children: {
        settings: transformSettingsNode(config, {
          keyboardFrames: [],
          showOriginal: false,
          hasOffsets: true,
        }),
        frame: frameNode,
      },
    },
    topics: { ...topicsRootNode(), children: topicNodes() },
    layers: { ...customLayersRootNode(0, []), children: layerNodes() },
    publish: publishSettingsNode({ ...config.publish, type: "pose_estimate" }),
  };
}

/** The Image panel's settings for the panel guide. */
export function imageGuideSettings(): DocumentedNodes {
  return {
    imageMode: merged(
      "General",
      ...(["gradient", "colormap"] as const).map((colorMode) =>
        imageModeSettingsNode(
          { ...DEFAULT_IMAGE_CONFIG, colorMode },
          { imageTopics: [], calibrationTopics: [], errors: {}, showColorMode: true },
        ),
      ),
    ),
    imageAnnotations: imageAnnotationsRootNode(),
  };
}
