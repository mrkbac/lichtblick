// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@foxglove/rostime";
import type { FrameTransform, FrameTransforms, SceneUpdate } from "@foxglove/schemas";
import EventEmitter from "eventemitter3";
import { quat, vec3 } from "gl-matrix";
import i18next from "i18next";
import { produce } from "immer";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import * as THREE from "three/webgpu";
import { DeepPartial, assert } from "ts-essentials";

import { CameraModelsMap } from "@lichtblick/den/image/types";
import Logger from "@lichtblick/log";
import {
  Immutable,
  MessageEvent,
  ParameterValue,
  SettingsIcon,
  SettingsTreeAction,
  SettingsTreeNodeActionItem,
  Topic,
  VariableValue,
} from "@lichtblick/suite";
import { PanelContextMenuItem } from "@lichtblick/suite-base/components/PanelContextMenu";
import {
  Asset,
  BuiltinPanelExtensionContext,
  DraggedMessagePath,
  MessagePathDropStatus,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import {
  HUDItemManager,
  HUDItem,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/HUDItemManager";
import { LayerErrors, Path } from "@lichtblick/suite-base/panels/ThreeDeeRender/LayerErrors";
import { DEFAULT_MESH_UP_AXIS } from "@lichtblick/suite-base/panels/ThreeDeeRender/defaults";
import { ICameraHandler } from "@lichtblick/suite-base/panels/ThreeDeeRender/renderables/ICameraHandler";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";
import { showHideAllValue } from "@lichtblick/suite-base/panels/shared/topicList";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";
import { toError } from "@lichtblick/suite-base/util/toError";
import { palette, fontMonospace } from "@lichtblick/theme";

import { DynamicBufferGeometry } from "./DynamicBufferGeometry";
import {
  InstancedLineMaterial,
  RendererConfig,
  RendererEvents,
  RendererSubscription,
  TestOptions,
  AddMessageEventOptions,
} from "./IRenderer";
import { Input } from "./Input";
import { ModelCache } from "./ModelCache";
import { PickableLabelPool } from "./PickableLabelPool";
import { PickedRenderable, PickResult, Picker } from "./Picker";
import type { Renderable } from "./Renderable";
import { SceneExtension } from "./SceneExtension";
import { SceneExtensionConfig } from "./SceneExtensionConfig";
import { ScreenOverlay } from "./ScreenOverlay";
import { SettingsManager, SettingsTreeEntry } from "./SettingsManager";
import { SharedGeometry } from "./SharedGeometry";
import type { SharedMap } from "./SharedMap";
import { TimestampSynchronizer } from "./TimestampSynchronizer";
import { CameraState } from "./camera";
import { DARK_OUTLINE, LIGHT_OUTLINE, stringToRgb } from "./color";
import { HOVER_PICK_THROTTLE_MS } from "./constants";
import { FRAME_TRANSFORMS_DATATYPES, FRAME_TRANSFORM_DATATYPES } from "./foxglove";
import { getGpuDevice } from "./gpuDevice";
import { LAYER_DEFAULT, LAYER_PICK_ONLY, LAYER_SELECTED } from "./layers";
import { DetailLevel } from "./lod";
import {
  normalizeFrameTransform,
  normalizeFrameTransforms,
  normalizeTFMessage,
  normalizeTransformStamped,
} from "./normalizeMessages";
import { CameraStateSettings } from "./renderables/CameraStateSettings";
import { ImageMode } from "./renderables/ImageMode/ImageMode";
import { MeasurementTool } from "./renderables/MeasurementTool";
import { PublishClickTool } from "./renderables/PublishClickTool";
import { Urdfs } from "./renderables/Urdfs";
import { MarkerPool } from "./renderables/markers/MarkerPool";
import { MAX_POINT_SETS, PointRaster } from "./renderables/pointClouds/PointRaster";
import {
  Header,
  MarkerArray,
  Quaternion,
  TFMessage,
  TF_DATATYPES,
  TRANSFORM_STAMPED_DATATYPES,
  TransformStamped,
  Vector3,
} from "./ros";
import { SelectEntry } from "./settings";
import { customLayersRootNode, topicsRootNode } from "./settingsNodes/global";
import { AddTransformResult, CoordinateFrame, TransformTree, Transform } from "./transforms";
import { InterfaceMode } from "./types";

const log = Logger.getLogger(__filename);

/** Menu item entry and callback for the "Custom Layers" menu */
export type CustomLayerAction = {
  action: SettingsTreeNodeActionItem;
  handler: (instanceId: string) => void;
};

// Maximum number of objects to present as selection options in a single click
const MAX_SELECTIONS = 10;
/** Longest wait between repaints while transform history batches arrive */
const HISTORY_REPAINT_MS = 250;

// NOTE: These do not use .convertSRGBToLinear() since background color is not
// affected by gamma correction
const LIGHT_BACKDROP = new THREE.Color(palette.light.background?.default);
const DARK_BACKDROP = new THREE.Color(palette.dark.background?.default);

// Define rendering layers for multipass rendering used for the selection effect

const FOLLOW_TF_PATH = ["general", "followTf"];
/** Expected until the first transform arrives, so it is not reported in the panel log. */
export const NO_FRAME_SELECTED = "NO_FRAME_SELECTED";
const CYCLE_DETECTED = "CYCLE_DETECTED";
const FOLLOW_FRAME_NOT_FOUND = "FOLLOW_FRAME_NOT_FOUND";
const ADD_TRANSFORM_ERROR = "ADD_TRANSFORM_ERROR";
const LABEL_ATLAS_ERROR = "LABEL_ATLAS_ERROR";

// An extensionId for creating the top-level settings nodes such as "Topics" and
// "Custom Layers"
const RENDERER_ID = "foxglove.Renderer";

const TRANSFORM_SCHEMAS = [
  FRAME_TRANSFORM_DATATYPES,
  FRAME_TRANSFORMS_DATATYPES,
  TF_DATATYPES,
  TRANSFORM_STAMPED_DATATYPES,
];

const WAITING_FOR_TIMESTAMP_SYNC_HUD_ITEM: HUDItem = {
  id: "WAITING_FOR_TIMESTAMP_SYNC",
  group: RENDERER_ID,
  getMessage: () => i18next.t("threeDee:waitingForSyncMessages"),
  displayType: "notice",
};
/**
 * temp variables declared here to avoid unnecessary allocations and
 * subsequent garbage collection in high frequency operations
 */
const tempColor = new THREE.Color();
const tempVec2 = new THREE.Vector2();
// for transforms
const tempVec3: vec3 = [0, 0, 0];
const tempQuat: quat = [0, 0, 0, 1];
const tempTransform = Transform.Identity();

/**
 * three's WebGPU renderer starts a requestAnimationFrame loop on its first `render()` and never stops
 * it, even with no animation loop set. That loop only advances the node frame (frame id and time),
 * yet keeps every panel waking the browser 60 times a second while paused. We render on demand:
 * stop the loop and return the frame advance for the renderer to call once per drawn frame. Pick
 * passes and compute() calls in between reuse the current frame, so three's per-frame caches
 * (shadow maps among them) are not redrawn for them.
 */
export function stopThreeAnimationLoop(gl: THREE.WebGPURenderer): () => void {
  const internals = gl as unknown as {
    _animation?: { start?: () => void; stop?: () => void } | null;
    _nodes?: { nodeFrame?: { update?: () => void; frameId?: number } } | null;
  };
  const { _animation: animation, _nodes: nodes } = internals;
  const nodeFrame = nodes?.nodeFrame;
  // Private three API: if a three upgrade renames it, keep rendering with the loop running
  if (animation?.stop == undefined || nodeFrame?.update == undefined) {
    log.warn("three.js internals changed; its idle animation loop keeps running");
    return () => {};
  }
  animation.stop();
  animation.start = () => {};
  return () => {
    nodeFrame.update?.();
    // GPU timestamp queries are keyed by frame, as three's loop did
    // Read-only in three's types; three's own loop writes it the same way
    (gl.info as { frame: number }).frame = nodeFrame.frameId ?? gl.info.frame;
  };
}

type StaticTransform = {
  /** Topic it came from, so it can be dropped when the topic goes away */
  topic: string;
  parentFrameId: string;
  childFrameId: string;
  stamp: bigint;
  translation: Vector3;
  rotation: Quaternion;
};

/** Whether a topic name follows the `/tf_static`-style naming convention for latched, permanently valid transforms */
function isStaticTransformTopic(topic: string): boolean {
  return topic.endsWith("tf_static") || topic.endsWith("static_transform");
}

/**
 * An extensible 3D renderer attached to a `HTMLCanvasElement`,
 * `WebGLRenderingContext`, and `SettingsTree`.
 */
const TEXTURE_TOO_LARGE = "TEXTURE_TOO_LARGE";
const POINTS_NOT_DRAWN = "POINTS_NOT_DRAWN";

/** Settings path of the renderable `object` belongs to; children may carry an empty one */
function settingsPathOf(object: THREE.Object3D): Path | undefined {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const path = (node.userData as { settingsPath?: Path }).settingsPath;
    if (path && path.length > 0) {
      return path;
    }
  }
  return undefined;
}

export class Renderer extends EventEmitter<RendererEvents> {
  public readonly interfaceMode: InterfaceMode;
  #canvas: HTMLCanvasElement;
  readonly #ownerWindow: Window & typeof globalThis;
  // The label atlas never shrinks, so an overflow stays true across clear()
  #labelAtlasError: string | undefined;
  public readonly gl: THREE.WebGPURenderer;
  /** Set once the WebGPU device is ready; until then frames update the scene without drawing */
  #gpuReady = false;
  /** Layers with a POINTS_NOT_DRAWN error, by joined path */
  #skippedPointPaths = new Map<string, Path>();
  /** GPU milliseconds of the last measured frame (render + compute), when stats are enabled */
  public gpuTimeMs: number | undefined;
  #measuringGpu = false;
  #framesSinceGpuMeasure = 0;
  /** Resolves once the GPU is ready to draw (or failed to start; see gpuError) */
  public readonly ready: Promise<void>;
  /** Why WebGPU could not start, if it couldn't (also emitted as `gpuUnsupported`) */
  public gpuError: Error | undefined;
  /** Set once the device is lost (emitted as `gpuLost` unless it happened during startup) */
  public gpuLost = false;
  public readonly sharedMap?: SharedMap;
  public maxLod = DetailLevel.High;

  public customCameraModels: CameraModelsMap = new Map();

  public debugPicking: boolean;
  public config: Immutable<RendererConfig>;
  public settings: SettingsManager;
  // [{ name, datatype }]
  public topics: ReadonlyArray<Topic> | undefined;
  // topicName -> { name, datatype }
  public topicsByName: ReadonlyMap<string, Topic> | undefined;
  // parameterKey -> parameterValue
  public parameters: ReadonlyMap<string, ParameterValue> | undefined;
  // variableName -> variableValue
  public variables: ReadonlyMap<string, VariableValue> = new Map();
  // extensionId -> SceneExtension
  public sceneExtensions = new Map<string, SceneExtension>();
  // datatype -> RendererSubscription[]
  public schemaSubscriptions = new Map<string, RendererSubscription[]>();
  // topicName -> RendererSubscription[]
  public topicSubscriptions = new Map<string, RendererSubscription[]>();

  /** HUD manager instance */
  public hud;
  /** Holds back messages on topics marked "Sync" until their timestamps match */
  #timestampSync = new TimestampSynchronizer();
  /** Inputs `#timestampSync`'s topics were last computed from */
  #timestampSyncInputs: [unknown, unknown] = [undefined, undefined];
  /** Items to display in the HUD */
  public hudItems: HUDItem[] = [];
  // layerId -> { action, handler }
  #customLayerActions = new Map<string, CustomLayerAction>();
  #scene: THREE.Scene;
  #dirLight: THREE.DirectionalLight;
  /** Camera-attached directional light used when `scene.mainLightMode` is `"headlight"` */
  readonly #headLight: THREE.DirectionalLight;
  #hemiLight: THREE.HemisphereLight;
  public input: Input;
  public readonly outlineMaterial = new THREE.LineBasicMaterial({ dithering: true });
  public readonly instancedOutlineMaterial = new InstancedLineMaterial({ dithering: true });

  /** only public for testing - prefer to use `getCameraState` instead */
  public cameraHandler: ICameraHandler;

  #imageModeExtension?: ImageMode;

  public measurementTool: MeasurementTool;
  public publishClickTool: PublishClickTool;
  /** True while clicks pick frames for the frame-to-frame measurement instead of selecting */
  public framePicking = false;

  // Are we connected to a ROS data source? Normalize coordinate frames if so by
  // stripping any leading "/" prefix. See `normalizeFrameId()` for details.
  public ros = false;

  #picker: Picker;
  /** Draws every point set (point clouds, scans, depth clouds) with compute rasterization */
  public readonly pointRaster: PointRaster;
  #selectionBackdropScene: THREE.Scene;
  #selectionBackdrop: ScreenOverlay;
  #selectedRenderable: PickedRenderable | undefined;
  public colorScheme: "dark" | "light" = "light";
  public modelCache: ModelCache;

  public transformTree = new TransformTree();
  readonly #staticTransformCache = new Map<string, StaticTransform>();
  #touchedFrameIds: Set<string> | undefined;

  public coordinateFrameList: SelectEntry[] = [];
  // While > 0, transform tree changes are collected and announced once at the end of the batch
  #transformTreeBatchDepth = 0;
  #transformTreeDirty = false;
  public currentTime = 0n;
  public fixedFrameId: string | undefined;
  public followFrameId: string | undefined;

  public labelPool = new PickableLabelPool({ fontFamily: fontMonospace });
  public markerPool = new MarkerPool(this);
  public sharedGeometry = new SharedGeometry();

  #pickingEnabled = false;
  /** Latest click and hover pick, so only its readback reports */
  #clickPickRequest = 0;
  #hoverPickRequest = 0;
  #rendering = false;
  #disposed = false;
  #animationFrame?: number;
  /** Advances three's node frame; once per drawn frame (see stopThreeAnimationLoop) */
  #advanceNodeFrame = (): void => {};
  #historyRepaintTimer: ReturnType<typeof setTimeout> | undefined;
  #historyRepaintPending = false;
  #cameraSyncError: undefined | string;
  #devicePixelRatioMediaQuery?: MediaQueryList;
  #fetchAsset: BuiltinPanelExtensionContext["unstable_fetchAsset"];

  public readonly displayTemporaryError?: (str: string) => void;
  /** Options passed for local testing and storybook. */
  public readonly testOptions: TestOptions;

  public constructor(args: {
    canvas: HTMLCanvasElement;
    sharedMap?: SharedMap;
    config: Immutable<RendererConfig>;
    interfaceMode: InterfaceMode;
    sceneExtensionConfig: SceneExtensionConfig;
    customCameraModels: CameraModelsMap;
    fetchAsset: BuiltinPanelExtensionContext["unstable_fetchAsset"];
    displayTemporaryError?: (message: string) => void;
    testOptions: TestOptions;
  }) {
    super();
    this.customCameraModels = args.customCameraModels;
    this.displayTemporaryError = args.displayTemporaryError;
    // NOTE: Global side effect
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

    const interfaceMode = (this.interfaceMode = args.interfaceMode);
    const canvas = (this.#canvas = args.canvas);
    this.sharedMap = args.sharedMap;
    this.#ownerWindow = canvas.ownerDocument.defaultView ?? window;
    const config = (this.config = args.config);
    this.#fetchAsset = args.fetchAsset;
    this.testOptions = args.testOptions;
    this.debugPicking = args.testOptions.debugPicking ?? false;

    this.hud = new HUDItemManager(this.#onHUDItemsChange);

    this.settings = new SettingsManager(baseSettingsTree(this.interfaceMode));
    this.settings.decorateEntry = this.#addSyncField;
    this.settings.on("update", () => this.emit("settingsTreeChange", this));
    // Add the top-level nodes first so merging happens in the correct order.
    // Another approach would be to modify SettingsManager to allow merging parent
    // nodes in after their children
    this.settings.setNodesForKey(RENDERER_ID, []);
    this.updateCustomLayersCount();

    this.gl = new THREE.WebGPURenderer({
      canvas,
      alpha: true,
      antialias: true,
      // Line materials use a stencil prepass
      stencil: true,
      // Fixed at creation; the panel recreates the renderer when this setting changes
      logarithmicDepthBuffer: config.scene.logDepth === true,
      // GPU time per frame for the stats overlay; fixed at creation like logDepth
      trackTimestamp: config.scene.enableStats === true,
    });
    this.ready = this.#initGpu();
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    this.gl.shadowMap.type = THREE.VSMShadowMap;
    this.gl.sortObjects = true;
    this.gl.setPixelRatio(this.#ownerWindow.devicePixelRatio);

    let width = canvas.width;
    let height = canvas.height;
    if (canvas.parentElement) {
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      this.gl.setSize(width, height);
    }

    this.labelPool.addEventListener("error", ({ error }) => {
      this.#labelAtlasError = error.message;
      this.settings.errors.add(["scene"], LABEL_ATLAS_ERROR, error.message);
    });

    this.modelCache = new ModelCache({
      ignoreColladaUpAxis: config.scene.ignoreColladaUpAxis ?? false,
      meshUpAxis: config.scene.meshUpAxis ?? DEFAULT_MESH_UP_AXIS,
      edgeMaterial: this.outlineMaterial,
      fetchAsset: this.#fetchAsset,
    });

    this.#scene = new THREE.Scene();
    // Every draw and pick of the scene updates its world matrices first (the point raster needs
    // them before render()); render() would walk the whole graph a second time
    this.#scene.matrixWorldAutoUpdate = false;

    this.#dirLight = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.#dirLight.position.set(1, 1, 1);
    this.#dirLight.castShadow = true;
    this.#dirLight.layers.enableAll();

    this.#dirLight.shadow.mapSize.width = 2048;
    this.#dirLight.shadow.mapSize.height = 2048;
    this.#dirLight.shadow.camera.near = 0.5;
    this.#dirLight.shadow.camera.far = 500;
    this.#dirLight.shadow.bias = -0.00001;

    this.#headLight = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.#headLight.layers.enableAll();
    this.#headLight.castShadow = true;
    this.#headLight.shadow.mapSize.width = 2048;
    this.#headLight.shadow.mapSize.height = 2048;
    this.#headLight.shadow.camera.near = 0.5;
    this.#headLight.shadow.camera.far = 500;
    this.#headLight.shadow.bias = -0.00001;

    this.#hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5 * Math.PI);
    this.#hemiLight.layers.enableAll();

    this.#scene.add(this.#dirLight);
    this.#scene.add(this.#hemiLight);
    this.updateSceneRenderSettings();

    this.input = new Input(canvas, () => this.cameraHandler.getActiveCamera());
    this.input.on("resize", (size) => {
      this.#resizeHandler(size);
    });
    this.input.on("click", (cursorCoords) => {
      this.#clickHandler(cursorCoords);
    });

    // Throttled hover picking: perform GPU pick on mousemove at 10 Hz
    // Mouse position is emitted on every move for smooth tooltip following.
    let hoverThrottleTimer: ReturnType<typeof setTimeout> | undefined;
    let isMouseDown = false;
    this.input.on("mousedown", () => {
      isMouseDown = true;
    });
    this.input.on("mouseup", () => {
      isMouseDown = false;
    });
    this.input.on("mousemove", (cursorCoords) => {
      if (isMouseDown || !this.#pickingEnabled) {
        return;
      }
      this.emit("hoverMoved", cursorCoords, this);
      if (hoverThrottleTimer != undefined) {
        return;
      }
      hoverThrottleTimer = setTimeout(() => {
        hoverThrottleTimer = undefined;
      }, HOVER_PICK_THROTTLE_MS);
      this.#hoverHandler(cursorCoords);
    });

    this.#picker = new Picker(this.gl, this.#scene, (camera, hidden) => {
      this.pointRaster.preparePick(camera, hidden);
    });
    this.pointRaster = new PointRaster(this.gl, this.#scene, {
      logDepth: config.scene.logDepth === true,
    });

    this.#selectionBackdrop = new ScreenOverlay(this);
    this.#selectionBackdropScene = new THREE.Scene();
    this.#selectionBackdropScene.add(this.#selectionBackdrop);

    const renderSize = this.gl.getDrawingBufferSize(tempVec2);

    const { reserved } = args.sceneExtensionConfig;

    this.measurementTool = reserved.measurementTool.init(this);
    this.publishClickTool = reserved.publishClickTool.init(this);
    this.#addSceneExtension(this.measurementTool);
    this.#addSceneExtension(this.publishClickTool);

    const aspect = renderSize.width / renderSize.height;
    switch (interfaceMode) {
      case "image": {
        const imageMode = reserved.imageMode.init(this);
        this.#imageModeExtension = imageMode;
        this.cameraHandler = this.#imageModeExtension;
        this.#imageModeExtension.addEventListener("hasModifiedViewChanged", () => {
          this.emit("resetViewChanged", this);
        });
        this.#addSceneExtension(this.#imageModeExtension);
        break;
      }
      case "3d": {
        this.cameraHandler = new CameraStateSettings(this, this.#canvas, aspect);
        this.#addSceneExtension(this.cameraHandler);
        break;
      }
    }

    const { extensionsById } = args.sceneExtensionConfig;
    for (const extensionItem of Object.values(extensionsById)) {
      if (
        extensionItem.supportedInterfaceModes == undefined ||
        extensionItem.supportedInterfaceModes.includes(interfaceMode)
      ) {
        this.#addSceneExtension(extensionItem.init(this));
      }
    }

    log.debug(
      `Renderer initialized with scene extensions ${Array.from(this.sceneExtensions.keys()).join(
        ", ",
      )}`,
    );

    if (interfaceMode === "image" && config.imageMode.calibrationTopic == undefined) {
      this.enableImageOnlySubscriptionMode();
    } else {
      this.#addTransformSubscriptions();
      this.#addSubscriptionsFromSceneExtensions();
    }

    this.#watchDevicePixelRatio();
    this.#canvas.ownerDocument.addEventListener("visibilitychange", this.#onVisibilityChange);

    this.setCameraState(config.cameraState);
    this.sharedMap?.attach(this, this.#drawScene);
    this.animationFrame();
  }

  /**
   * Starts the WebGPU device. There is no WebGL fallback: three.js would silently pick its WebGL2
   * backend, which can't run the compute passes, so that is reported as an error instead.
   */
  async #initGpu(): Promise<void> {
    try {
      const device = await getGpuDevice();
      // A replacement renderer may already be starting on this canvas
      if (this.#disposed) {
        return;
      }
      if (!device) {
        this.#reportGpuError(new Error(i18next.t("threeDee:webGpuRequired")));
        return;
      }
      // The renderer copied its parameters; hand it the shared device before it creates its own
      (this.gl.backend as unknown as { parameters: { device?: GPUDevice } }).parameters.device =
        device;
      // Installed before init, which subscribes to the device's loss: a device that is already
      // lost reports it during startup, before the panel may have subscribed to `gpuLost`
      const threeOnDeviceLost = this.gl.onDeviceLost;
      this.gl.onDeviceLost = (info) => {
        // three marks itself lost and skips further draws
        threeOnDeviceLost.call(this.gl, info);
        const wasReady = this.#gpuReady;
        this.#gpuReady = false;
        this.gpuLost = true;
        if (wasReady && !this.#disposed) {
          this.emit("gpuLost", this);
        }
      };
      await this.gl.init();
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- set while awaiting init
      if (this.#disposed || this.gpuLost) {
        return;
      }
      if ((this.gl.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend !== true) {
        throw new Error("three.js fell back to WebGL");
      }
      this.#advanceNodeFrame = stopThreeAnimationLoop(this.gl);
      this.#gpuReady = true;
      for (const extension of this.sceneExtensions.values()) {
        extension.gpuReady();
      }
      this.queueAnimationFrame();
    } catch (error) {
      log.error(error);
      // The browser has WebGPU (or there would be no device), so it is a startup failure
      this.#reportGpuError(
        new Error(i18next.t("threeDee:webGpuStartFailed", { error: toError(error).message })),
      );
    }
  }

  /**
   * Whether a `width` x `height` texture fits the GPU, reporting a settings error on `topic` when
   * it doesn't (WebGPU rejects it, which would invalidate the whole frame). Until the device is
   * ready this checks against WebGPU's guaranteed 8192; SceneExtension.gpuReady runs it again.
   */
  public checkTextureSize(topic: string, width: number, height: number): boolean {
    const limit =
      (this.gl.backend as { device?: GPUDevice | null }).device?.limits.maxTextureDimension2D ??
      8192;
    const fits = width <= limit && height <= limit;
    if (fits) {
      this.settings.errors.removeFromTopic(topic, TEXTURE_TOO_LARGE);
    } else {
      this.settings.errors.addToTopic(
        topic,
        TEXTURE_TOO_LARGE,
        `${width} x ${height} cells is larger than this GPU's texture limit of ${limit} per side`,
      );
    }
    return fits;
  }

  #reportGpuError(error: Error): void {
    this.gpuError = error;
    this.emit("gpuUnsupported", error, this);
  }

  /**
   * Reads back the GPU time of the frames drawn since the last readback (timestamps resolve a few
   * frames late and cover every frame since) and averages it per frame.
   */
  async #measureGpuTime(): Promise<void> {
    this.#measuringGpu = true;
    const frames = this.#framesSinceGpuMeasure;
    this.#framesSinceGpuMeasure = 0;
    try {
      const [render, compute] = await Promise.all([
        this.gl.resolveTimestampsAsync("render"),
        this.gl.resolveTimestampsAsync("compute"),
      ]);
      if (frames > 0 && (render != undefined || compute != undefined)) {
        this.gpuTimeMs = ((render ?? 0) + (compute ?? 0)) / frames;
      }
    } finally {
      this.#measuringGpu = false;
    }
  }

  #onHUDItemsChange = () => {
    this.hudItems = this.hud.getHUDItems();
    this.emit("hudItemsChanged", this);
  };

  #onVisibilityChange = () => {
    if (this.#canvas.ownerDocument.visibilityState === "visible") {
      this.queueAnimationFrame();
    }
  };

  #onDevicePixelRatioChange = () => {
    log.debug(`devicePixelRatio changed to ${this.#ownerWindow.devicePixelRatio}`);
    this.#resizeHandler(this.input.canvasSize);
    this.#watchDevicePixelRatio();
  };

  #watchDevicePixelRatio() {
    this.#devicePixelRatioMediaQuery = this.#ownerWindow.matchMedia(
      `(resolution: ${this.#ownerWindow.devicePixelRatio}dppx)`,
    );
    this.#devicePixelRatioMediaQuery.addEventListener("change", this.#onDevicePixelRatioChange, {
      once: true,
    });
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    // Save a camera move that is still waiting for the camera to rest, while the panel still
    // listens for config changes, so the next renderer starts from it
    this.cameraHandler.commitPendingCameraState();
    this.#disposed = true;
    this.sharedMap?.detach(this);
    if (this.#animationFrame != undefined) {
      this.#ownerWindow.cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = undefined;
    }
    clearTimeout(this.#historyRepaintTimer);
    log.warn(`Disposing renderer`);
    this.#devicePixelRatioMediaQuery?.removeEventListener("change", this.#onDevicePixelRatioChange);
    this.#canvas.ownerDocument.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.removeAllListeners();

    this.settings.removeAllListeners();
    this.input.removeAllListeners();

    for (const extension of this.sceneExtensions.values()) {
      extension.dispose();
    }
    this.sceneExtensions.clear();
    this.sharedGeometry.dispose();
    this.modelCache.dispose();

    this.#headLight.removeFromParent();
    this.#headLight.target.removeFromParent();
    this.#headLight.dispose();
    this.labelPool.dispose();
    this.markerPool.dispose();
    this.#picker.dispose();
    this.pointRaster.dispose();
    this.input.dispose();
    // The shared device's loss reaction keeps three's renderer alive; this callback must not keep
    // the whole panel (scene, extensions, messages) alive with it.
    // ponytail: three's renderer shell and canvas stay retained until device loss; needs a
    // removable loss subscription upstream to fix
    this.gl.onDeviceLost = () => {};
    // Rejects when startup failed, which was already reported
    this.gl.dispose().catch((error: unknown) => {
      log.debug(error);
    });
  }

  public cameraSyncError(): undefined | string {
    return this.#cameraSyncError;
  }

  public setCameraSyncError(error: undefined | string): void {
    this.#cameraSyncError = error;
    // Updates the settings tree for camera state settings to account for any changes in the config.
    this.cameraHandler.updateSettingsTree();
  }

  public getPixelRatio(): number {
    return this.gl.getPixelRatio();
  }

  /**
   *
   * @param currentTime what renderer.currentTime will be set to
   */
  public setCurrentTime(newTimeNs: bigint): void {
    this.currentTime = newTimeNs;
    this.transformTree.setReceivedUntil(newTimeNs);
  }

  /**
   * Updates renderer state according to seek delta. Handles clearing of future state and resetting of allFrames cursor if seeked backwards
   * Should be called after `setCurrentTime` as been called
   * @param oldTime used to determine if seeked backwards
   */
  public handleSeek(oldTimeNs: bigint): void {
    // A complete tree holds the whole history, so it is right at any time. Otherwise transforms
    // from the future of the new time must go.
    const movedBack = this.currentTime < oldTimeNs && !this.transformTree.isComplete();

    // One tree update for the clear and the static transforms put back
    this.#batchTransformTreeUpdates(() => {
      this.clear({ clearTransforms: movedBack, preserveStaticTransforms: movedBack });
      if (movedBack) {
        this.#reapplyStaticTransforms();
      }
    });
  }

  /**
   * Feed the transform history of a recording (range reads, see ThreeDeeRender) straight into the
   * transform tree. Samples already in the tree are replaced, so overlapping reads are harmless.
   */
  public addTransformMessages(
    messageEvents: readonly MessageEvent[],
    /** Collects the child frames these messages gave a transform */
    touchedFrameIds?: Set<string>,
  ): void {
    this.#touchedFrameIds = touchedFrameIds;
    this.#batchTransformTreeUpdates(() => {
      for (const messageEvent of messageEvents) {
        for (const subscription of this.schemaSubscriptions.get(messageEvent.schemaName) ?? []) {
          if (subscription.preload === true) {
            subscription.handler(messageEvent);
          }
        }
      }
    });
    this.#touchedFrameIds = undefined;
    // A batch can replace or thin samples that are on screen, even one received after the current
    // time, so every non-empty batch repaints, throttled
    if (messageEvents.length > 0) {
      this.#queueHistoryRepaint();
    }
  }

  /**
   * Repaints for history reads at most every HISTORY_REPAINT_MS, plus once after the last batch:
   * a full frame per batch would hold the main thread and slow the read down
   */
  #queueHistoryRepaint(): void {
    if (this.#historyRepaintTimer != undefined) {
      this.#historyRepaintPending = true;
      return;
    }
    this.queueAnimationFrame();
    this.#historyRepaintTimer = setTimeout(() => {
      this.#historyRepaintTimer = undefined;
      if (this.#historyRepaintPending) {
        this.#historyRepaintPending = false;
        this.#queueHistoryRepaint();
      }
    }, HISTORY_REPAINT_MS);
  }

  /**
   * Starts the transform history over: clears the tree and drops cached static transforms from
   * topics no longer read, then restores the remaining static ones.
   */
  public resetTransformHistory(topics: ReadonlySet<string>): void {
    for (const [childFrameId, { topic }] of this.#staticTransformCache) {
      if (!topics.has(topic)) {
        this.#staticTransformCache.delete(childFrameId);
      }
    }
    this.transformTree.setComplete(false);
    this.transformTree.clear();
    this.#reapplyStaticTransforms();
    this.#transformTreeUpdated();
  }

  /** Whether the frame's transform came from a static transform topic */
  public isStaticTransformFrame(frameId: string): boolean {
    return this.#staticTransformCache.has(frameId);
  }

  #reapplyStaticTransforms(): void {
    const cache = this.#staticTransformCache;
    this.#batchTransformTreeUpdates(() => {
      for (const [childFrameId, { parentFrameId, stamp, translation, rotation }] of cache) {
        const result = this.addTransform(parentFrameId, childFrameId, stamp, translation, rotation);
        if (result === AddTransformResult.CYCLE_DETECTED) {
          // The cached transform no longer fits the tree (e.g. an intervening dynamic transform
          // now makes it cyclic); drop it so later backward seeks stop retrying it.
          cache.delete(childFrameId);
        }
      }
    });
  }

  /**
   * Clears:
   *  - Rendered objects (a backfill is performed to ensure that they are regenerated with new messages from current frame)
   *  - Errors in settings. Messages that caused errors in the past are cleared, but will be re-added if they are still causing errors when read in.
   *  - [Optional] Transform tree. This should be set to true when a seek to a previous time is performed in order to flush potential future state to the newly set time.
   * @param {Object} params - modifiers to the clear operation
   * @param {boolean} params.clearTransforms - whether to clear the transform tree. This should be set to true when a seek to a previous time is performed in order
   * order to flush potential future state to the newly set time.
   * Order to clear ImageMode renderables or not. Defaults to true. Not relevant in 3D panel.
   * @param {boolean} params.clearImageModeExtension - whether to reset ImageMode renderables in clear.
   * @param {boolean} params.preserveStaticTransforms - whether to preserve the static transform cache during a transform tree clear.
   */
  public clear(
    {
      clearTransforms,
      clearImageModeExtension = true,
      preserveStaticTransforms = false,
    }: {
      clearTransforms?: boolean;
      clearImageModeExtension?: boolean;
      preserveStaticTransforms?: boolean;
    } = {
      clearTransforms: false,
      preserveStaticTransforms: false,
    },
  ): void {
    this.#clearSubscriptionQueues();
    if (clearTransforms === true) {
      this.#clearTransformTree(preserveStaticTransforms);
    }
    this.settings.errors.clear();
    if (this.#labelAtlasError != undefined) {
      this.settings.errors.add(["scene"], LABEL_ATLAS_ERROR, this.#labelAtlasError);
    }
    this.hud.clear();
    this.#timestampSync.clear();

    for (const extension of this.sceneExtensions.values()) {
      if (!clearImageModeExtension && extension === this.#imageModeExtension) {
        continue;
      }
      extension.removeAllRenderables();
    }
    this.queueAnimationFrame();
  }

  #clearSubscriptionQueues(): void {
    for (const subscriptions of this.topicSubscriptions.values()) {
      for (const subscription of subscriptions) {
        subscription.queue = undefined;
      }
    }
    for (const subscriptions of this.schemaSubscriptions.values()) {
      for (const subscription of subscriptions) {
        subscription.queue = undefined;
      }
    }
  }

  #addSceneExtension(extension: SceneExtension): void {
    if (this.sceneExtensions.has(extension.extensionId)) {
      throw new Error(`Attempted to add duplicate extensionId "${extension.extensionId}"`);
    }
    this.sceneExtensions.set(extension.extensionId, extension);
    this.#scene.add(extension);
  }

  public updateConfig(updateHandler: (draft: RendererConfig) => void): void {
    this.config = produce(this.config, updateHandler);
    this.emit("configChange", this);
  }

  #addTransformSubscriptions(): void {
    // Internal handlers for TF messages to update the transform tree
    this.#addSchemaSubscriptions(FRAME_TRANSFORM_DATATYPES, {
      handler: this.#handleFrameTransform,
      shouldSubscribe: () => true,
      preload: true,
    });
    this.#addSchemaSubscriptions(FRAME_TRANSFORMS_DATATYPES, {
      handler: this.#handleFrameTransforms,
      shouldSubscribe: () => true,
      preload: true,
    });
    this.#addSchemaSubscriptions(TF_DATATYPES, {
      handler: this.#handleTFMessage,
      shouldSubscribe: () => true,
      preload: true,
    });
    this.#addSchemaSubscriptions(TRANSFORM_STAMPED_DATATYPES, {
      handler: this.#handleTransformStamped,
      shouldSubscribe: () => true,
      preload: true,
    });
  }

  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  readonly #clearTransformTree = (preserveStaticTransforms?: boolean) => {
    this.transformTree.clear();
    if (preserveStaticTransforms !== true) {
      this.#staticTransformCache.clear();
    }
    // Listeners (the frame list, the thinned-history alert) must see the empty tree
    this.#transformTreeUpdated();
  };

  // Call on scene extensions to add subscriptions to the renderer
  #addSubscriptionsFromSceneExtensions(filterFn?: (extension: SceneExtension) => boolean): void {
    const filteredExtensions = filterFn
      ? Array.from(this.sceneExtensions.values()).filter(filterFn)
      : this.sceneExtensions.values();
    for (const extension of filteredExtensions) {
      const subscriptions = extension.getSubscriptions();
      for (const subscription of subscriptions) {
        switch (subscription.type) {
          case "schema":
            this.#addSchemaSubscriptions(
              subscription.schemaNames,
              subscription.subscription as RendererSubscription,
            );
            break;
          case "topic":
            this.#addTopicSubscription(
              subscription.topicName,
              subscription.subscription as RendererSubscription,
            );
            break;
        }
      }
    }
  }

  // Clear topic and schema subscriptions and emit change events for both
  #clearSubscriptions(): void {
    this.topicSubscriptions.clear();
    this.schemaSubscriptions.clear();
    this.emit("topicSubscriptionsChanged", this);
    this.emit("schemaSubscriptionsChanged", this);
  }

  #addSchemaSubscriptions<T>(
    schemaNames: Iterable<string>,
    subscription: RendererSubscription<T>,
  ): void {
    for (const schemaName of schemaNames) {
      let handlers = this.schemaSubscriptions.get(schemaName);
      if (!handlers) {
        handlers = [];
        this.schemaSubscriptions.set(schemaName, handlers);
      }
      handlers.push(subscription as RendererSubscription);
    }
    this.emit("schemaSubscriptionsChanged", this);
  }

  #addTopicSubscription<T>(topic: string, subscription: RendererSubscription<T>): void {
    let handlers = this.topicSubscriptions.get(topic);
    if (!handlers) {
      handlers = [];
      this.topicSubscriptions.set(topic, handlers);
    }
    handlers.push(subscription as RendererSubscription);
    this.emit("topicSubscriptionsChanged", this);
  }

  /**
   * Image Only mode disables all subscriptions for non-ImageMode scene extensions and clears all transform subscriptions.
   * This mode should only be enabled in ImageMode when there is no calibration topic selected. Disabling these subscriptions
   * prevents the 3D aspects of the scene from being rendered from an insufficient camera info.
   */
  public enableImageOnlySubscriptionMode = (): void => {
    assert(
      this.#imageModeExtension,
      "Image mode extension should be defined when calling enable Image only mode",
    );
    this.clear({
      clearTransforms: true,
      clearImageModeExtension: false,
    });
    this.#clearSubscriptions();
    this.#addSubscriptionsFromSceneExtensions(
      (extension) => extension === this.#imageModeExtension,
    );
    this.settings.addNodeValidator(this.#imageOnlyModeTopicSettingsValidator);
  };

  public disableImageOnlySubscriptionMode = (): void => {
    // .clear() will clean up remaining errors on topics
    this.settings.removeNodeValidator(this.#imageOnlyModeTopicSettingsValidator);
    this.clear({
      clearTransforms: true,
      clearImageModeExtension: false,
    });
    this.#clearSubscriptions();
    this.#addSubscriptionsFromSceneExtensions();
    this.#addTransformSubscriptions();
  };

  /** Adds errors to visible topic nodes when calibration is undefined */
  #imageOnlyModeTopicSettingsValidator = (entry: SettingsTreeEntry, errors: LayerErrors) => {
    const { path, node } = entry;
    const topicName = path[1];
    if (path[0] === "topics" && topicName != undefined) {
      if (node.visible === true) {
        errors.addToTopic(
          topicName,
          "IMAGE_ONLY_TOPIC",
          "Camera calibration information is required to display 3D topics",
        );
      } else {
        errors.removeFromTopic(topicName, "IMAGE_ONLY_TOPIC");
      }
    }
  };

  public addCustomLayerAction(options: {
    layerId: string;
    label: string;
    icon?: SettingsIcon;
    handler: (instanceId: string) => void;
  }): void {
    const handler = options.handler;
    // A unique id is assigned to each action to deduplicate selection events
    // The layerId is used to map selection events back to their handlers
    const instanceId = randomUUID();
    const action: SettingsTreeNodeActionItem = {
      type: "action",
      id: `${options.layerId}-${instanceId}`,
      label: options.label,
      icon: options.icon,
    };
    this.#customLayerActions.set(options.layerId, { action, handler });
    this.#updateTopicsAndCustomLayerSettingsNodes();
  }

  #updateTopicsAndCustomLayerSettingsNodes(): void {
    this.settings.setNodesForKey(RENDERER_ID, [
      this.#getTopicsSettingsEntry(),
      this.#getCustomLayersSettingsEntry(),
    ]);
  }

  #getTopicsSettingsEntry(): SettingsTreeEntry {
    // "Topics" settings tree node
    const topics: SettingsTreeEntry = {
      path: ["topics"],
      node: {
        ...topicsRootNode(this.settings.tree()["topics"]?.children),
        handler: this.#handleTopicsAction,
      },
    };
    return topics;
  }

  #getCustomLayersSettingsEntry(): SettingsTreeEntry {
    const layerCount = Object.keys(this.config.layers).length;
    const customLayers: SettingsTreeEntry = {
      path: ["layers"],
      node: {
        ...customLayersRootNode(
          layerCount,
          Array.from(this.#customLayerActions.values()).map((entry) => entry.action),
        ),
        children: this.settings.tree()["layers"]?.children,
        handler: this.#handleCustomLayersAction,
      },
    };
    return customLayers;
  }

  /** Enable or disable object selection mode */
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  public setPickingEnabled(enabled: boolean): void {
    this.#pickingEnabled = enabled;
    if (!enabled) {
      // Picks still reading back must not report into the new mode, even if it is enabled again
      this.#clickPickRequest++;
      this.#hoverPickRequest++;
      this.setSelectedRenderable(undefined);
    }
  }

  /** The scene canvas is transparent over a map, which draws its own background */
  #clearAlpha(): number {
    return this.sharedMap ? 0 : 1;
  }

  /** Update the color scheme and background color, rebuilding any materials as necessary */
  public setColorScheme(colorScheme: "dark" | "light", backgroundColor: string | undefined): void {
    this.colorScheme = colorScheme;

    const bgColor = backgroundColor
      ? stringToRgb(tempColor, backgroundColor).convertSRGBToLinear()
      : undefined;

    for (const extension of this.sceneExtensions.values()) {
      extension.setColorScheme(colorScheme, bgColor);
    }

    if (colorScheme === "dark") {
      this.gl.setClearColor(bgColor ?? DARK_BACKDROP, this.#clearAlpha());
      this.outlineMaterial.color.set(DARK_OUTLINE);
      this.outlineMaterial.needsUpdate = true;
      this.instancedOutlineMaterial.color.set(DARK_OUTLINE);
      this.instancedOutlineMaterial.needsUpdate = true;
      this.#selectionBackdrop.setColor(DARK_BACKDROP, 0.8);
    } else {
      this.gl.setClearColor(bgColor ?? LIGHT_BACKDROP, this.#clearAlpha());
      this.outlineMaterial.color.set(LIGHT_OUTLINE);
      this.outlineMaterial.needsUpdate = true;
      this.instancedOutlineMaterial.color.set(LIGHT_OUTLINE);
      this.instancedOutlineMaterial.needsUpdate = true;
      this.#selectionBackdrop.setColor(LIGHT_BACKDROP, 0.8);
    }
  }

  public updateSceneRenderSettings(): void {
    const mainLightMode = this.config.scene.mainLightMode ?? "fixed";
    const dirIntensity = this.config.scene.directionalLightIntensity ?? Math.PI;

    if (mainLightMode === "headlight") {
      if (this.#dirLight.parent != undefined) {
        this.#dirLight.removeFromParent();
      }
      this.#dirLight.castShadow = false;

      this.#headLight.intensity = dirIntensity;
      this.#headLight.castShadow = false;
    } else {
      if (this.#headLight.parent != undefined) {
        this.#headLight.removeFromParent();
        this.#headLight.target.removeFromParent();
      }
      this.#headLight.castShadow = false;

      if (this.#dirLight.parent !== this.#scene) {
        this.#scene.add(this.#dirLight);
      }
      this.#dirLight.intensity = dirIntensity;
      this.#dirLight.castShadow = false;
    }

    this.#hemiLight.intensity = this.config.scene.hemisphereLightIntensity ?? 0.5 * Math.PI;
  }

  /** Attach the headlight to the active camera each frame (Perspective vs Orthographic can swap). */
  #syncMainLightToCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    if ((this.config.scene.mainLightMode ?? "fixed") !== "headlight") {
      return;
    }
    if (this.#headLight.parent !== camera) {
      this.#headLight.removeFromParent();
      this.#headLight.target.removeFromParent();
      camera.add(this.#headLight);
      camera.add(this.#headLight.target);
      this.#headLight.position.set(0, 0, 0);
      this.#headLight.target.position.set(0, 0, -1);
    }
  }

  /** Update the list of topics and rebuild all settings nodes when the identity
   * of the topics list changes */
  public setTopics(topics: ReadonlyArray<Topic> | undefined): void {
    if (this.topics === topics) {
      return;
    }
    this.topics = topics;

    // Rebuild topicsByName
    this.topicsByName = topics ? new Map(topics.map((topic) => [topic.name, topic])) : undefined;

    this.emit("topicsChanged", this);

    // Rebuild the settings nodes for all scene extensions
    this.updateAllSettingsNodes();
  }

  public setParameters(parameters: Immutable<Map<string, ParameterValue>> | undefined): void {
    const changed = this.parameters !== parameters;
    this.parameters = parameters as ReadonlyMap<string, ParameterValue> | undefined;
    if (changed) {
      this.emit("parametersChange", this.parameters, this);
    }
  }

  public setVariables(variables: ReadonlyMap<string, VariableValue>): void {
    if (this.variables !== variables) {
      this.variables = variables;
      this.emit("variablesChange", variables, this);
    }
  }

  public updateCustomLayersCount(): void {
    const layerCount = Object.keys(this.config.layers).length;
    const label = `Custom Layers${layerCount > 0 ? ` (${layerCount})` : ""}`;
    this.settings.setLabel(["layers"], label);
  }

  public setCameraState(cameraState: CameraState): void {
    this.cameraHandler.setCameraState(cameraState);
  }

  public getCameraState(): CameraState | undefined {
    return this.cameraHandler.getCameraState();
  }

  public getCameraDistance(): number | undefined {
    return this.cameraHandler.getCameraDistance();
  }

  /** Fit visible topic geometry, excluding map tiles, grids, and transform helpers. */
  public zoomToData(): void {
    const state = this.getCameraState();
    if (!state) {
      return;
    }
    const bounds = new THREE.Box3();
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const extension of this.sceneExtensions.values()) {
      if (!extension.visible) {
        continue;
      }
      extension.updateWorldMatrix(true, true);
      for (const renderable of extension.renderables.values()) {
        if (renderable.userData.settingsPath[0] !== "topics") {
          continue;
        }
        renderable.traverseVisible((object) => {
          if (object.userData.picking === false) {
            return;
          }
          // Objects drawn from their own buffers (point sets, per-scan poses) report their bounds
          const computeBounds = object.userData.computeBounds as
            | ((box: THREE.Box3) => void)
            | undefined;
          if (
            computeBounds ||
            object instanceof THREE.Mesh ||
            object instanceof THREE.Points ||
            object instanceof THREE.Line
          ) {
            if (computeBounds) {
              box.makeEmpty();
              computeBounds(box);
            } else if (object instanceof THREE.InstancedMesh) {
              object.computeBoundingBox();
              box.copy(object.boundingBox!);
            } else {
              const geometry = (object as THREE.Mesh).geometry;
              // Bound only the active range of reused buffers, skipping NaN points (e.g. in clouds)
              const expand = (name: string, from: number, to: number) => {
                const attribute = geometry.attributes[name];
                if (!attribute) {
                  return;
                }
                for (let i = from; i < Math.min(to, attribute.count); i++) {
                  point.fromBufferAttribute(attribute, i);
                  if (Number.isFinite(point.x + point.y + point.z)) {
                    box.expandByPoint(point);
                  }
                }
              };
              box.makeEmpty();
              if (geometry instanceof LineSegmentsGeometry) {
                expand("instanceStart", 0, geometry.instanceCount);
                expand("instanceEnd", 0, geometry.instanceCount);
              } else if (geometry instanceof DynamicBufferGeometry) {
                const { start, count } = geometry.drawRange;
                expand("position", start, start + count);
              } else if (geometry instanceof THREE.InstancedBufferGeometry) {
                // Point cloud cubes: the shader offsets a unit cube by each instance position
                expand("instancePosition", 0, geometry.instanceCount);
              } else {
                // Dynamic renderables do not consistently invalidate cached bounds.
                geometry.computeBoundingBox();
                box.copy(geometry.boundingBox!);
              }
            }
            box.applyMatrix4(object.matrixWorld);
            if ([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) {
              bounds.union(box);
            }
          }
        });
      }
    }
    if (bounds.isEmpty()) {
      return;
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const camera = this.cameraHandler.getActiveCamera();
    camera.parent?.worldToLocal(sphere.center);
    const { width, height } = this.input.canvasSize;
    const aspect = width > 0 && height > 0 ? width / height : 1;
    const halfFov = THREE.MathUtils.degToRad(state.fovy / 2);
    const angle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
    const radius = Math.max(sphere.radius, 0.5) * 1.1;
    const distance = state.perspective
      ? radius / Math.sin(angle)
      : (2 * radius) / Math.min(1, aspect);
    if (!Number.isFinite(distance) || distance <= 0) {
      return;
    }
    const cameraState: CameraState = {
      ...state,
      targetOffset: sphere.center.toArray(),
      distance,
      // Keep the far side of the fitted data inside the clipping range
      // (an orthographic camera sits at z = far / 2 and sees z in [-far / 2, far / 2 - near])
      far: Math.max(
        state.far,
        state.perspective
          ? (distance + radius) * 1.1
          : 2 * (state.near + Math.abs(sphere.center.z) + radius),
      ),
    };
    this.updateConfig((draft) => {
      draft.cameraState = cameraState;
    });
    this.setCameraState(cameraState);
    this.emit("cameraMove", this);
    this.queueAnimationFrame();
  }

  public canResetView(): boolean {
    return this.#imageModeExtension?.hasModifiedView() ?? false;
  }

  public resetView(): void {
    this.#imageModeExtension?.resetViewModifications();
    this.queueAnimationFrame();
  }

  public setSelectedRenderable(selection: PickedRenderable | undefined): void {
    if (this.#selectedRenderable === selection) {
      return;
    }

    const prevSelected = this.#selectedRenderable;
    if (prevSelected) {
      // Deselect the previously selected renderable
      deselectObject(prevSelected.renderable);
      log.debug(`Deselected ${prevSelected.renderable.id} (${prevSelected.renderable.name})`);
    }

    this.#selectedRenderable = selection;

    if (selection) {
      // Select the newly selected renderable
      selectObject(selection.renderable);
      log.debug(
        `Selected ${selection.renderable.id} (${selection.renderable.name}) (instance=${selection.instanceIndex})`,
        selection.renderable,
      );
    }

    this.emit("selectedRenderable", selection, this);

    if (!this.debugPicking) {
      this.animationFrame();
    }
  }

  private queueByKey(
    groups: Map<string, MessageEvent[]>,
    subscriptions: Map<string, RendererSubscription[]>,
  ): void {
    for (const [key, messageEvents] of groups) {
      const subs = subscriptions.get(key);
      if (!subs) {
        continue;
      }

      for (const sub of subs) {
        sub.queue ??= [];
        sub.queue.push(...messageEvents);
      }
    }
  }

  /**
   * Batch version of addMessageEvent that processes multiple messages more efficiently
   * by grouping them by topic/schema before queueing
   */
  public addMessageEventBatch(messageEvents: readonly MessageEvent[]): void {
    // Extract coordinate frames from all messages
    for (const messageEvent of messageEvents) {
      this.addMessageEvent(messageEvent, { inBatch: true });
    }

    // Group messages by topic and schema for efficient batching
    const messagesByTopic = new Map<string, MessageEvent[]>();
    const messagesBySchema = new Map<string, MessageEvent[]>();
    for (const msg of this.#synchronize(messageEvents)) {
      // Group by topic
      let topicMessages = messagesByTopic.get(msg.topic);
      if (topicMessages == undefined) {
        topicMessages = [];
        messagesByTopic.set(msg.topic, topicMessages);
      }
      topicMessages.push(msg);

      // Group by schema
      let schemaMessages = messagesBySchema.get(msg.schemaName);
      if (schemaMessages == undefined) {
        schemaMessages = [];
        messagesBySchema.set(msg.schemaName, schemaMessages);
      }
      schemaMessages.push(msg);
    }

    // Queue messages in batches
    this.queueByKey(messagesByTopic, this.topicSubscriptions);
    this.queueByKey(messagesBySchema, this.schemaSubscriptions);
  }

  public addMessageEvent(
    messageEvent: Readonly<MessageEvent>,
    options?: Partial<AddMessageEventOptions>,
  ): void {
    const { message } = messageEvent;

    const maybeHasHeader = message as DeepPartial<{ header: Header }>;
    const maybeHasMarkers = message as DeepPartial<MarkerArray>;
    const maybeHasEntities = message as DeepPartial<SceneUpdate>;
    const maybeHasFrameId = message as DeepPartial<Header>;

    // Extract coordinate frame IDs from all incoming messages
    if (maybeHasHeader.header) {
      // If this message has a Header, scrape the frame_id from it
      const frameId = maybeHasHeader.header.frame_id ?? "";
      this.addCoordinateFrame(frameId);
    } else if (Array.isArray(maybeHasMarkers.markers)) {
      // If this message has an array called markers, scrape frame_id from all markers
      for (const marker of maybeHasMarkers.markers) {
        if (marker) {
          const frameId = marker.header?.frame_id ?? "";
          this.addCoordinateFrame(frameId);
        }
      }
    } else if (Array.isArray(maybeHasEntities.entities)) {
      // If this message has an array called entities, scrape frame_id from all entities
      for (const entity of maybeHasEntities.entities) {
        if (entity) {
          const frameId = entity.frame_id ?? "";
          this.addCoordinateFrame(frameId);
        }
      }
    } else if (typeof maybeHasFrameId.frame_id === "string") {
      // If this message has a top-level frame_id, scrape it
      this.addCoordinateFrame(maybeHasFrameId.frame_id);
    }

    if (options?.inBatch === true) {
      return;
    }

    for (const event of this.#synchronize([messageEvent])) {
      queueMessage(event, this.topicSubscriptions.get(event.topic));
      queueMessage(event, this.schemaSubscriptions.get(event.schemaName));
    }
  }

  /** Passes messages through `#timestampSync`, keeping its topics and HUD notice current. */
  #synchronize(messageEvents: readonly MessageEvent[]): readonly MessageEvent[] {
    if (
      this.#timestampSyncInputs[0] !== this.config ||
      this.#timestampSyncInputs[1] !== this.topicsByName
    ) {
      this.#timestampSyncInputs = [this.config, this.topicsByName];
      this.#timestampSync.setTopics(this.#syncedTopics());
    }
    const result = this.#timestampSync.filter(messageEvents);
    this.hud.displayIfTrue(this.#timestampSync.isWaiting(), WAITING_FOR_TIMESTAMP_SYNC_HUD_ITEM);
    return result;
  }

  /**
   * Visible topics of the data source marked "Sync" while timestamp sync is on. Hidden or missing
   * topics would never match, and transforms are never held back.
   */
  #syncedTopics(): Set<string> {
    const topics = new Set<string>();
    if (this.config.scene.syncTimestamps !== true) {
      return topics;
    }
    for (const [topic, settings] of Object.entries(this.config.topics)) {
      const schemaName = this.topicsByName?.get(topic)?.schemaName;
      if (
        settings?.sync === true &&
        settings.visible === true &&
        schemaName != undefined &&
        !TRANSFORM_SCHEMAS.some((schemas) => schemas.has(schemaName))
      ) {
        topics.add(topic);
      }
    }
    return topics;
  }

  /** Adds the "Sync" switch to topic layers while timestamp sync is on (not robot models). */
  #addSyncField = (key: string, entry: SettingsTreeEntry): SettingsTreeEntry => {
    const [root, topic] = entry.path;
    if (
      this.config.scene.syncTimestamps !== true ||
      root !== "topics" ||
      topic == undefined ||
      entry.path.length !== 2 ||
      key === Urdfs.extensionId
    ) {
      return entry;
    }
    const settings = this.config.topics[topic];
    return {
      ...entry,
      node: {
        ...entry.node,
        fields: {
          ...entry.node.fields,
          sync: {
            label: i18next.t("threeDee:syncTopic"),
            help: i18next.t("threeDee:syncTopicHelp"),
            input: "boolean",
            value: settings?.sync ?? false,
          },
        },
      },
    };
  };

  /** Rebuilds every extension's settings nodes, e.g. after a panel-wide setting changes them. */
  public updateAllSettingsNodes(): void {
    for (const extension of this.sceneExtensions.values()) {
      this.settings.setNodesForKey(extension.extensionId, extension.settingsNodes());
    }
  }

  /** Match the behavior of `tf::Transformer` by stripping leading slashes from
   * frame_ids. This preserves compatibility with earlier versions of ROS while
   * not breaking any current versions where:
   * > tf2 does not accept frame_ids starting with "/"
   * Source: <http://wiki.ros.org/tf2/Migration#tf_prefix_backwards_compatibility>
   */
  public normalizeFrameId(frameId: string): string {
    if (!this.ros || !frameId.startsWith("/")) {
      return frameId;
    }
    return frameId.slice(1);
  }

  public addCoordinateFrame(frameId: string): void {
    const normalizedFrameId = this.normalizeFrameId(frameId);
    if (!this.transformTree.hasFrame(normalizedFrameId)) {
      this.transformTree.getOrCreateFrame(normalizedFrameId);
      this.#transformTreeUpdated();
    }
  }

  #transformTreeUpdated(): void {
    if (this.#transformTreeBatchDepth > 0) {
      this.#transformTreeDirty = true;
      return;
    }
    this.coordinateFrameList = this.transformTree.frameList();
    this.emit("transformTreeUpdated", this);
  }

  /**
   * Runs `fn` and announces transform tree changes once afterwards. Every listener rebuilds
   * settings trees and frameList() sorts all frames, so per-transform updates are O(n²) for
   * bursts like re-adding all static transforms after a seek.
   */
  #batchTransformTreeUpdates(fn: () => void): void {
    this.#transformTreeBatchDepth++;
    try {
      fn();
    } finally {
      this.#transformTreeBatchDepth--;
      if (this.#transformTreeBatchDepth === 0 && this.#transformTreeDirty) {
        this.#transformTreeDirty = false;
        this.#transformTreeUpdated();
      }
    }
  }

  #addFrameTransform(
    transform: FrameTransform,
    options?: { isStatic?: boolean; receiveTime?: bigint; topic?: string },
  ): void {
    const parentId = transform.parent_frame_id;
    const childId = transform.child_frame_id;
    try {
      const stamp = toNanoSec(transform.timestamp);
      const t = transform.translation;
      const q = transform.rotation;

      const result = this.addTransform(
        parentId,
        childId,
        stamp,
        t,
        q,
        undefined,
        options?.receiveTime,
      );

      if (options?.isStatic === true && result !== AddTransformResult.CYCLE_DETECTED) {
        this.#staticTransformCache.set(childId, {
          topic: options.topic ?? "",
          parentFrameId: parentId,
          childFrameId: childId,
          stamp,
          translation: t,
          rotation: q,
        });
      }
    } catch (e: unknown) {
      const err = toError(e);
      this.settings.errors.add(
        ["transforms"],
        ADD_TRANSFORM_ERROR,
        `Error adding transform for frame ${childId}: ${err.message}`,
      );
    }
  }

  #addTransformMessage(
    tf: TransformStamped,
    options?: { isStatic?: boolean; receiveTime?: bigint; topic?: string },
  ): void {
    const normalizedParentId = this.normalizeFrameId(tf.header.frame_id);
    const normalizedChildId = this.normalizeFrameId(tf.child_frame_id);
    try {
      const stamp = toNanoSec(tf.header.stamp);
      const t = tf.transform.translation;
      const q = tf.transform.rotation;

      const result = this.addTransform(
        normalizedParentId,
        normalizedChildId,
        stamp,
        t,
        q,
        undefined,
        options?.receiveTime,
      );

      if (options?.isStatic === true && result !== AddTransformResult.CYCLE_DETECTED) {
        this.#staticTransformCache.set(normalizedChildId, {
          topic: options.topic ?? "",
          parentFrameId: normalizedParentId,
          childFrameId: normalizedChildId,
          stamp,
          translation: t,
          rotation: q,
        });
      }
    } catch (e: unknown) {
      const err = toError(e);
      this.settings.errors.add(
        ["transforms"],
        ADD_TRANSFORM_ERROR,
        `Error adding transform for frame ${normalizedChildId}: ${err.message}`,
      );
    }
  }

  // Create a new transform and add it to the renderer's TransformTree
  public addTransform(
    parentFrameId: string,
    childFrameId: string,
    stamp: bigint,
    translation: Vector3,
    rotation: Quaternion,
    errorSettingsPath?: string[],
    /** Playback time the transform was received at, if it came from a message */
    receiveTime?: bigint,
  ): AddTransformResult {
    const t = translation;
    const q = rotation;

    tempVec3[0] = t.x;
    tempVec3[1] = t.y;
    tempVec3[2] = t.z;

    tempQuat[0] = q.x;
    tempQuat[1] = q.y;
    tempQuat[2] = q.z;
    tempQuat[3] = q.w;

    tempTransform.setPositionRotation(tempVec3, tempQuat);
    const decimations = this.transformTree.decimations;
    const status = this.transformTree.addTransform(
      childFrameId,
      parentFrameId,
      stamp,
      tempTransform,
      receiveTime,
    );

    // Thinning to fit the sample budget is announced too, so the panel can say so
    if (status === AddTransformResult.UPDATED || this.transformTree.decimations !== decimations) {
      this.#transformTreeUpdated();
    }
    if (status !== AddTransformResult.CYCLE_DETECTED) {
      this.#touchedFrameIds?.add(childFrameId);
    }

    if (status === AddTransformResult.CYCLE_DETECTED) {
      this.settings.errors.add(
        ["transforms", `frame:${childFrameId}`],
        CYCLE_DETECTED,
        `Transform tree cycle detected: Received transform with parent "${parentFrameId}" and child "${childFrameId}", but "${childFrameId}" is already an ancestor of "${parentFrameId}". Transform message dropped.`,
      );
      if (errorSettingsPath) {
        this.settings.errors.add(
          errorSettingsPath,
          CYCLE_DETECTED,
          `Attempted to add cyclical transform: Frame "${parentFrameId}" cannot be the parent of frame "${childFrameId}". Transform message dropped.`,
        );
      }
    }

    return status;
  }

  public removeTransform(childFrameId: string, parentFrameId: string, stamp: bigint): void {
    const prevVersion = this.transformTree.version;
    this.transformTree.removeTransform(childFrameId, parentFrameId, stamp);
    if (this.transformTree.version !== prevVersion) {
      this.#transformTreeUpdated();
    }
  }

  // Callback handlers

  public animationFrame = (): void => {
    if (this.#disposed) {
      return;
    }
    // Cancel any requestAnimationFrame (rAF) that `queueAnimationFrame()` scheduled. When this runs synchronously (e.g. a
    // seek's `handleSeek`/`clear` queued a frame and the render-if-requested effect then calls us
    // directly in the same tick) the queued rAF would otherwise fire on the next tick and paint a
    // redundant second frame.
    if (this.#animationFrame != undefined) {
      this.#ownerWindow.cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = undefined;
    }
    if (!this.#rendering) {
      this.#frameHandler(this.currentTime);
      this.#rendering = false;
    }
  };

  public queueAnimationFrame(): void {
    if (this.#disposed) {
      return;
    }
    this.#animationFrame ??= this.#ownerWindow.requestAnimationFrame(this.animationFrame);
  }

  public async settleVideoDecodes(): Promise<void> {
    await Promise.all(
      Array.from(this.sceneExtensions.values(), async (ext) => {
        await ext.settleVideoDecodes();
      }),
    );
  }

  public setFollowFrameId(frameId: string | undefined): void {
    if (this.followFrameId !== frameId) {
      log.debug(`Setting followFrameId to ${frameId}`);
    }
    this.followFrameId = frameId;
  }

  public async fetchAsset(
    uri: string,
    options?: Parameters<BuiltinPanelExtensionContext["unstable_fetchAsset"]>[1],
  ): Promise<Asset> {
    return await this.#fetchAsset(uri, options);
  }

  #frameHandler = (currentTime: bigint): void => {
    this.#rendering = true;
    this.setCurrentTime(currentTime);
    this.#batchTransformTreeUpdates(() => {
      this.#handleSubscriptionQueues();
    });
    this.#updateFrameErrors();
    this.#updateFixedFrameId();

    // A hidden tab shows nothing, but live data keeps driving frames: keep the scene state current
    // and skip the GPU work. #onVisibilityChange repaints when the tab is shown again.
    const draw = this.#gpuReady && this.#canvas.ownerDocument.visibilityState !== "hidden";
    if (draw) {
      this.gl.clear();
    }
    this.emit("startFrame", currentTime, this);

    const camera = this.cameraHandler.getActiveCamera();
    this.#syncMainLightToCamera(camera);
    camera.layers.set(LAYER_DEFAULT);

    // use the FALLBACK_FRAME_ID if renderFrame is undefined and there are no options for transforms
    const renderFrameId =
      this.followFrameId && this.transformTree.frame(this.followFrameId)
        ? this.followFrameId
        : CoordinateFrame.FALLBACK_FRAME_ID;
    const fixedFrameId = this.fixedFrameId ?? CoordinateFrame.FALLBACK_FRAME_ID;

    for (const sceneExtension of this.sceneExtensions.values()) {
      sceneExtension.startFrame(currentTime, renderFrameId, fixedFrameId);
    }

    if (draw) {
      if (this.sharedMap) {
        this.sharedMap.render(renderFrameId, fixedFrameId);
      } else {
        this.#drawScene();
      }
    }

    this.emit("endFrame", currentTime, this);
    if (draw && this.config.scene.enableStats === true) {
      this.#framesSinceGpuMeasure++;
      if (!this.#measuringGpu) {
        void this.#measureGpuTime();
      }
    }

    this.gl.info.reset();
  };

  #drawScene = (): void => {
    // A map may draw its layer before the GPU is ready; that frame shows only the map
    if (!this.#gpuReady) {
      return;
    }
    this.#advanceNodeFrame();
    const camera = this.cameraHandler.getActiveCamera();
    camera.layers.set(LAYER_DEFAULT);
    // The raster reads world matrices before render() would refresh them; stale ones draw points a
    // frame behind the meshes when their frame or the camera moves
    this.#scene.updateMatrixWorld();
    if (camera.parent == undefined) {
      camera.updateMatrixWorld();
    }
    this.pointRaster.skipped.clear();
    this.pointRaster.prepare(camera);
    this.gl.render(this.#scene, camera);

    if (this.#selectedRenderable) {
      this.gl.render(this.#selectionBackdropScene, camera);
      this.gl.clearDepth();
      camera.layers.set(LAYER_SELECTED);
      this.pointRaster.prepare(camera);
      this.gl.render(this.#scene, camera);
    }
    this.#reportSkippedPoints();
  };

  /** Settings errors on the layers whose points the raster couldn't draw this frame */
  #reportSkippedPoints(): void {
    const skipped = this.pointRaster.skipped;
    if (skipped.size === 0 && this.#skippedPointPaths.size === 0) {
      return;
    }
    const current = new Map<string, Path>();
    for (const [points, reason] of skipped) {
      const path = settingsPathOf(points);
      if (!path) {
        continue;
      }
      const key = path.join("\n");
      current.set(key, path);
      // A no-op while unchanged; re-adds it after something cleared the layer's errors
      this.settings.errors.add(
        path,
        POINTS_NOT_DRAWN,
        reason === "tooLarge"
          ? "Too many points to draw at once on this GPU; reduce the decay time or point count"
          : `Only ${MAX_POINT_SETS} point layers can be drawn at once; hide some to show this one`,
      );
    }
    for (const [key, path] of this.#skippedPointPaths) {
      if (!current.has(key)) {
        this.settings.errors.remove(path, POINTS_NOT_DRAWN);
      }
    }
    this.#skippedPointPaths = current;
  }

  /** iterates through all subscription message queues, processes them, and calls their handler for each message in the frame */
  #handleSubscriptionQueues(): void {
    for (const subscriptions of this.topicSubscriptions.values()) {
      for (const subscription of subscriptions) {
        if (!subscription.queue) {
          continue;
        }
        const { queue, filterQueue } = subscription;
        const processedQueue = filterQueue ? filterQueue(queue) : queue;
        subscription.queue = undefined;
        for (const messageEvent of processedQueue) {
          subscription.handler(messageEvent);
        }
      }
    }
    for (const subscriptions of this.schemaSubscriptions.values()) {
      for (const subscription of subscriptions) {
        if (!subscription.queue) {
          continue;
        }
        const { queue, filterQueue } = subscription;
        const processedQueue = filterQueue ? filterQueue(queue) : queue;
        subscription.queue = undefined;
        for (const messageEvent of processedQueue) {
          subscription.handler(messageEvent);
        }
      }
    }
  }

  #updateFixedFrameId(): void {
    const frame =
      this.followFrameId != undefined ? this.transformTree.frame(this.followFrameId) : undefined;

    if (frame == undefined) {
      this.fixedFrameId = undefined;
      return;
    }
    const fixedFrame = frame.root();
    const fixedFrameId = fixedFrame.id;
    if (this.fixedFrameId !== fixedFrameId) {
      if (this.fixedFrameId == undefined) {
        log.debug(`Setting fixed frame to ${fixedFrameId}`);
      } else {
        log.debug(`Changing fixed frame from "${this.fixedFrameId}" to "${fixedFrameId}"`);
      }
      this.fixedFrameId = fixedFrameId;
    }
  }

  #resizeHandler = (size: THREE.Vector2): void => {
    this.gl.setPixelRatio(this.#ownerWindow.devicePixelRatio);
    this.gl.setSize(size.width, size.height);
    this.sharedMap?.map.setPixelRatio(this.#ownerWindow.devicePixelRatio);
    this.sharedMap?.map.resize();
    this.cameraHandler.handleResize(size.width, size.height, this.#ownerWindow.devicePixelRatio);

    const renderSize = this.gl.getDrawingBufferSize(tempVec2);
    log.debug(`Resized renderer to ${renderSize.width}x${renderSize.height}`);
    this.animationFrame();
  };

  /** Object picking is off while a tool (measure, publish, frame pick) takes the clicks */
  #toolActive(): boolean {
    return (
      this.measurementTool.state !== "idle" ||
      this.publishClickTool.state !== "idle" ||
      this.framePicking
    );
  }

  /**
   * Whether a pick that read back can still report: it is the latest of its kind, picking is still
   * on with no tool taking over, and the device wasn't lost meanwhile (no result, not an empty one)
   */
  #pickStillWanted(request: number, latestRequest: number): boolean {
    return (
      request === latestRequest && this.#pickingEnabled && !this.#toolActive() && this.#gpuReady
    );
  }

  #clickHandler = (cursorCoords: THREE.Vector2): void => {
    if (!this.#pickingEnabled) {
      this.setSelectedRenderable(undefined);
      return;
    }
    if (this.#toolActive()) {
      return;
    }

    this.setSelectedRenderable(undefined);
    // Input reuses its vector, and the cursor moves on while readbacks are pending
    const cursor = cursorCoords.clone();
    const request = ++this.#clickPickRequest;
    void this.#pickStack(cursor).then((selections) => {
      if (!this.#pickStillWanted(request, this.#clickPickRequest)) {
        return;
      }
      log.debug(`Clicked ${selections.length} renderable(s)`);
      this.emit("renderablesClicked", selections, cursor, this);
    });
  };

  readonly #hoverHandler = (cursorCoords: THREE.Vector2): void => {
    if (!this.#pickingEnabled || this.#toolActive()) {
      return;
    }

    const cursor = cursorCoords.clone();
    const request = ++this.#hoverPickRequest;
    void this.#pickStack(cursor).then((selections) => {
      if (!this.#pickStillWanted(request, this.#hoverPickRequest)) {
        return;
      }
      this.emit("renderableHovered", selections, cursor, this);
    });
  };

  /**
   * Every renderable under the cursor, nearest first: picks, skips the picked renderable, and picks
   * again until nothing is hit or MAX_SELECTIONS is reached. Only the 1-pixel picking target is
   * drawn; the canvas is untouched.
   */
  async #pickStack(cursorCoords: THREE.Vector2): Promise<PickedRenderable[]> {
    const selections: PickedRenderable[] = [];
    const hidden = new Set<THREE.Object3D>();
    while (selections.length < MAX_SELECTIONS) {
      const selection = await this.#pickSingleObject(cursorCoords, hidden);
      // Guards against a loop should something hidden still report
      if (!selection || hidden.has(selection.renderable)) {
        break;
      }
      selections.push(selection);
      hidden.add(selection.renderable);
    }
    return selections;
  }

  readonly #handleFrameTransform = ({
    message,
    topic,
    receiveTime,
  }: MessageEvent<DeepPartial<FrameTransform>>): void => {
    // foxglove.FrameTransform - Ingest this single transform into our TF tree
    const transform = normalizeFrameTransform(message);
    const isStatic = isStaticTransformTopic(topic);
    this.#addFrameTransform(transform, { isStatic, receiveTime: toNanoSec(receiveTime), topic });
  };

  readonly #handleFrameTransforms = ({
    message,
    topic,
    receiveTime,
  }: MessageEvent<DeepPartial<FrameTransforms>>): void => {
    // foxglove.FrameTransforms - Ingest the list of transforms into our TF tree
    const frameTransforms = normalizeFrameTransforms(message);
    const options = {
      isStatic: isStaticTransformTopic(topic),
      receiveTime: toNanoSec(receiveTime),
      topic,
    };
    for (const transform of frameTransforms.transforms) {
      this.#addFrameTransform(transform, options);
    }
  };

  readonly #handleTFMessage = ({
    message,
    topic,
    receiveTime,
  }: MessageEvent<DeepPartial<TFMessage>>): void => {
    // tf2_msgs/TFMessage - Ingest the list of transforms into our TF tree
    const tfMessage = normalizeTFMessage(message);
    const options = {
      isStatic: isStaticTransformTopic(topic),
      receiveTime: toNanoSec(receiveTime),
      topic,
    };
    for (const tf of tfMessage.transforms) {
      this.#addTransformMessage(tf, options);
    }
  };

  readonly #handleTransformStamped = ({
    message,
    topic,
    receiveTime,
  }: MessageEvent<DeepPartial<TransformStamped>>): void => {
    // geometry_msgs/TransformStamped - Ingest this single transform into our TF tree
    const tf = normalizeTransformStamped(message);
    const isStatic = isStaticTransformTopic(topic);
    this.#addTransformMessage(tf, { isStatic, receiveTime: toNanoSec(receiveTime), topic });
  };

  #handleTopicsAction = (action: SettingsTreeAction): void => {
    const visible = showHideAllValue(action);
    if (visible != undefined && action.payload.path.length === 1) {
      this.#setTopicsVisible(visible);
    }
    const [, topic, field] = action.payload.path;
    if (action.action === "update" && topic != undefined && field === "sync") {
      const sync = action.payload.value === true;
      this.updateConfig((draft) => {
        draft.topics[topic] = { ...draft.topics[topic], sync };
      });
      this.updateAllSettingsNodes();
    }
  };

  /**
   * Shows or hides topics (all of them, or only `onlyTopics`) like their visibility checkbox does,
   * so the config, the settings tree and the renderables all follow.
   */
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  #setTopicsVisible(value: boolean, onlyTopics?: ReadonlySet<string>): void {
    for (const extension of this.sceneExtensions.values()) {
      for (const node of extension.settingsNodes()) {
        const [root, topic] = node.path;
        if (root === "topics" && (onlyTopics == undefined || onlyTopics.has(topic ?? ""))) {
          extension.handleSettingsAction({
            action: "update",
            payload: { path: [...node.path, "visible"], input: "boolean", value },
          });
        }
      }
    }
  }

  #handleCustomLayersAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "perform-node-action" || path.length !== 1 || path[0] !== "layers") {
      return;
    }
    log.debug(`handleCustomLayersAction(${action.payload.id})`);

    // Remove `-{uuid}` from the actionId to get the layerId
    const actionId = action.payload.id;
    const layerId = actionId.slice(0, -37);
    const instanceId = actionId.slice(-36);

    const entry = this.#customLayerActions.get(layerId);
    if (!entry) {
      throw new Error(`No custom layer action found for "${layerId}"`);
    }

    // Regenerate the action menu entry with a new instanceId. The unique instanceId is generated
    // here so we can deduplicate multiple callbacks for the same menu click event
    const { label, icon } = entry.action;
    this.addCustomLayerAction({ layerId, label, icon, handler: entry.handler });

    // Trigger the add custom layer action handler
    entry.handler(instanceId);

    // Update the Custom Layers node label with the number of custom layers
    this.updateCustomLayersCount();
  };

  /**
   * The 3D point (in render frame coordinates) of the nearest pickable surface under a canvas pixel,
   * or undefined when nothing pickable is there. `camera` defaults to the active view camera.
   */
  public async pickPoint(
    cursorCoords: THREE.Vector2,
    out: THREE.Vector3,
    camera:
      | THREE.OrthographicCamera
      | THREE.PerspectiveCamera = this.cameraHandler.getActiveCamera(),
  ): Promise<THREE.Vector3 | undefined> {
    // The pick is drawn now (only its readback is awaited) and the camera or canvas can change
    // before it arrives: take the ray and camera pose the pick was drawn with
    const pending = this.#pick(cursorCoords, undefined, camera);
    const { width, height } = this.input.canvasSize;
    // A point on the cursor's ray in view space, scaled to the picked view depth below
    const ray = new THREE.Vector3(
      (cursorCoords.x / width) * 2 - 1,
      -(cursorCoords.y / height) * 2 + 1,
      0.5,
    ).applyMatrix4(camera.projectionMatrixInverse);
    const cameraWorld = camera.matrixWorld.clone();
    const hit = await pending;
    if (!hit) {
      return undefined;
    }
    if ((camera as Partial<THREE.OrthographicCamera>).isOrthographicCamera === true) {
      ray.z = -hit.viewDepth;
    } else {
      ray.multiplyScalar(hit.viewDepth / -ray.z);
    }
    return out.copy(ray).applyMatrix4(cameraWorld);
  }

  /** The topmost object under the cursor, or undefined for the background */
  public async pickObject(cursorCoords: THREE.Vector2): Promise<THREE.Object3D | undefined> {
    const hit = await this.#pick(cursorCoords);
    return hit ? this.#scene.getObjectById(hit.objectId) : undefined;
  }

  async #pick(
    cursorCoords: THREE.Vector2,
    hidden?: ReadonlySet<THREE.Object3D>,
    camera:
      | THREE.OrthographicCamera
      | THREE.PerspectiveCamera = this.cameraHandler.getActiveCamera(),
  ): Promise<PickResult | undefined> {
    if (!this.#gpuReady || this.#disposed) {
      return undefined;
    }
    camera.layers.set(LAYER_DEFAULT);
    // Batched markers draw as instances but pick as themselves
    camera.layers.enable(LAYER_PICK_ONLY);
    try {
      // The pick is drawn synchronously; only its readback is awaited
      return await this.#picker.pick(cursorCoords.x, cursorCoords.y, camera, hidden);
    } catch (error) {
      // A readback cancelled by device loss or disposal is no result; anything else is a bug
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- changes while awaiting
      if (this.#gpuReady && !this.#disposed) {
        log.error(error);
      }
      return undefined;
    }
  }

  async #pickSingleObject(
    cursorCoords: THREE.Vector2,
    hidden: ReadonlySet<THREE.Object3D>,
  ): Promise<PickedRenderable | undefined> {
    const hit = await this.#pick(cursorCoords, hidden);
    if (!hit) {
      return undefined;
    }
    const pickedObject = this.#scene.getObjectById(hit.objectId);

    // The highest ancestor of the picked object that is a Renderable
    let renderable: Renderable | undefined;
    let maybeRenderable = pickedObject as Partial<Renderable> | undefined;
    while (maybeRenderable) {
      if (maybeRenderable.pickable === true) {
        renderable = maybeRenderable as Renderable;
      }
      maybeRenderable = (maybeRenderable.parent ?? undefined) as Partial<Renderable> | undefined;
    }
    if (!renderable) {
      log.warn(`No Renderable found for objectId ${hit.objectId} (name="${pickedObject?.name}")`);
      return undefined;
    }
    const instanceIndex = renderable.pickableInstances ? hit.instanceIndex : undefined;
    return { renderable, instanceIndex };
  }

  #updateFrameErrors(): void {
    if (this.followFrameId == undefined) {
      // No frames available
      this.settings.errors.add(
        FOLLOW_TF_PATH,
        NO_FRAME_SELECTED,
        i18next.t("threeDee:noCoordinateFramesFound"),
      );
      return;
    }

    this.settings.errors.remove(FOLLOW_TF_PATH, NO_FRAME_SELECTED);

    const frame = this.transformTree.frame(this.followFrameId);

    // The follow frame id should be chosen from a frameId that exists, but
    // we still need to watch out for the case that the transform tree was
    // cleared before that could be updated
    if (!frame) {
      this.settings.errors.add(
        FOLLOW_TF_PATH,
        FOLLOW_FRAME_NOT_FOUND,
        i18next.t("threeDee:frameNotFound", {
          frameId: this.followFrameId,
        }),
      );
      return;
    }

    this.settings.errors.remove(FOLLOW_TF_PATH, FOLLOW_FRAME_NOT_FOUND);
  }
  public getContextMenuItems = (): PanelContextMenuItem[] => {
    return Array.from(this.sceneExtensions.values()).flatMap((extension) =>
      extension.getContextMenuItems(),
    );
  };

  public getDropStatus = (paths: readonly DraggedMessagePath[]): MessagePathDropStatus => {
    const effects: ("add" | "replace")[] = [];
    for (const path of paths) {
      let effect: "add" | "replace" | undefined;
      for (const extension of this.sceneExtensions.values()) {
        const maybeEffect = extension.getDropEffectForPath(path);
        if (maybeEffect) {
          effect = maybeEffect;
          break;
        }
      }
      effect ??= this.#isShowableTopic(path) ? "add" : undefined;
      // if a single path does not have a drop effect, all paths are not droppable
      if (effect == undefined) {
        return { canDrop: false };
      }
      effects.push(effect);
    }
    // prioritize replace effect over add
    const finalEffect = effects.includes("replace") ? "replace" : "add";

    return {
      canDrop: true,
      effect: finalEffect,
    };
  };

  public handleDrop = (paths: readonly DraggedMessagePath[]): void => {
    this.updateConfig((draft) => {
      for (const path of paths) {
        for (const extension of this.sceneExtensions.values()) {
          extension.updateConfigForDropPath(draft, path);
        }
      }
    });
    const topics = paths
      .filter((path) => this.#isShowableTopic(path))
      .map((path) => path.topicName);
    if (topics.length > 0) {
      this.#setTopicsVisible(true, new Set(topics));
    }
  };

  /** A topic the 3D scene can draw (e.g. markers, point clouds): dropping it turns it on */
  #isShowableTopic(path: DraggedMessagePath): boolean {
    if (this.interfaceMode !== "3d" || !path.isTopic || path.rootSchemaName == undefined) {
      return false;
    }
    // A topic can also be drawn through a message converter to a schema the scene draws
    const schemas = [
      path.rootSchemaName,
      ...(this.topicsByName?.get(path.topicName)?.convertibleTo ?? []),
    ];
    return schemas.some((schema) => this.schemaSubscriptions.has(schema));
  }

  public setCustomCameraModels(newCameraModels: CameraModelsMap): void {
    this.customCameraModels = newCameraModels;
  }
}

function queueMessage(
  messageEvent: Readonly<MessageEvent>,
  subscriptions: RendererSubscription[] | undefined,
): void {
  if (subscriptions) {
    for (const subscription of subscriptions) {
      subscription.queue = subscription.queue ?? [];
      subscription.queue.push(messageEvent);
    }
  }
}

function selectObject(object: THREE.Object3D) {
  object.layers.set(LAYER_SELECTED);
  object.traverse((child) => {
    child.layers.set(LAYER_SELECTED);
  });
}

function deselectObject(object: THREE.Object3D) {
  object.layers.set(LAYER_DEFAULT);
  // Back to its own layer: a batched mesh draws through its batch again
  object.traverse((child) => {
    child.layers.set(child.userData.pickOnly === true ? LAYER_PICK_ONLY : LAYER_DEFAULT);
  });
}

/**
 * Creates a skeleton settings tree. The tree contents are filled in by scene extensions.
 * This dictates the order in which groups appear in the settings editor.
 */
function baseSettingsTree(interfaceMode: InterfaceMode): DocumentedNodes {
  const keys: string[] = [];
  keys.push(interfaceMode === "image" ? "imageMode" : "general", "scene");
  if (interfaceMode === "image") {
    keys.push("imageAnnotations");
  }
  if (interfaceMode === "3d") {
    keys.push("cameraState");
  }
  keys.push("transforms", "topics", "layers");
  if (interfaceMode === "3d") {
    keys.push("publish");
  }
  return Object.fromEntries(keys.map((key) => [key, {}]));
}
