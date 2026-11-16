// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Settings nodes for the 3D panel's scene-wide settings (frame, view, scene, transforms, publish),
// shared by the scene extensions and the panel guide. Kept free of three.js.

import { t } from "i18next";

import type { SettingsTreeNodeAction } from "@lichtblick/suite";
import type {
  DocumentedFields,
  DocumentedNode,
  DocumentedNodes,
} from "@lichtblick/suite-base/panels/shared/documentedSettings";
import { topicListNode } from "@lichtblick/suite-base/panels/shared/topicList";

import type { RendererConfig } from "../IRenderer";
import { isTransformPreloadEnabled, MAX_TRANSFORM_MESSAGES } from "../constants";
import {
  DEFAULT_CAMERA_STATE,
  DEFAULT_LABEL_SCALE_FACTOR,
  DEFAULT_MESH_UP_AXIS,
} from "../defaults";
import { fieldSize, PRECISION_DEGREES, PRECISION_DISTANCE } from "../settings";
import type { AdjustStep, RotationConvention } from "../transforms/transformOffsets";

type SelectOption = { label: string; value: string | undefined };

// ---- Frame and view ----

export function frameSettingsNode(
  config: Pick<RendererConfig, "followTf" | "followMode">,
  frameOptions: SelectOption[],
  followTfError: string | undefined,
): DocumentedNode {
  return {
    label: t("threeDee:frame"),
    fields: {
      followTf: {
        label: t("threeDee:displayFrame"),
        help: t("threeDee:displayFrameHelp"),
        input: "select",
        options: frameOptions,
        value: config.followTf,
        error: followTfError,
      },
      followMode: {
        label: t("threeDee:followMode"),
        help: t("threeDee:followModeHelp"),
        input: "select",
        options: [
          { label: t("threeDee:pose"), value: "follow-pose" },
          { label: t("threeDee:position"), value: "follow-position" },
          { label: t("threeDee:fixed"), value: "follow-none" },
        ],
        value: config.followMode,
      },
    },
    defaultExpansionState: "expanded",
  };
}

export function viewSettingsNode(
  config: Pick<RendererConfig, "cameraState" | "scene">,
  syncCameraError: string | undefined,
): DocumentedNode {
  const camera = config.cameraState;
  return {
    label: t("threeDee:view"),
    actions: [{ type: "action", id: "reset-camera", label: t("threeDee:reset") }],
    fields: {
      syncCamera: {
        label: t("threeDee:syncCamera"),
        input: "boolean",
        error: syncCameraError,
        value: config.scene.syncCamera ?? false,
        help: t("threeDee:syncCameraHelp"),
      },
      distance: {
        label: t("threeDee:distance"),
        help: t("threeDee:cameraDistanceHelp"),
        input: "number",
        step: 1,
        precision: PRECISION_DISTANCE,
        value: camera.distance,
      },
      perspective: {
        label: t("threeDee:perspective"),
        help: t("threeDee:perspectiveHelp"),
        input: "boolean",
        value: camera.perspective,
      },
      targetOffset: {
        label: t("threeDee:target"),
        help: t("threeDee:targetHelp"),
        input: "vec3",
        labels: ["X", "Y", "Z"],
        precision: PRECISION_DISTANCE,
        value: [...camera.targetOffset],
      },
      thetaOffset: {
        label: t("threeDee:theta"),
        help: t("threeDee:thetaHelp"),
        input: "number",
        step: 1,
        precision: PRECISION_DEGREES,
        value: camera.thetaOffset,
      },
      ...(camera.perspective && {
        phi: {
          label: t("threeDee:phi"),
          help: t("threeDee:phiHelp"),
          input: "number",
          step: 1,
          precision: PRECISION_DEGREES,
          value: camera.phi,
        },
        fovy: {
          label: t("threeDee:fovy"),
          help: t("threeDee:fovyHelp"),
          input: "number",
          step: 1,
          precision: PRECISION_DEGREES,
          value: camera.fovy,
        },
      }),
      near: {
        label: t("threeDee:near"),
        help: t("threeDee:nearHelp"),
        input: "number",
        step: DEFAULT_CAMERA_STATE.near,
        precision: PRECISION_DISTANCE,
        value: camera.near,
      },
      far: {
        label: t("threeDee:far"),
        help: t("threeDee:farHelp"),
        input: "number",
        step: 1,
        precision: PRECISION_DISTANCE,
        value: camera.far,
      },
    },
  };
}

// ---- Scene ----

/**
 * `loaded`: the mesh options the model cache was created with; changing them only takes effect
 * after a restart. `debugPicking` is omitted in production builds.
 */
export function sceneSettingsNode(
  scene: RendererConfig["scene"],
  {
    debugPicking,
    loaded,
  }: {
    debugPicking: boolean | undefined;
    loaded: { ignoreColladaUpAxis: boolean; meshUpAxis: string };
  },
): DocumentedNode {
  const fields: DocumentedFields = {
    enableStats: {
      label: t("threeDee:renderStats"),
      help: t("threeDee:renderStatsHelp"),
      input: "boolean",
      value: scene.enableStats,
    },
    debugPicking: {
      label: t("threeDee:debugPicking"),
      help: t("threeDee:debugPickingHelp"),
      input: "boolean",
      value: debugPicking,
    },
    backgroundColor: {
      label: t("threeDee:background"),
      help: t("threeDee:backgroundHelp"),
      input: "rgb",
      value: scene.backgroundColor,
    },
    labelScaleFactor: {
      label: t("threeDee:labelScale"),
      help: t("threeDee:labelScaleHelp"),
      input: "number",
      min: 0,
      step: 0.1,
      precision: 2,
      value: scene.labelScaleFactor,
      placeholder: String(DEFAULT_LABEL_SCALE_FACTOR),
    },
    ignoreColladaUpAxis: {
      label: t("threeDee:ignoreColladaUpAxis"),
      help: t("threeDee:ignoreColladaUpAxisHelp"),
      input: "boolean",
      value: scene.ignoreColladaUpAxis,
      error:
        (scene.ignoreColladaUpAxis ?? false) !== loaded.ignoreColladaUpAxis
          ? t("threeDee:takeEffectAfterReboot")
          : undefined,
    },
    meshUpAxis: {
      label: t("threeDee:meshUpAxis"),
      help: t("threeDee:meshUpAxisHelp"),
      input: "select",
      value: scene.meshUpAxis ?? DEFAULT_MESH_UP_AXIS,
      options: [
        { label: t("threeDee:YUp"), value: "y_up" },
        { label: t("threeDee:ZUp"), value: "z_up" },
      ],
      error:
        (scene.meshUpAxis ?? DEFAULT_MESH_UP_AXIS) !== loaded.meshUpAxis
          ? t("threeDee:takeEffectAfterReboot")
          : undefined,
    },
    mainLightMode: {
      label: t("threeDee:mainLightMode"),
      help: t("threeDee:mainLightModeHelp"),
      input: "select",
      value: scene.mainLightMode ?? "fixed",
      options: [
        { label: t("threeDee:mainLightFixed"), value: "fixed" },
        { label: t("threeDee:mainLightHeadlight"), value: "headlight" },
      ],
    },
    directionalLightIntensity: {
      label: t("threeDee:directionalLightIntensity"),
      help: t("threeDee:directionalLightIntensityHelp"),
      input: "number",
      min: 0,
      step: 0.1,
      precision: 2,
      value: scene.directionalLightIntensity,
      placeholder: String(Math.PI),
    },
    hemisphereLightIntensity: {
      label: t("threeDee:hemisphereLightIntensity"),
      help: t("threeDee:hemisphereLightIntensityHelp"),
      input: "number",
      min: 0,
      step: 0.1,
      precision: 2,
      value: scene.hemisphereLightIntensity,
      placeholder: String(0.5 * Math.PI),
    },
  };

  if (process.env.NODE_ENV === "production") {
    delete fields.debugPicking;
  }
  return {
    label: t("threeDee:scene"),
    actions: [{ type: "action", id: "reset-scene", label: t("threeDee:reset") }],
    fields,
    defaultExpansionState: "collapsed",
  };
}

// ---- Publish ----

export function publishSettingsNode(publish: RendererConfig["publish"]): DocumentedNode {
  return {
    label: t("threeDee:publish"),
    fields: {
      type: {
        label: t("threeDee:type"),
        input: "select",
        value: publish.type,
        options: [
          { label: t("threeDee:publishTypePoint"), value: "point" },
          { label: t("threeDee:publishTypePose"), value: "pose" },
          { label: t("threeDee:publishTypePoseEstimate"), value: "pose_estimate" },
        ],
        help: t("threeDee:publishTypeHelp"),
      },
      topic: {
        label: t("threeDee:topic"),
        input: "string",
        value: {
          point: publish.pointTopic,
          pose: publish.poseTopic,
          pose_estimate: publish.poseEstimateTopic,
        }[publish.type],
        help: t("threeDee:publishTopicHelp"),
      },
      ...(publish.type === "pose_estimate" && {
        poseEstimateXDeviation: {
          label: t("threeDee:xDeviation"),
          input: "number",
          value: publish.poseEstimateXDeviation,
          help: t("threeDee:xDeviationHelp"),
        },
        poseEstimateYDeviation: {
          label: t("threeDee:yDeviation"),
          input: "number",
          value: publish.poseEstimateYDeviation,
          help: t("threeDee:yDeviationHelp"),
        },
        poseEstimateThetaDeviation: {
          label: t("threeDee:thetaDeviation"),
          input: "number",
          value: publish.poseEstimateThetaDeviation,
          help: t("threeDee:thetaDeviationHelp"),
        },
      }),
    },
    defaultExpansionState: "collapsed",
  };
}

// ---- Topics and custom layers ----

export function topicsRootNode(children: DocumentedNodes = {}): DocumentedNode {
  return topicListNode<DocumentedNode>({
    label: t("threeDee:topics"),
    help: t("threeDee:topicsHelp"),
    children,
  });
}

export function customLayersRootNode(
  layerCount: number,
  actions: SettingsTreeNodeAction[],
): DocumentedNode {
  return {
    label: `${t("threeDee:customLayers")}${layerCount > 0 ? ` (${layerCount})` : ""}`,
    help: t("threeDee:customLayersHelp"),
    actions,
  };
}

// ---- Transforms ----

export const DEFAULT_EDITABLE = false;
export const DEFAULT_ADJUST_STEP: AdjustStep = "medium";
// Intrinsic XYZ was the only convention before it became a setting
export const DEFAULT_ROTATION_CONVENTION: RotationConvention = "intrinsic";
export const DEFAULT_AXIS_SCALE = 1;
export const DEFAULT_LINE_WIDTH_PX = 2;
export const DEFAULT_LINE_COLOR_STR = "#ffff00";
export const DEFAULT_TF_LABEL_SIZE = 0.2;

export function rotationConventionHelp(convention: RotationConvention): string {
  return convention === "extrinsic"
    ? t("threeDee:rotationConventionHelpExtrinsic")
    : t("threeDee:rotationConventionHelpIntrinsic");
}

/**
 * The "Settings" child of the Transforms node. `keyboardFrames`: frames that have a parent, so
 * they can be adjusted; `hasOffsets`: some frame is adjusted.
 */
export function transformSettingsNode(
  config: Pick<RendererConfig, "scene">,
  {
    keyboardFrames,
    showOriginal,
    hasOffsets,
  }: { keyboardFrames: SelectOption[]; showOriginal: boolean; hasOffsets: boolean },
): DocumentedNode {
  const transforms = config.scene.transforms;
  const editable = transforms?.editable ?? DEFAULT_EDITABLE;
  const convention = transforms?.rotationConvention ?? DEFAULT_ROTATION_CONVENTION;
  const preloading = isTransformPreloadEnabled(config);
  return {
    label: t("threeDee:settings"),
    defaultExpansionState: "collapsed",
    order: 0,
    fields: {
      editable: {
        label: t("threeDee:editable"),
        help: t("threeDee:editableHelp"),
        input: "boolean",
        value: editable,
      },
      ...(editable && {
        adjustStep: {
          label: t("threeDee:adjustStep"),
          help: t("threeDee:adjustStepHelp"),
          input: "select",
          value: transforms?.adjustStep ?? DEFAULT_ADJUST_STEP,
          options: [
            { label: t("threeDee:adjustStepFine"), value: "fine" },
            { label: t("threeDee:adjustStepMedium"), value: "medium" },
            { label: t("threeDee:adjustStepCoarse"), value: "coarse" },
          ],
        },
        keyboardFrame: {
          label: t("threeDee:keyboardFrame"),
          help: t("threeDee:keyboardFrameHelp"),
          input: "select",
          value: transforms?.keyboardFrame ?? "",
          options: [{ label: t("threeDee:keyboardFrameNone"), value: "" }, ...keyboardFrames],
        },
      }),
      ...((editable || hasOffsets) && {
        showOriginal: {
          label: t("threeDee:showOriginal"),
          help: t("threeDee:showOriginalHelp"),
          input: "boolean",
          value: showOriginal,
        },
      }),
      rotationConvention: {
        label: t("threeDee:rotationConvention"),
        help: rotationConventionHelp(convention),
        input: "select",
        value: convention,
        options: [
          { label: t("threeDee:rotationConventionExtrinsic"), value: "extrinsic" },
          { label: t("threeDee:rotationConventionIntrinsic"), value: "intrinsic" },
        ],
      },
      showLabel: {
        label: t("threeDee:labels"),
        help: t("threeDee:frameLabelsHelp"),
        input: "boolean",
        value: transforms?.showLabel ?? true,
      },
      ...((transforms?.showLabel ?? true) && {
        labelSize: {
          label: t("threeDee:labelSize"),
          help: t("threeDee:frameLabelSizeHelp"),
          input: "number",
          min: 0,
          step: 0.01,
          precision: 2,
          placeholder: String(DEFAULT_TF_LABEL_SIZE),
          value: transforms?.labelSize,
        },
      }),
      axisScale: fieldSize(
        t("threeDee:axisScale"),
        t("threeDee:frameAxisScaleHelp"),
        transforms?.axisScale,
        DEFAULT_AXIS_SCALE,
      ),
      lineWidth: {
        label: t("threeDee:lineWidth"),
        help: t("threeDee:frameLineWidthHelp"),
        input: "number",
        min: 0,
        step: 0.5,
        precision: 1,
        value: transforms?.lineWidth,
        placeholder: String(DEFAULT_LINE_WIDTH_PX),
      },
      lineColor: {
        label: t("threeDee:lineColor"),
        help: t("threeDee:frameLineColorHelp"),
        input: "rgb",
        value: transforms?.lineColor ?? DEFAULT_LINE_COLOR_STR,
      },
      enablePreloading: {
        label: t("threeDee:enablePreloading"),
        help: t("threeDee:enablePreloadingTooltip"),
        tooltip: t("threeDee:enablePreloadingTooltip"),
        input: "boolean",
        value: preloading,
      },
      maxPreloadMessages: {
        label: t("threeDee:maxPreloadMessages"),
        help: t("threeDee:maxPreloadMessagesTooltip"),
        tooltip: t("threeDee:maxPreloadMessagesTooltip"),
        input: "number",
        min: 1000,
        max: 50000,
        step: 1000,
        value: transforms?.maxPreloadMessages ?? MAX_TRANSFORM_MESSAGES,
        disabled: !preloading,
      },
    },
    actions: preloading
      ? [
          {
            id: "clear-preload-buffer",
            type: "action",
            label: t("threeDee:clearPreloadBuffer"),
            display: "menu",
          },
        ]
      : undefined,
  };
}

type Vec3 = [number, number, number];

/** Values shown for one coordinate frame, already rounded for display. */
export type FrameFieldValues = {
  /** Undefined for a root frame. */
  parentFrameId: string | undefined;
  age: string | undefined;
  historySize: number;
  /** The recorded transform and the frame's offset, when the frame is adjusted. */
  adjusted?: { recordedXyz?: Vec3; recordedRpy?: Vec3; offsetXyz: Vec3; offsetRpy: Vec3 };
  /** Recorded transform plus offset. */
  resultXyz?: Vec3;
  resultRpy?: Vec3;
};

/** Precision of the offset and result rotation fields, finer than PRECISION_DEGREES */
export const PRECISION_ADJUST_DEGREES = 3;

/** Fields of one frame under Transforms. `step`: increments for the offset inputs. */
export function frameFields(
  values: FrameFieldValues,
  config: Pick<RendererConfig, "scene">,
  step: { meters: number; degrees: number } | undefined,
): DocumentedFields {
  if (values.parentFrameId == undefined) {
    return {
      parent: {
        label: t("threeDee:parent"),
        help: t("threeDee:parentHelp"),
        input: "string",
        readonly: true,
        value: "<root>",
      },
    };
  }
  const editable = config.scene.transforms?.editable ?? DEFAULT_EDITABLE;
  const rotationHelp = rotationConventionHelp(
    config.scene.transforms?.rotationConvention ?? DEFAULT_ROTATION_CONVENTION,
  );
  const { adjusted } = values;

  const fields: DocumentedFields = {
    parent: {
      label: t("threeDee:parent"),
      help: t("threeDee:parentHelp"),
      input: "string",
      readonly: true,
      value: values.parentFrameId,
    },
    age: {
      label: t("threeDee:age"),
      help: t("threeDee:ageHelp"),
      input: "string",
      readonly: true,
      value: values.age,
    },
    historySize: {
      label: t("threeDee:historySize"),
      help: t("threeDee:historySizeHelp"),
      input: "string",
      readonly: true,
      value: String(values.historySize),
    },
  };

  if (adjusted) {
    fields.xyz = {
      label: t("threeDee:recordedTranslation"),
      help: t("threeDee:recordedTranslationHelp"),
      input: "vec3",
      precision: PRECISION_DISTANCE,
      labels: ["X", "Y", "Z"],
      readonly: true,
      value: adjusted.recordedXyz,
    };
    fields.rpy = {
      label: t("threeDee:recordedRotation"),
      help: rotationHelp,
      input: "vec3",
      precision: PRECISION_ADJUST_DEGREES,
      labels: ["R", "P", "Y"],
      readonly: true,
      value: adjusted.recordedRpy,
    };
    fields.xyzOffset = {
      label: t("threeDee:translationOffset"),
      help: t("threeDee:translationOffsetHelp"),
      input: "vec3",
      precision: PRECISION_DISTANCE,
      step: step?.meters,
      labels: ["X", "Y", "Z"],
      readonly: !editable,
      value: adjusted.offsetXyz,
    };
    fields.rpyCoefficient = {
      label: t("threeDee:rotationOffset"),
      help: `${t("threeDee:rotationOffsetHelp")} ${rotationHelp}`,
      input: "vec3",
      precision: PRECISION_ADJUST_DEGREES,
      step: step?.degrees,
      min: -180,
      max: 180,
      labels: ["R", "P", "Y"],
      readonly: !editable,
      value: adjusted.offsetRpy,
    };
  }

  fields.resultXyz = {
    label: adjusted ? t("threeDee:resultTranslation") : t("threeDee:translation"),
    help: editable ? t("threeDee:resultHelp") : t("threeDee:translationHelp"),
    input: "vec3",
    precision: PRECISION_DISTANCE,
    step: step?.meters,
    labels: ["X", "Y", "Z"],
    readonly: !editable || !values.resultXyz,
    value: values.resultXyz,
  };
  fields.resultRpy = {
    label: adjusted ? t("threeDee:resultRotation") : t("threeDee:rotation"),
    help: editable ? `${t("threeDee:resultHelp")} ${rotationHelp}` : rotationHelp,
    input: "vec3",
    precision: PRECISION_ADJUST_DEGREES,
    step: step?.degrees,
    labels: ["R", "P", "Y"],
    readonly: !editable || !values.resultRpy,
    value: values.resultRpy,
  };
  return fields;
}
