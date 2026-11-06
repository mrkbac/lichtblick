// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Label } from "@foxglove/three-text";
import { t } from "i18next";
import * as _ from "lodash-es";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import {
  SettingsTreeAction,
  SettingsTreeChildren,
  SettingsTreeFields,
  SettingsTreeNodeAction,
} from "@lichtblick/suite";
import type { RosValue } from "@lichtblick/suite-base/players/types";
import clipboard from "@lichtblick/suite-base/util/clipboard";

import type { IRenderer } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import { getLuminance, stringToRgb } from "../color";
import { isTransformPreloadEnabled, MAX_TRANSFORM_MESSAGES } from "../constants";
import { BaseSettings, fieldSize, PRECISION_DISTANCE } from "../settings";
import { CoordinateFrame, Duration, makePose, MAX_DURATION, Transform } from "../transforms";
import { Axis, AXIS_LENGTH } from "./Axis";
import { DEFAULT_LABEL_SCALE_FACTOR } from "./SceneSettings";
import {
  ADJUST_STEPS,
  AdjustStep,
  applyOffset,
  EMPTY_OFFSETS,
  FrameOffset,
  formatStaticTransformPublisher,
  formatUrdfJoint,
  formatYaml,
  NudgeKey,
  nudge,
  offsetForResult,
  parseTransformOffsets,
  Quat,
  quatToRpyDegrees,
  TRANSFORM_OFFSETS_VARIABLE,
  TransformOffsets,
  Vec3,
  withFrameOffset,
} from "../transforms/transformOffsets";
import { makeLinePickingMaterial } from "./markers/materials";

export type LayerSettingsTransform = BaseSettings & {
  xyzOffset: Readonly<[number | undefined, number | undefined, number | undefined]>;
  rpyCoefficient: Readonly<[number | undefined, number | undefined, number | undefined]>;
};

const PICKING_LINE_SIZE = 6;
const PI_2 = Math.PI / 2;

const DEFAULT_EDITABLE = false;
const DEFAULT_ADJUST_STEP: AdjustStep = "medium";
/** Precision of the offset and result rotation fields, finer than PRECISION_DEGREES */
const PRECISION_ADJUST_DEGREES = 3;
const NUDGE_KEYS = new Set<string>([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
]);
/** Edits closer together than this form one undo step (key repeat, dragging a field) */
const UNDO_COALESCE_MS = 500;
const MAX_UNDO_STEPS = 100;
/** How long our own published values count as possible stale echoes */
const ECHO_TIMEOUT_MS = 2000;
const KEYBOARD_HUD_ID = "transforms-keyboard-adjust";
const ORIGINAL_HUD_ID = "transforms-show-original";

const DEFAULT_AXIS_SCALE = 1;
const DEFAULT_LINE_WIDTH_PX = 2;
const DEFAULT_LINE_COLOR_STR = "#ffff00";
const DEFAULT_TF_LABEL_SIZE = 0.2;

const DEFAULT_SETTINGS: LayerSettingsTransform = {
  visible: true,
  frameLocked: true,
  xyzOffset: [0, 0, 0],
  rpyCoefficient: [0, 0, 0],
};

export type FrameAxisUserData = BaseUserData & {
  axis: Axis;
  label: Label;
  parentLine: Line2;
};

class FrameAxisRenderable extends Renderable<FrameAxisUserData> {
  public override dispose(): void {
    this.renderer.labelPool.release(this.userData.label);
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    const frame = this.renderer.transformTree.frame(this.userData.frameId);
    const parent = frame?.parent();
    const fixed = frame?.root();

    return {
      child_frame_id: frame?.displayName() ?? "<unknown>",
      parent_frame_id: parent?.displayName() ?? "<unknown>",
      fixed_frame_id: fixed?.displayName() ?? "<unknown>",
    };
  }
}

const tempVec = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempLower: [Duration, Transform] = [0n, Transform.Identity()];
const tempUpper: [Duration, Transform] = [0n, Transform.Identity()];
const tempTfPath: [string, string] = ["transforms", ""];

export class FrameAxes extends SceneExtension<FrameAxisRenderable> {
  public static extensionId = "foxglove.FrameAxes";
  #lineMaterial: LineMaterial;
  #linePickingMaterial: THREE.ShaderMaterial;

  #labelForegroundColor = 1;
  #labelBackgroundColor = new THREE.Color();
  #lineGeometry: LineGeometry;
  #defaultRenderableSettings: LayerSettingsTransform;

  /** Layout-wide offsets, shared with every 3D and Image panel through a layout variable */
  #offsets: TransformOffsets = EMPTY_OFFSETS;
  /** Values this panel published recently; a late echo of an older one must not undo newer edits */
  #published: { value: TransformOffsets; time: number }[] = [];
  #history: TransformOffsets[] = [];
  #lastHistoryTime = 0;
  #hudFrameId: string | undefined;

  public constructor(
    renderer: IRenderer,
    defaultRenderableSettings: Partial<LayerSettingsTransform>,
    name: string = FrameAxes.extensionId,
  ) {
    super(name, renderer);

    const linewidth = this.renderer.config.scene.transforms?.lineWidth ?? DEFAULT_LINE_WIDTH_PX;
    const color = stringToRgb(
      new THREE.Color(),
      this.renderer.config.scene.transforms?.lineColor ?? DEFAULT_LINE_COLOR_STR,
    );
    this.#lineMaterial = new LineMaterial({ linewidth });
    this.#lineMaterial.color = color;

    const options = { resolution: renderer.input.canvasSize, worldUnits: false };

    this.#lineGeometry = this.renderer.sharedGeometry.getGeometry(
      this.constructor.name,
      createLineGeometry,
    );

    this.#linePickingMaterial = makeLinePickingMaterial(PICKING_LINE_SIZE, options);

    renderer.on("transformTreeUpdated", this.#handleTransformTreeUpdated);
    renderer.on("variablesChange", this.#handleVariablesChange);
    // Capture phase: while adjusting, arrows must not also seek playback (global arrow keys)
    window.addEventListener("keydown", this.#handleKeyDown, { capture: true });

    this.#defaultRenderableSettings = { ...DEFAULT_SETTINGS, ...defaultRenderableSettings };
    this.#offsets = parseTransformOffsets(renderer.variables.get(TRANSFORM_OFFSETS_VARIABLE));
    this.#updateHud();
  }

  public override dispose(): void {
    this.renderer.off("transformTreeUpdated", this.#handleTransformTreeUpdated);
    this.renderer.off("variablesChange", this.#handleVariablesChange);
    window.removeEventListener("keydown", this.#handleKeyDown, { capture: true });
    this.#lineMaterial.dispose();
    this.#linePickingMaterial.dispose();
    super.dispose();
  }

  public override removeAllRenderables(): void {
    // Don't destroy frame axis renderables on clear() since `renderer.transformTree`
    // is left untouched
    // clear() empties the HUD right before this; put the adjustment notices back
    this.#hudFrameId = undefined;
    this.#updateHud();
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const config = this.renderer.config;
    const configTransforms = config.transforms;
    const handler = this.handleSettingsAction;
    const frameCount = this.renderer.coordinateFrameList.length;
    const editable = config.scene.transforms?.editable ?? DEFAULT_EDITABLE;
    const hasOffsets = Object.keys(this.#offsets.frames).length > 0;
    const children: SettingsTreeChildren = {
      settings: {
        label: t("threeDee:settings"),
        defaultExpansionState: "collapsed",
        order: 0,
        fields: {
          editable: {
            label: t("threeDee:editable"),
            input: "boolean",
            value: editable,
          },
          ...(editable && {
            adjustStep: {
              label: t("threeDee:adjustStep"),
              input: "select",
              value: config.scene.transforms?.adjustStep ?? DEFAULT_ADJUST_STEP,
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
              value: config.scene.transforms?.keyboardFrame ?? "",
              options: [
                { label: t("threeDee:keyboardFrameNone"), value: "" },
                ...this.renderer.coordinateFrameList.filter(
                  ({ value }) => this.renderer.transformTree.frame(value)?.parent() != undefined,
                ),
              ],
            },
          }),
          ...((editable || hasOffsets) && {
            showOriginal: {
              label: t("threeDee:showOriginal"),
              help: t("threeDee:showOriginalHelp"),
              input: "boolean",
              value: this.#offsets.showOriginal === true,
            },
          }),
          showLabel: {
            label: t("threeDee:labels"),
            input: "boolean",
            value: config.scene.transforms?.showLabel ?? true,
          },
          ...((config.scene.transforms?.showLabel ?? true) && {
            labelSize: {
              label: t("threeDee:labelSize"),
              input: "number",
              min: 0,
              step: 0.01,
              precision: 2,
              placeholder: String(DEFAULT_TF_LABEL_SIZE),
              value: config.scene.transforms?.labelSize,
            },
          }),
          axisScale: fieldSize(
            t("threeDee:axisScale"),
            config.scene.transforms?.axisScale,
            DEFAULT_AXIS_SCALE,
          ),
          lineWidth: {
            label: t("threeDee:lineWidth"),
            input: "number",
            min: 0,
            step: 0.5,
            precision: 1,
            value: config.scene.transforms?.lineWidth,
            placeholder: String(DEFAULT_LINE_WIDTH_PX),
          },
          lineColor: {
            label: t("threeDee:lineColor"),
            input: "rgb",
            value: config.scene.transforms?.lineColor ?? DEFAULT_LINE_COLOR_STR,
          },
          enablePreloading: {
            label: t("threeDee:enablePreloading"),
            input: "boolean",
            value: isTransformPreloadEnabled(config),
            tooltip: t("threeDee:enablePreloadingTooltip"),
          },
          maxPreloadMessages: {
            label: t("threeDee:maxPreloadMessages"),
            input: "number",
            min: 1000,
            max: 50000,
            step: 1000,
            value: config.scene.transforms?.maxPreloadMessages ?? MAX_TRANSFORM_MESSAGES,
            tooltip: t("threeDee:maxPreloadMessagesTooltip"),
            disabled: !isTransformPreloadEnabled(config),
          },
        },
        actions: isTransformPreloadEnabled(config)
          ? [
              {
                id: "clear-preload-buffer",
                type: "action",
                label: t("threeDee:clearPreloadBuffer"),
                display: "menu",
              },
            ]
          : undefined,
      },
    };

    let order = 1;
    for (const { label, value: frameId } of this.renderer.coordinateFrameList) {
      const frameKey = `frame:${frameId}`;
      const tfConfig = this.#getRenderableSettingsWithDefaults(configTransforms[frameKey] ?? {});
      const frame = this.renderer.transformTree.frame(frameId);
      const offset = this.#offsetFor(frameId);
      const fields = this.#buildFrameFields(frame, offset);
      tempTfPath[1] = frameKey;
      children[frameKey] = {
        label: offset ? `${label} (${t("threeDee:adjusted")})` : label,
        fields,
        actions: this.#frameActions(frame, offset),
        visible: tfConfig.visible,
        order: order++,
        defaultExpansionState: "collapsed",
        error: this.renderer.settings.errors.errors.errorAtPath(tempTfPath),
      };
    }

    return [
      {
        path: ["transforms"],
        node: {
          label: `${t("threeDee:transforms")}${frameCount > 0 ? ` (${frameCount})` : ""}`,
          actions: [
            { id: "show-all", type: "action", label: t("threeDee:showAll") },
            { id: "hide-all", type: "action", label: t("threeDee:hideAll") },
            ...(editable && this.#history.length > 0
              ? [
                  {
                    id: "undo-adjustment",
                    type: "action" as const,
                    label: t("threeDee:undoAdjustment"),
                  },
                ]
              : []),
            ...(editable && hasOffsets
              ? [
                  {
                    id: "reset-all-adjustments",
                    type: "action" as const,
                    label: t("threeDee:resetAllAdjustments"),
                  },
                ]
              : []),
          ],
          handler,
          children,
        },
      },
    ];
  }

  #settingsTime: bigint | undefined;
  #settingsTransformsVersion = -1;

  #throttledUpdateSettingsTree = _.throttle(() => {
    this.updateSettingsTree();
    /**
     * Chose .5s because it gives better performance than .1s and doesn't feel sluggish.
     * This doesn't conform to our principles around response times but I believe performance
     * is a bigger issue here than responsiveness. The longer time between updates also gives users
     * a chance read the numbers more clearly, though I don't think that's a big use case here.
     */
  }, 500);

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    // Keep the material's `resolution` uniform in sync with the actual canvas size
    this.#lineMaterial.resolution = this.renderer.input.canvasSize;

    // The transforms settings nodes show age/translation/rotation, which only change with
    // currentTime or the transform tree; skip rebuilding them for e.g. camera moves while paused
    const transformsVersion = this.renderer.transformTree.version;
    if (
      currentTime !== this.#settingsTime ||
      transformsVersion !== this.#settingsTransformsVersion
    ) {
      this.#settingsTime = currentTime;
      this.#settingsTransformsVersion = transformsVersion;
      this.#throttledUpdateSettingsTree();
    }

    super.startFrame(currentTime, renderFrameId, fixedFrameId);

    // Compute the label offset based on the axis length and label size. We want the label
    // to float a little above the up axis arrow, proportional to the height of the label
    const axisScale = this.renderer.config.scene.transforms?.axisScale ?? DEFAULT_AXIS_SCALE;
    const axisLength = AXIS_LENGTH * axisScale;
    const labelSize = this.renderer.config.scene.transforms?.labelSize ?? DEFAULT_TF_LABEL_SIZE;
    const labelScale = this.renderer.config.scene.labelScaleFactor ?? DEFAULT_LABEL_SCALE_FACTOR;
    const labelOffsetZ = axisLength + labelSize * labelScale * 1.5;

    // Update the lines and labels between coordinate frames
    for (const renderable of this.renderables.values()) {
      // lines and labels are children of the renderable and won't render if the renderer isn't visible
      // so we can skip these updates
      if (!renderable.visible) {
        continue;
      }
      const line = renderable.userData.parentLine;
      const childFrame = this.renderer.transformTree.frame(renderable.userData.frameId);
      const parentFrame = childFrame?.parent();
      // NOTE: tempVecB should not be used until the label uses it below
      const worldPosition = tempVecB;
      renderable.getWorldPosition(worldPosition);
      // Lines require a parent renderable because they draw a line from the parent
      // frame origin to the child frame origin
      line.visible = false;
      if (parentFrame) {
        const parentRenderable = this.renderables.get(parentFrame.id);
        if (parentRenderable?.visible === true) {
          const parentWorldPosition = tempVec;
          parentRenderable.getWorldPosition(parentWorldPosition);
          const dist = parentWorldPosition.distanceTo(worldPosition);
          line.lookAt(parentWorldPosition);
          line.rotateY(-PI_2);
          line.scale.set(dist, 1, 1);
          line.visible = true;
        }
      }

      const label = renderable.userData.label;
      label.visible = this.renderer.config.scene.transforms?.showLabel ?? true;
      // Add the label offset in "world" coordinates (in the render frame)
      worldPosition.z += labelOffsetZ;
      // Transform worldPosition back to the local coordinate frame of the
      // renderable, which the label is a child of
      renderable.worldToLocal(worldPosition);
      label.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
    }
  }

  public override setColorScheme(
    colorScheme: "dark" | "light",
    backgroundColor: THREE.Color | undefined,
  ): void {
    const foreground = colorScheme === "dark" ? 1 : 0;
    this.#labelForegroundColor = foreground;
    this.#labelBackgroundColor.setRGB(1 - foreground, 1 - foreground, 1 - foreground);
    if (backgroundColor) {
      this.#labelForegroundColor =
        getLuminance(backgroundColor.r, backgroundColor.g, backgroundColor.b) > 0.5 ? 0 : 1;
      this.#labelBackgroundColor.copy(backgroundColor);
    }

    for (const renderable of this.renderables.values()) {
      renderable.userData.label.setColor(
        this.#labelForegroundColor,
        this.#labelForegroundColor,
        this.#labelForegroundColor,
      );
      renderable.userData.label.setBackgroundColor(
        this.#labelBackgroundColor.r,
        this.#labelBackgroundColor.g,
        this.#labelBackgroundColor.b,
      );
    }
  }

  #setLabelSize(size: number): void {
    for (const renderable of this.renderables.values()) {
      renderable.userData.label.setLineHeight(size);
    }
  }

  #setAxisScale(scale: number): void {
    for (const renderable of this.renderables.values()) {
      renderable.userData.axis.scale.set(scale, scale, scale);
    }
  }

  #setLineWidth(width: number): void {
    this.#lineMaterial.linewidth = width;
  }

  #setLineColor(color: string): void {
    stringToRgb(this.#lineMaterial.color, color);
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    if (action.action === "reorder-node") {
      return;
    }
    const path = action.payload.path;

    // eslint-disable-next-line @lichtblick/no-boolean-parameters
    const toggleFrameVisibility = (value: boolean) => {
      for (const renderable of this.renderables.values()) {
        renderable.userData.settings.visible = value;
      }

      this.renderer.updateConfig((draft) => {
        for (const frameId of this.renderables.keys()) {
          const frameKeySanitized = frameId === "settings" ? "$settings" : `frame:${frameId}`;
          let draftTransforms = draft.transforms[frameKeySanitized];
          draftTransforms ??= {};
          draftTransforms = { ...draftTransforms, visible: value };
          draft.transforms[frameKeySanitized] = draftTransforms;
        }
      });

      this.updateSettingsTree();
    };

    if (action.action === "perform-node-action") {
      if (action.payload.id === "show-all") {
        // Show all frames
        toggleFrameVisibility(true);
      } else if (action.payload.id === "hide-all") {
        // Hide all frames
        toggleFrameVisibility(false);
      } else if (action.payload.id === "clear-preload-buffer") {
        // Clear preloaded transform messages
        this.renderer.emit("clearPreloadBuffer", this.renderer);
      } else if (action.payload.id === "undo-adjustment") {
        this.#undo();
      } else if (action.payload.id === "reset-all-adjustments") {
        this.#setOffsets({ ...this.#offsets, frames: {} });
      } else if (path.length === 2 && path[1]!.startsWith("frame:")) {
        this.#handleFrameAction(action.payload.id, path[1]!.replace(/^frame:/, ""));
      }
      return;
    }

    if (path.length !== 3) {
      return; // Doesn't match the pattern of ["transforms", "settings" | `frame:${frameId}`, field]
    }

    if (path[1] === "settings") {
      const setting = path[2]!;
      const value = action.payload.value;

      if (setting === "showOriginal") {
        this.#setShowOriginal({ showOriginal: value === true });
        return;
      }

      this.saveSetting(
        ["scene", "transforms", setting],
        setting === "keyboardFrame" && value === "" ? undefined : value,
      );

      if (setting === "editable" || setting === "keyboardFrame") {
        this.#updateFrameAxes();
        this.#updateHud();
      } else if (setting === "labelSize") {
        const labelSize = value as number | undefined;
        this.#setLabelSize(labelSize ?? DEFAULT_TF_LABEL_SIZE);
      } else if (setting === "axisScale") {
        const axisScale = value as number | undefined;
        this.#setAxisScale(axisScale ?? DEFAULT_AXIS_SCALE);
      } else if (setting === "lineWidth") {
        const lineWidth = value as number | undefined;
        this.#setLineWidth(lineWidth ?? DEFAULT_LINE_WIDTH_PX);
      } else if (setting === "lineColor") {
        const lineColor = value as string | undefined;
        this.#setLineColor(lineColor ?? DEFAULT_LINE_COLOR_STR);
      }
    } else {
      const frameKey = path[1]!;
      const frameId = frameKey.replace(/^frame:/, "");
      if (this.#handleOffsetField(frameId, path[2]!, action.payload.value)) {
        return;
      }

      this.saveSetting(path, action.payload.value);

      // Update the renderable
      const renderable = this.renderables.get(frameId);
      if (renderable) {
        const settings = this.renderer.config.transforms[frameKey];
        renderable.userData.settings = this.#getRenderableSettingsWithDefaults(settings ?? {});

        this.#updateFrameAxis(renderable);
      }
    }
  };

  #getRenderableSettingsWithDefaults(
    partialDefinedSettings: Partial<LayerSettingsTransform>,
  ): LayerSettingsTransform {
    return { ...this.#defaultRenderableSettings, ...partialDefinedSettings };
  }

  #handleTransformTreeUpdated = (): void => {
    for (const frameId of this.renderer.transformTree.frames().keys()) {
      this.#addFrameAxis(frameId);
    }
    // Frames are re-created after a clear (e.g. backward seek); give them their offsets again
    const hasShared =
      this.#offsets.showOriginal === true || Object.keys(this.#offsets.frames).length > 0;
    if (this.renderer.config.scene.transforms?.editable === true || hasShared) {
      this.#updateFrameAxes();
    }
    this.updateSettingsTree();
  };

  #addFrameAxis(frameId: string): void {
    if (this.renderables.has(frameId)) {
      return;
    }

    const config = this.renderer.config;
    const frame = this.renderer.transformTree.frame(frameId);
    if (!frame) {
      throw new Error(`CoordinateFrame "${frameId}" was not created`);
    }

    // Text label
    const text = frame.displayName();
    const label = this.renderer.labelPool.acquire();
    label.setBillboard(true);
    label.setText(text);
    label.setLineHeight(config.scene.transforms?.labelSize ?? DEFAULT_TF_LABEL_SIZE);
    label.setColor(
      this.#labelForegroundColor,
      this.#labelForegroundColor,
      this.#labelForegroundColor,
    );
    label.setBackgroundColor(
      this.#labelBackgroundColor.r,
      this.#labelBackgroundColor.g,
      this.#labelBackgroundColor.b,
    );

    // Set the initial settings from default values merged with any user settings
    const frameKey = `frame:${frameId}`;
    const userSettings = config.transforms[frameKey];
    const settings = this.#getRenderableSettingsWithDefaults(userSettings ?? {});

    // Parent line
    const parentLine = new Line2(this.#lineGeometry, this.#lineMaterial);
    parentLine.castShadow = true;
    parentLine.receiveShadow = false;
    parentLine.userData.pickingMaterial = this.#linePickingMaterial;

    // Three arrow axis
    const axis = new Axis(frameId, this.renderer);
    const axisScale = config.scene.transforms?.axisScale ?? DEFAULT_AXIS_SCALE;
    axis.scale.set(axisScale, axisScale, axisScale);

    // Create a scene graph object to hold the axis, a text label, and a line to
    // the parent frame
    const renderable = new FrameAxisRenderable(frameId, this.renderer, {
      receiveTime: 0n,
      messageTime: 0n,
      frameId,
      pose: makePose(),
      settingsPath: ["transforms", frameKey],
      settings,
      axis,
      label,
      parentLine,
    });
    renderable.add(axis);
    renderable.add(label);
    renderable.add(parentLine);

    this.add(renderable);
    this.renderables.set(frameId, renderable);

    this.#updateFrameAxis(renderable);
  }

  /** Offset in effect for a frame: layout-wide, or a legacy per-panel one while editable */
  #offsetFor(frameId: string): FrameOffset | undefined {
    const shared = this.#offsets.frames[frameId];
    if (shared) {
      return shared;
    }
    if (!(this.renderer.config.scene.transforms?.editable ?? DEFAULT_EDITABLE)) {
      return undefined;
    }
    const settings = this.renderer.config.transforms[`frame:${frameId}`];
    const xyz = getOffset(settings?.xyzOffset);
    const rpy = getOffset(settings?.rpyCoefficient);
    return xyz || rpy ? { xyz: xyz ?? [0, 0, 0], rpy: rpy ?? [0, 0, 0] } : undefined;
  }

  /** Recorded transform (parent_T_child) at the current time, without any offset */
  #recorded(frame: CoordinateFrame | undefined): { position: Vec3; rotation: Quat } | undefined {
    const currentTime = this.renderer.currentTime;
    if (!frame || !frame.findClosestTransforms(tempLower, tempUpper, currentTime, MAX_DURATION)) {
      return undefined;
    }
    const transform = tempUpper[1];
    return {
      position: [...transform.position()] as Vec3,
      rotation: [...transform.rotation()] as Quat,
    };
  }

  #buildFrameFields(
    frame: CoordinateFrame | undefined,
    offset: FrameOffset | undefined,
  ): SettingsTreeFields {
    const parentFrameId = frame?.parent()?.id;
    if (!frame || parentFrameId == undefined) {
      return {
        parent: { label: t("threeDee:parent"), input: "string", readonly: true, value: "<root>" },
      };
    }

    const config = this.renderer.config;
    const editable = config.scene.transforms?.editable ?? DEFAULT_EDITABLE;
    const step = ADJUST_STEPS[config.scene.transforms?.adjustStep ?? DEFAULT_ADJUST_STEP];
    const currentTime = this.renderer.currentTime;
    const recorded = this.#recorded(frame);
    let ageValue: string | undefined;
    if (recorded) {
      const transformTime = tempUpper[0];
      ageValue =
        transformTime < currentTime ? formatShortDuration(currentTime - transformTime) : "0 ns";
    }
    const showAdjust = editable || offset != undefined;

    const fields: SettingsTreeFields = {
      parent: {
        label: t("threeDee:parent"),
        input: "string",
        readonly: true,
        value: parentFrameId,
      },
      age: { label: t("threeDee:age"), input: "string", readonly: true, value: ageValue },
      historySize: {
        label: t("threeDee:historySize"),
        input: "string",
        readonly: true,
        value: String(frame.transformsSize()),
      },
      xyz: {
        label: showAdjust ? t("threeDee:recordedTranslation") : t("threeDee:translation"),
        input: "vec3",
        precision: PRECISION_DISTANCE,
        labels: ["X", "Y", "Z"],
        readonly: true,
        value: recorded ? roundVec3(recorded.position, PRECISION_DISTANCE) : undefined,
      },
      rpy: {
        label: showAdjust ? t("threeDee:recordedRotation") : t("threeDee:rotation"),
        input: "vec3",
        precision: PRECISION_ADJUST_DEGREES,
        labels: ["R", "P", "Y"],
        readonly: true,
        value: recorded
          ? roundVec3(quatToRpyDegrees(recorded.rotation), PRECISION_ADJUST_DEGREES)
          : undefined,
      },
    };

    if (!showAdjust) {
      return fields;
    }

    fields.xyzOffset = {
      label: t("threeDee:translationOffset"),
      help: t("threeDee:translationOffsetHelp"),
      input: "vec3",
      precision: PRECISION_DISTANCE,
      step: step.meters,
      labels: ["X", "Y", "Z"],
      readonly: !editable,
      value: offset?.xyz,
    };
    fields.rpyCoefficient = {
      label: t("threeDee:rotationOffset"),
      help: t("threeDee:rotationOffsetHelp"),
      input: "vec3",
      precision: PRECISION_ADJUST_DEGREES,
      step: step.degrees,
      min: -180,
      max: 180,
      labels: ["R", "P", "Y"],
      readonly: !editable,
      value: offset?.rpy,
    };
    if (recorded) {
      const result = applyOffset(recorded.position, recorded.rotation, offset);
      fields.resultXyz = {
        label: t("threeDee:resultTranslation"),
        help: t("threeDee:resultHelp"),
        input: "vec3",
        precision: PRECISION_DISTANCE,
        step: step.meters,
        labels: ["X", "Y", "Z"],
        readonly: !editable,
        value: roundVec3(result.position, PRECISION_DISTANCE),
      };
      fields.resultRpy = {
        label: t("threeDee:resultRotation"),
        help: t("threeDee:resultHelp"),
        input: "vec3",
        precision: PRECISION_ADJUST_DEGREES,
        step: step.degrees,
        labels: ["R", "P", "Y"],
        readonly: !editable,
        value: roundVec3(quatToRpyDegrees(result.rotation), PRECISION_ADJUST_DEGREES),
      };
    }
    return fields;
  }

  #frameActions(
    frame: CoordinateFrame | undefined,
    offset: FrameOffset | undefined,
  ): SettingsTreeNodeAction[] | undefined {
    if (frame?.parent() == undefined) {
      return undefined;
    }
    const editable = this.renderer.config.scene.transforms?.editable ?? DEFAULT_EDITABLE;
    const actions: SettingsTreeNodeAction[] = [];
    if (editable) {
      actions.push({
        type: "action",
        id: "adjust-with-keyboard",
        label: t("threeDee:adjustWithKeyboard"),
      });
      if (offset) {
        actions.push({
          type: "action",
          id: "reset-adjustment",
          label: t("threeDee:resetAdjustment"),
        });
      }
      actions.push({ type: "divider" });
    }
    actions.push(
      { type: "action", id: "copy-urdf", label: t("threeDee:copyAsUrdf") },
      {
        type: "action",
        id: "copy-static-transform-publisher",
        label: t("threeDee:copyAsStaticTransformPublisher"),
      },
      { type: "action", id: "copy-yaml", label: t("threeDee:copyAsYaml") },
    );
    return actions;
  }

  #handleFrameAction(actionId: string, frameId: string): void {
    if (actionId === "adjust-with-keyboard") {
      this.saveSetting(["scene", "transforms", "keyboardFrame"], frameId);
      this.#updateHud();
      return;
    }
    if (actionId === "reset-adjustment") {
      this.#editFrame(frameId, undefined);
      return;
    }
    const frame = this.renderer.transformTree.frame(frameId);
    const parentId = frame?.parent()?.id;
    const recorded = this.#recorded(frame);
    if (parentId == undefined || !recorded) {
      return;
    }
    const { position, rotation } = applyOffset(
      recorded.position,
      recorded.rotation,
      this.#offsetFor(frameId),
    );
    const format =
      actionId === "copy-urdf"
        ? formatUrdfJoint
        : actionId === "copy-static-transform-publisher"
          ? formatStaticTransformPublisher
          : actionId === "copy-yaml"
            ? formatYaml
            : undefined;
    if (format) {
      void clipboard.copy(format(parentId, frameId, position, rotation));
    }
  }

  /** Handles edits of offset and result fields. Returns false for other fields */
  #handleOffsetField(frameId: string, field: string, value: unknown): boolean {
    if (!["xyzOffset", "rpyCoefficient", "resultXyz", "resultRpy"].includes(field)) {
      return false;
    }
    const input = value as Readonly<[number | undefined, number | undefined, number | undefined]>;
    const vec: Vec3 = [input[0] ?? 0, input[1] ?? 0, input[2] ?? 0];
    const offset = this.#offsetFor(frameId) ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] };

    if (field === "xyzOffset") {
      this.#editFrame(frameId, { ...offset, xyz: vec });
    } else if (field === "rpyCoefficient") {
      this.#editFrame(frameId, { ...offset, rpy: vec });
    } else {
      const recorded = this.#recorded(this.renderer.transformTree.frame(frameId));
      if (!recorded) {
        return true;
      }
      const result = applyOffset(recorded.position, recorded.rotation, offset);
      const resultXyz = field === "resultXyz" ? vec : result.position;
      const resultRpy = field === "resultRpy" ? vec : quatToRpyDegrees(result.rotation);
      const next = offsetForResult(recorded.position, recorded.rotation, resultXyz, resultRpy);
      // Keep the untouched half exactly as it was instead of a recomputed approximation
      this.#editFrame(
        frameId,
        field === "resultXyz" ? { ...offset, xyz: next.xyz } : { ...offset, rpy: next.rpy },
      );
    }
    return true;
  }

  #editFrame(frameId: string, offset: FrameOffset | undefined): void {
    // A legacy per-panel offset moves into the layout-wide offsets on its first edit
    const frameKey = `frame:${frameId}`;
    const settings = this.renderer.config.transforms[frameKey];
    if (settings?.xyzOffset != undefined || settings?.rpyCoefficient != undefined) {
      this.renderer.updateConfig((draft) => {
        const draftSettings = draft.transforms[frameKey];
        if (draftSettings) {
          delete draftSettings.xyzOffset;
          delete draftSettings.rpyCoefficient;
        }
      });
    }
    this.#setOffsets(withFrameOffset(this.#offsets, frameId, offset));
  }

  #setOffsets(
    next: TransformOffsets,
    { recordHistory = true }: { recordHistory?: boolean } = {},
  ): void {
    if (recordHistory) {
      const now = Date.now();
      if (now - this.#lastHistoryTime > UNDO_COALESCE_MS) {
        this.#history.push(this.#offsets);
        if (this.#history.length > MAX_UNDO_STEPS) {
          this.#history.shift();
        }
      }
      this.#lastHistoryTime = now;
    }
    this.#published.push({ value: next, time: Date.now() });
    this.#applyOffsets(next);
    this.renderer.emit("setVariable", TRANSFORM_OFFSETS_VARIABLE, next, this.renderer);
  }

  #applyOffsets(next: TransformOffsets): void {
    this.#offsets = next;
    this.#updateFrameAxes();
    this.#updateHud();
    this.updateSettingsTree();
    this.renderer.queueAnimationFrame();
  }

  #setShowOriginal({ showOriginal }: { showOriginal: boolean }): void {
    const { showOriginal: _old, ...rest } = this.#offsets;
    this.#setOffsets(showOriginal ? { ...rest, showOriginal } : rest, { recordHistory: false });
  }

  #undo(): void {
    const previous = this.#history.pop();
    if (previous) {
      this.#lastHistoryTime = 0;
      // Undo restores adjustments, not the A/B comparison state
      const { showOriginal: _old, ...frames } = previous;
      this.#setOffsets(
        this.#offsets.showOriginal === true ? { ...frames, showOriginal: true } : frames,
        { recordHistory: false },
      );
    }
  }

  #handleVariablesChange = (): void => {
    const next = parseTransformOffsets(this.renderer.variables.get(TRANSFORM_OFFSETS_VARIABLE));
    const now = Date.now();
    this.#published = this.#published.filter(({ time }) => now - time <= ECHO_TIMEOUT_MS);
    const index = _.findLastIndex(this.#published, ({ value }) => _.isEqual(value, next));
    if (index >= 0 && index < this.#published.length - 1) {
      // A late echo of an older edit of ours; the newer value is already applied
      this.#published = this.#published.slice(index + 1);
      return;
    }
    // Our latest value came back, or another panel wrote: apply whatever is newest
    this.#published = [];
    if (!_.isEqual(next, this.#offsets)) {
      this.#applyOffsets(next);
    }
  };

  #handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    // Only the panel under the pointer reacts; focus alone would let two panels handle one key
    const forThisPanel = this.renderer.gl.domElement.parentElement?.matches(":hover") === true;
    if (
      !forThisPanel ||
      event.defaultPrevented ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable === true
    ) {
      return;
    }

    const transforms = this.renderer.config.scene.transforms;
    const editable = transforms?.editable ?? DEFAULT_EDITABLE;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key;

    if (!modifier && !event.altKey && key.toLowerCase() === "o") {
      const hasOffsets = Object.keys(this.#offsets.frames).length > 0;
      if (editable || hasOffsets || this.#offsets.showOriginal === true) {
        this.#setShowOriginal({ showOriginal: this.#offsets.showOriginal !== true });
        consume(event);
      }
      return;
    }
    if (!editable) {
      return;
    }
    if (modifier && !event.shiftKey && key.toLowerCase() === "z") {
      if (this.#history.length > 0) {
        this.#undo();
        consume(event);
      }
      return;
    }

    const frameId = transforms?.keyboardFrame;
    if (modifier || frameId == undefined || !NUDGE_KEYS.has(key)) {
      return;
    }
    const step = ADJUST_STEPS[transforms?.adjustStep ?? DEFAULT_ADJUST_STEP];
    const rotate = event.altKey;
    const amount = (rotate ? step.degrees : step.meters) * (event.shiftKey ? 10 : 1);
    const recorded = this.#recorded(this.renderer.transformTree.frame(frameId));
    if (!recorded) {
      return;
    }
    // Step the result values the user reads in the settings, not the offset: pitch 60 -> 60.1
    const offset = this.#offsetFor(frameId) ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    const result = applyOffset(recorded.position, recorded.rotation, offset);
    const next = nudge(
      { xyz: result.position, rpy: quatToRpyDegrees(result.rotation) },
      key as NudgeKey,
      { rotate, amount },
    );
    const nextOffset = offsetForResult(recorded.position, recorded.rotation, next.xyz, next.rpy);
    this.#editFrame(
      frameId,
      rotate ? { ...offset, rpy: nextOffset.rpy } : { ...offset, xyz: nextOffset.xyz },
    );
    consume(event);
  };

  #updateHud(): void {
    const hud = this.renderer.hud;
    const transforms = this.renderer.config.scene.transforms;
    const frameId =
      (transforms?.editable ?? DEFAULT_EDITABLE) ? transforms?.keyboardFrame : undefined;
    if (frameId !== this.#hudFrameId) {
      this.#hudFrameId = frameId;
      hud.removeHUDItem(KEYBOARD_HUD_ID);
      if (frameId != undefined) {
        hud.addHUDItem({
          id: KEYBOARD_HUD_ID,
          group: FrameAxes.extensionId,
          displayType: "notice",
          getMessage: () => t("threeDee:keyboardHud", { frame: frameId }),
        });
      }
    }
    hud.displayIfTrue(this.#offsets.showOriginal === true, {
      id: ORIGINAL_HUD_ID,
      group: FrameAxes.extensionId,
      displayType: "notice",
      getMessage: () => t("threeDee:showingOriginalHud"),
    });
  }

  #updateFrameAxes(): void {
    for (const renderable of this.renderables.values()) {
      this.#updateFrameAxis(renderable);
    }
  }

  #updateFrameAxis(renderable: FrameAxisRenderable): void {
    const frameId = renderable.userData.frameId;
    // Don't re-create frames that were cleared and haven't come back yet
    const frame = this.renderer.transformTree.frame(frameId);
    if (!frame) {
      return;
    }

    // Layout-wide offsets apply in every panel, unless comparing against the original
    const shared = this.#offsets.frames[frameId];
    if (this.#offsets.showOriginal === true || shared) {
      frame.offsetPosition = shared && this.#offsets.showOriginal !== true ? shared.xyz : undefined;
      frame.offsetEulerDegrees =
        shared && this.#offsets.showOriginal !== true ? shared.rpy : undefined;
      return;
    }

    // Legacy per-panel offsets (and URDF manual joints) only apply while editable
    const editable = this.renderer.config.scene.transforms?.editable ?? DEFAULT_EDITABLE;
    if (!editable) {
      frame.offsetPosition = undefined;
      frame.offsetEulerDegrees = undefined;
      return;
    }

    const frameKey = `frame:${renderable.userData.frameId}`;
    frame.offsetPosition = getOffset(this.renderer.config.transforms[frameKey]?.xyzOffset);
    frame.offsetEulerDegrees = getOffset(this.renderer.config.transforms[frameKey]?.rpyCoefficient);
  }
}
function createLineGeometry(): LineGeometry {
  const lineGeometry = new LineGeometry();
  lineGeometry.setPositions([0, 0, 0, 1, 0, 0]);
  return lineGeometry;
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function roundVec3(v: Readonly<Vec3>, precision: number): Vec3 {
  return [round(v[0], precision), round(v[1], precision), round(v[2], precision)];
}

const MS_TENTH_NS = BigInt(1e5);
const MS_NS = BigInt(1e6);
const SEC_NS = BigInt(1e9);
const MIN_NS = BigInt(6e10);
const HOUR_NS = BigInt(3.6e12);

function formatShortDuration(duration: Duration): string {
  const absDuration = abs(duration);
  if (absDuration < MS_TENTH_NS) {
    return `${duration} ns`;
  } else if (absDuration < SEC_NS) {
    return `${Number(duration / MS_NS).toFixed(1)} ms`;
  } else if (absDuration < MIN_NS) {
    return `${Number(duration / SEC_NS).toFixed(1)} s`;
  } else if (absDuration < HOUR_NS) {
    return `${Number(duration / MIN_NS).toFixed(1)} min`;
  } else {
    return `${Number(duration / HOUR_NS).toFixed(1)} hr`;
  }
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function round(x: number, precision: number): number {
  return Number(x.toFixed(precision));
}

function getOffset(
  maybeOffset: Readonly<[number | undefined, number | undefined, number | undefined]> | undefined,
): THREE.Vector3Tuple | undefined {
  if (!maybeOffset) {
    return undefined;
  }
  const [x = 0, y = 0, z = 0] = maybeOffset;
  if (x === 0 && y === 0 && z === 0) {
    return undefined;
  }
  return [x, y, z];
}
