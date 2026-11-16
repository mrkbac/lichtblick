// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Settings nodes for the 3D panel's topic layers, shared by the scene extensions and the panel
// guide. Kept free of three.js: heavy modules are only imported for their types.

import { t } from "i18next";

import type { Topic } from "@lichtblick/suite";
import type {
  DocumentedFields,
  DocumentedNode,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";

import { colorModeSettingsFields, type ColorModeSettings } from "./colorMode";
import { POINTCLOUD_DATATYPES as LICHTBLICK_POINTCLOUD_DATATYPES } from "../foxglove";
import type { LayerSettingsCameraInfo } from "../renderables/Cameras";
import type { LayerSettingsFoxgloveGrid } from "../renderables/FoxgloveGrid";
import type { ImageRenderableSettings } from "../renderables/Images/ImageRenderable";
import type { LayerSettingsOccupancyGrid } from "../renderables/OccupancyGrids";
import type { LayerSettingsPolygon } from "../renderables/Polygons";
import type { LayerSettingsPoseArray } from "../renderables/PoseArrays";
import type { LayerSettingsPose } from "../renderables/Poses";
import type { LayerSettingsMarker } from "../renderables/TopicMarkers";
import { NAV_PATH_DATATYPES, POINTCLOUD_DATATYPES as ROS_POINTCLOUD_DATATYPES } from "../ros";
import {
  AXIS_LENGTH,
  type BaseSettings,
  fieldGradient,
  fieldLineWidth,
  fieldScaleVec3,
  fieldSize,
  type LayerSettingsEntity,
  PRECISION_DISTANCE,
  rgbaToCssString,
  SELECTED_ID_VARIABLE,
} from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";

const PRIMARY = { r: 124 / 255, g: 107 / 255, b: 1, a: 1 };

// ---- Markers and scene entities ----

export const MARKER_DEFAULTS: LayerSettingsMarker = {
  visible: false,
  showOutlines: true,
  color: undefined,
  selectedIdVariable: undefined,
  namespaces: {},
};

export const SCENE_ENTITY_DEFAULTS: LayerSettingsEntity = {
  showOutlines: true,
  visible: false,
  color: undefined,
  selectedIdVariable: undefined,
};

export function markerSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsMarker>,
): DocumentedNode {
  return {
    label: topic.name,
    icon: "Shapes",
    order: topic.name.toLocaleLowerCase(),
    fields: {
      color: {
        label: t("threeDee:color"),
        help: t("threeDee:markerColorHelp"),
        input: "rgba",
        value: config.color,
      },
      showOutlines: {
        label: t("threeDee:showOutline"),
        help: t("threeDee:showOutlineHelp"),
        input: "boolean",
        value: config.showOutlines ?? MARKER_DEFAULTS.showOutlines,
      },
      showLabels: {
        label: t("threeDee:showLabels"),
        help: t("threeDee:showLabelsHelp"),
        input: "boolean",
        value: config.showLabels ?? true,
      },
      selectedIdVariable: {
        label: t("threeDee:selectionVariable"),
        input: "string",
        help: t("threeDee:selectionVariableHelp"),
        value: config.selectedIdVariable,
        placeholder: SELECTED_ID_VARIABLE,
      },
    },
    visible: config.visible ?? MARKER_DEFAULTS.visible,
  };
}

export function sceneEntitySettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsEntity>,
): DocumentedNode {
  return {
    label: topic.name,
    icon: "Shapes",
    order: topic.name.toLocaleLowerCase(),
    fields: {
      color: {
        label: "Color",
        help: "Overrides the color of every entity on this topic.",
        input: "rgba",
        value: config.color,
      },
      showOutlines: {
        label: "Show outlines",
        help: "Draws dark edges around cubes, spheres, cylinders, arrows and models.",
        input: "boolean",
        value: config.showOutlines ?? SCENE_ENTITY_DEFAULTS.showOutlines,
      },
      showLabels: {
        label: t("threeDee:showLabels"),
        help: t("threeDee:showLabelsHelp"),
        input: "boolean",
        value: config.showLabels ?? true,
      },
      selectedIdVariable: {
        label: "Selection Variable",
        input: "string",
        help: "When selecting a SceneEntity, this global variable will be set to the entity ID",
        value: config.selectedIdVariable,
        placeholder: SELECTED_ID_VARIABLE,
      },
    },
    visible: config.visible ?? SCENE_ENTITY_DEFAULTS.visible,
  };
}

// ---- Polygons ----

export const POLYGON_DEFAULTS: LayerSettingsPolygon = {
  visible: false,
  lineWidth: 0.1,
  color: rgbaToCssString(PRIMARY),
};

export function polygonSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsPolygon>,
): DocumentedNode {
  return {
    label: topic.name,
    icon: "Star",
    fields: {
      lineWidth: {
        label: "Line Width",
        help: "Width of the outline in meters.",
        input: "number",
        min: 0,
        placeholder: String(POLYGON_DEFAULTS.lineWidth),
        step: 0.005,
        precision: 3,
        value: config.lineWidth,
      },
      color: {
        label: "Color",
        help: "Color of the outline.",
        input: "rgba",
        value: config.color ?? POLYGON_DEFAULTS.color,
      },
    },
    visible: config.visible ?? POLYGON_DEFAULTS.visible,
  };
}

// ---- Poses ----

export const POSE_DEFAULTS: LayerSettingsPose = {
  type: "axis",
  visible: false,
  axisScale: AXIS_LENGTH,
  arrowScale: [1, 0.15, 0.15],
  color: rgbaToCssString(PRIMARY),
  showCovariance: true,
  covarianceColor: rgbaToCssString({ r: 198 / 255, g: 107 / 255, b: 1, a: 0.25 }),
};

function poseTypeField(
  value: string,
  options: { label: string; value: string }[],
  help: string,
): DocumentedFields {
  return { type: { label: t("threeDee:type"), help, input: "select", options, value } };
}

/** `hasCovariance`: the topic carries a covariance (PoseWithCovarianceStamped). */
export function poseSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsPose>,
  { hasCovariance }: { hasCovariance: boolean },
): DocumentedNode {
  const type = config.type ?? POSE_DEFAULTS.type;
  const fields = poseTypeField(
    type,
    [
      { label: t("threeDee:poseDisplayTypeAxis"), value: "axis" },
      { label: t("threeDee:poseDisplayTypeArrow"), value: "arrow" },
    ],
    t("threeDee:poseTypeHelp"),
  );
  if (type === "axis") {
    fields.axisScale = {
      label: t("threeDee:scale"),
      help: t("threeDee:axisLengthHelp"),
      input: "number",
      step: 0.5,
      min: 0,
      precision: PRECISION_DISTANCE,
      value: config.axisScale ?? POSE_DEFAULTS.axisScale,
    };
  } else {
    fields.arrowScale = fieldScaleVec3(
      t("threeDee:scale"),
      t("threeDee:arrowScaleHelp"),
      config.arrowScale ?? POSE_DEFAULTS.arrowScale,
    );
    fields.color = {
      label: t("threeDee:color"),
      help: t("threeDee:arrowColorHelp"),
      input: "rgba",
      value: config.color ?? POSE_DEFAULTS.color,
    };
  }

  if (hasCovariance) {
    const showCovariance = config.showCovariance ?? POSE_DEFAULTS.showCovariance;
    fields.showCovariance = {
      label: t("threeDee:covariance"),
      help: t("threeDee:covarianceHelp"),
      input: "boolean",
      value: showCovariance,
    };
    if (showCovariance) {
      fields.covarianceColor = {
        label: t("threeDee:covarianceColor"),
        help: t("threeDee:covarianceColorHelp"),
        input: "rgba",
        value: config.covarianceColor ?? POSE_DEFAULTS.covarianceColor,
      };
    }
  }

  return {
    label: topic.name,
    icon: "Flag",
    fields,
    visible: config.visible ?? POSE_DEFAULTS.visible,
    order: topic.name.toLocaleLowerCase(),
  };
}

// ---- Pose arrays and paths ----

export const POSE_ARRAY_DEFAULTS: LayerSettingsPoseArray = {
  visible: false,
  type: "axis",
  axisScale: AXIS_LENGTH,
  arrowScale: [1, 0.15, 0.15],
  lineWidth: 0.2,
  gradient: [rgbaToCssString(PRIMARY), rgbaToCssString({ ...PRIMARY, a: 0.5 })],
};

/** Paths default to a line, other pose arrays to axes. */
export function poseArrayDefaultType(
  topic: Pick<Topic, "schemaName"> | undefined,
): LayerSettingsPoseArray["type"] {
  return topic != undefined && NAV_PATH_DATATYPES.has(topic.schemaName)
    ? "line"
    : POSE_ARRAY_DEFAULTS.type;
}

export function poseArraySettingsNode(
  topic: Pick<Topic, "name" | "schemaName" | "convertibleTo">,
  config: Partial<LayerSettingsPoseArray>,
): DocumentedNode {
  const displayType = config.type ?? poseArrayDefaultType(topic);
  const fields = poseTypeField(
    displayType,
    [
      { label: t("threeDee:poseDisplayTypeAxis"), value: "axis" },
      { label: t("threeDee:poseDisplayTypeArrow"), value: "arrow" },
      { label: t("threeDee:poseDisplayTypeLine"), value: "line" },
    ],
    t("threeDee:poseArrayTypeHelp"),
  );
  switch (displayType) {
    case "axis":
      fields.axisScale = fieldSize(
        t("threeDee:scale"),
        t("threeDee:axisLengthHelp"),
        config.axisScale,
        POSE_ARRAY_DEFAULTS.axisScale,
      );
      break;
    case "arrow":
      fields.arrowScale = fieldScaleVec3(
        t("threeDee:scale"),
        t("threeDee:arrowScaleHelp"),
        config.arrowScale ?? POSE_ARRAY_DEFAULTS.arrowScale,
      );
      break;
    case "line":
      fields.lineWidth = fieldLineWidth(
        t("threeDee:lineWidth"),
        t("threeDee:pathLineWidthHelp"),
        config.lineWidth,
        POSE_ARRAY_DEFAULTS.lineWidth,
      );
      break;
  }

  // Axis does not currently support gradients. This could possibly be done with tinting
  if (displayType !== "axis") {
    fields.gradient = fieldGradient(
      t("threeDee:gradient"),
      t("threeDee:poseGradientHelp"),
      config.gradient ?? POSE_ARRAY_DEFAULTS.gradient,
    );
  }

  return {
    label: topic.name,
    icon: topicIsConvertibleToSchema(topic, NAV_PATH_DATATYPES) ? "Timeline" : "Flag",
    fields,
    visible: config.visible ?? POSE_ARRAY_DEFAULTS.visible,
  };
}

// ---- Occupancy grids ----

export const OCCUPANCY_GRID_DEFAULTS: LayerSettingsOccupancyGrid = {
  visible: false,
  frameLocked: false,
  colorMode: "custom",
  minColor: rgbaToCssString({ r: 1, g: 1, b: 1, a: 1 }), // white
  maxColor: rgbaToCssString({ r: 0, g: 0, b: 0, a: 1 }), // black
  unknownColor: rgbaToCssString({ r: 0.5, g: 0.5, b: 0.5, a: 1 }), // gray
  invalidColor: rgbaToCssString({ r: 1, g: 0, b: 1, a: 1 }), // magenta
  alpha: 1.0,
};

function frameLockField(label: string, config: { frameLocked?: boolean }): DocumentedFields {
  return {
    frameLocked: {
      label,
      help: t("threeDee:frameLockHelp"),
      input: "boolean",
      value: config.frameLocked,
    },
  };
}

export function occupancyGridSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsOccupancyGrid>,
): DocumentedNode {
  const settings = { ...OCCUPANCY_GRID_DEFAULTS, ...config };
  const fields: DocumentedFields = {
    colorMode: {
      label: t("threeDee:colorMode"),
      help: t("threeDee:occupancyColorModeHelp"),
      input: "select",
      value: settings.colorMode,
      options: [
        { label: t("threeDee:colorModeCustom"), value: "custom" },
        { label: t("threeDee:colorModeRvizMap"), value: "map" },
        { label: t("threeDee:colorModeRvizCostmap"), value: "costmap" },
        { label: t("threeDee:colorModeRaw"), value: "raw" },
      ],
    },
  };

  if (settings.colorMode === "custom") {
    fields.minColor = {
      label: t("threeDee:minColor"),
      help: t("threeDee:minColorHelp"),
      input: "rgba",
      value: settings.minColor,
    };
    fields.maxColor = {
      label: t("threeDee:maxColor"),
      help: t("threeDee:maxColorHelp"),
      input: "rgba",
      value: settings.maxColor,
    };
    fields.unknownColor = {
      label: t("threeDee:unknownColor"),
      help: t("threeDee:unknownColorHelp"),
      input: "rgba",
      value: settings.unknownColor,
    };
    fields.invalidColor = {
      label: t("threeDee:invalidColor"),
      help: t("threeDee:invalidColorHelp"),
      input: "rgba",
      value: settings.invalidColor,
    };
  } else {
    fields.alpha = {
      label: "Alpha",
      help: "Opacity of the palette colors.",
      input: "number",
      value: settings.alpha,
      min: 0.0,
      max: 1.0,
      step: 0.1,
      placeholder: "auto",
    };
  }

  Object.assign(fields, frameLockField(t("threeDee:frameLock"), settings));

  return {
    label: topic.name,
    icon: "Cells",
    fields,
    visible: settings.visible,
    order: topic.name.toLocaleLowerCase(),
  };
}

// ---- Foxglove grids ----

export const FOXGLOVE_GRID_DEFAULTS: LayerSettingsFoxgloveGrid = {
  visible: false,
  frameLocked: false,
  colorMode: "flat",
  minValue: undefined,
  maxValue: undefined,
  flatColor: rgbaToCssString({ r: 1, g: 1, b: 1, a: 1 }),
  colorField: undefined,
  gradient: [
    rgbaToCssString({ r: 100 / 255, g: 47 / 255, b: 105 / 255, a: 1 }),
    rgbaToCssString({ r: 227 / 255, g: 177 / 255, b: 135 / 255, a: 1 }),
  ],
  colorMap: "turbo",
  explicitAlpha: 1,
};

/** `msgFields`: the grid's cell fields, once a message arrived. */
export function foxgloveGridSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsFoxgloveGrid>,
  msgFields: string[] | undefined,
): DocumentedNode {
  return {
    order: topic.name.toLocaleLowerCase(),
    icon: "Cells",
    visible: config.visible ?? FOXGLOVE_GRID_DEFAULTS.visible,
    fields: {
      ...colorModeSettingsFields({
        msgFields,
        config,
        defaults: FOXGLOVE_GRID_DEFAULTS,
        modifiers: { supportsPackedRgbModes: false, supportsRgbaFieldsMode: true },
      }),
      ...frameLockField("Frame lock", { ...FOXGLOVE_GRID_DEFAULTS, ...config }),
    },
  };
}

// ---- Camera calibrations and image projections ----

export const DEFAULT_PROJECTION_DISTANCE = 1;
export const DEFAULT_PLANAR_PROJECTION_FACTOR = 0;

export const CAMERA_INFO_DEFAULTS: LayerSettingsCameraInfo = {
  visible: false,
  frameLocked: true,
  distance: DEFAULT_PROJECTION_DISTANCE,
  planarProjectionFactor: DEFAULT_PLANAR_PROJECTION_FACTOR,
  width: 0.01,
  color: rgbaToCssString(PRIMARY),
};

function projectionFields(
  config: { distance?: number; planarProjectionFactor?: number },
  distanceHelp: string,
): DocumentedFields {
  return {
    distance: {
      label: t("threeDee:distance"),
      help: distanceHelp,
      input: "number",
      placeholder: String(DEFAULT_PROJECTION_DISTANCE),
      step: 0.1,
      precision: PRECISION_DISTANCE,
      value: config.distance,
    },
    planarProjectionFactor: {
      label: t("threeDee:planarProjectionFactor"),
      help: t("threeDee:planarProjectionFactorHelp"),
      input: "number",
      placeholder: String(DEFAULT_PLANAR_PROJECTION_FACTOR),
      min: 0,
      max: 1,
      step: 0.1,
      precision: 2,
      value: config.planarProjectionFactor,
    },
  };
}

export function cameraInfoSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<LayerSettingsCameraInfo>,
): DocumentedNode {
  return {
    icon: "Camera",
    fields: {
      ...projectionFields(config, t("threeDee:frustumDistanceHelp")),
      width: fieldLineWidth(
        t("threeDee:lineWidth"),
        t("threeDee:frustumLineWidthHelp"),
        config.width,
        CAMERA_INFO_DEFAULTS.width,
      ),
      color: {
        label: t("threeDee:color"),
        help: t("threeDee:frustumColorHelp"),
        input: "rgba",
        value: config.color ?? CAMERA_INFO_DEFAULTS.color,
      },
    },
    visible: config.visible ?? CAMERA_INFO_DEFAULTS.visible,
    order: topic.name.toLocaleLowerCase(),
  };
}

/** `cameraInfoOptions`: the calibration topics to choose from, best match first. */
export function imageProjectionSettingsNode(
  topic: Pick<Topic, "name">,
  config: Partial<ImageRenderableSettings>,
  cameraInfoOptions: { label: string; value: string }[],
): DocumentedNode {
  return {
    icon: "ImageProjection",
    fields: {
      cameraInfoTopic: {
        label: t("threeDee:cameraInfo"),
        help: t("threeDee:cameraInfoHelp"),
        input: "select",
        options: cameraInfoOptions,
        value: config.cameraInfoTopic,
      },
      ...projectionFields(config, t("threeDee:imageDistanceHelp")),
      color: {
        label: t("threeDee:color"),
        help: t("threeDee:imageColorHelp"),
        input: "rgba",
        value: config.color,
      },
    },
    visible: config.visible ?? false,
    order: topic.name.toLocaleLowerCase(),
  };
}

// ---- Point clouds, laser scans and velodyne scans ----

export type PointShape = "circle" | "square" | "cube";
const ALL_POINT_SHAPES: readonly PointShape[] = ["circle", "square", "cube"];

export type LayerSettingsPointExtension = BaseSettings &
  ColorModeSettings & {
    pointSize: number;
    pointShape: PointShape;
    /** Edge length in meters when `pointShape` is "cube" */
    cubeSize: number;
    decayTime: number;
  };

// used by LaserScans, VelodyneScans, and PointClouds
export const DEFAULT_POINT_SETTINGS: LayerSettingsPointExtension = {
  visible: false,
  frameLocked: false,
  pointSize: 1.5,
  pointShape: "circle",
  cubeSize: 0.1,
  decayTime: 0,
  colorMode: "flat",
  flatColor: rgbaToCssString({ r: 1, g: 1, b: 1, a: 1 }),
  colorField: undefined,
  gradient: [
    rgbaToCssString({ r: 100 / 255, g: 47 / 255, b: 105 / 255, a: 1 }),
    rgbaToCssString({ r: 227 / 255, g: 177 / 255, b: 135 / 255, a: 1 }),
  ],
  colorMap: "turbo",
  explicitAlpha: 1,
  minValue: undefined,
  maxValue: undefined,
};

export const POINT_CLOUD_REQUIRED_FIELDS = ["x", "y", "z"];

export const LASERSCAN_FIELDS = ["range", "intensity"];

const SHAPE_LABELS = {
  circle: "threeDee:pointShapeCircle",
  square: "threeDee:pointShapeSquare",
  cube: "threeDee:pointShapeCube",
} as const;

/**
 * Creates settings node for Point cloud and scan topics
 * @param topic - topic to get settings node for
 * @param messageFields - message fields or required fields for the topic
 * @param config - current topic settings
 * @param defaultSettings - (optional) default settings to use
 * @param shapes - (optional) point shapes offered in the settings
 * @returns  - settings node for the topic
 */
export function pointSettingsNode(
  topic: Pick<Topic, "name" | "schemaName" | "convertibleTo">,
  messageFields: string[],
  config: Partial<LayerSettingsPointExtension>,
  defaultSettings: LayerSettingsPointExtension = DEFAULT_POINT_SETTINGS,
  shapes: readonly PointShape[] = ALL_POINT_SHAPES,
): DocumentedNode {
  const pointShape = config.pointShape ?? "circle";

  const checkColorsForDatatypes = (pointCloudDatatypes: Set<string>): boolean => {
    return (
      pointCloudDatatypes.has(topic.schemaName) ||
      (topic.convertibleTo ?? []).some((item) => pointCloudDatatypes.has(item))
    );
  };

  const colorModeFields = colorModeSettingsFields({
    msgFields: messageFields,
    config,
    defaults: defaultSettings,
    modifiers: {
      supportsPackedRgbModes: checkColorsForDatatypes(ROS_POINTCLOUD_DATATYPES),
      supportsRgbaFieldsMode: checkColorsForDatatypes(LICHTBLICK_POINTCLOUD_DATATYPES),
    },
  });

  const sizeFields: DocumentedFields =
    pointShape === "cube"
      ? {
          cubeSize: {
            label: t("threeDee:cubeSize"),
            help: t("threeDee:cubeSizeHelp"),
            input: "number",
            step: 0.05,
            placeholder: String(defaultSettings.cubeSize),
            precision: 3,
            value: config.cubeSize,
            min: 0,
          },
        }
      : {
          pointSize: {
            label: t("threeDee:pointSize"),
            help: t("threeDee:pointSizeHelp"),
            input: "number",
            step: 1,
            placeholder: "2",
            precision: 2,
            value: config.pointSize,
            min: 0,
          },
        };

  return {
    order: topic.name.toLocaleLowerCase(),
    visible: config.visible ?? defaultSettings.visible,
    fields: {
      pointShape: {
        label: t("threeDee:pointShape"),
        help: t("threeDee:pointShapeHelp"),
        input: "select",
        options: shapes.map((shape) => ({ label: t(SHAPE_LABELS[shape]), value: shape })),
        value: pointShape,
      },
      ...sizeFields,
      decayTime: {
        label: t("threeDee:decayTime"),
        help: t("threeDee:decayTimeHelp"),
        input: "number",
        step: 0.5,
        placeholder: t("threeDee:decayTimeDefaultZeroSeconds"),
        min: 0,
        precision: 3,
        value: config.decayTime,
      },
      ...colorModeFields,
    },
  };
}

/** Point clouds and velodyne scans: the point settings plus stixels. */
export function pointCloudSettingsNode(
  topic: Pick<Topic, "name" | "schemaName" | "convertibleTo">,
  messageFields: string[],
  config: Partial<LayerSettingsPointExtension & { stixelsEnabled: boolean }>,
): DocumentedNode {
  const node = pointSettingsNode(topic, messageFields, config);
  node.fields!.stixelsEnabled = {
    label: "Stixel view",
    help: "Draws a vertical line from each point down to its frame's ground plane (z = 0).",
    input: "boolean",
    value: config.stixelsEnabled ?? false,
  };
  node.icon = "Points";
  return node;
}

/** Cubes aren't offered: the laser scan shader computes positions from ranges on the GPU. */
export function laserScanSettingsNode(
  topic: Pick<Topic, "name" | "schemaName" | "convertibleTo">,
  config: Partial<LayerSettingsPointExtension>,
): DocumentedNode {
  const node = pointSettingsNode(topic, LASERSCAN_FIELDS, config, undefined, ["circle", "square"]);
  node.icon = "Radar";
  return node;
}
