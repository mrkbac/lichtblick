// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fromNanoSec, Time, toNanoSec } from "@foxglove/rostime";
import { Button } from "@mui/material";
import * as _ from "lodash-es";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { DeepPartial } from "ts-essentials";
import { useDebouncedCallback } from "use-debounce";

import { useLatest } from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import {
  Immutable,
  LayoutActions,
  MessageEvent,
  ParameterValue,
  RenderState,
  SettingsTreeAction,
  SettingsTreeNodes,
  Subscription,
  Topic,
  VariableValue,
} from "@lichtblick/suite";
import { AppSetting } from "@lichtblick/suite-base/AppSetting";
import { TopicSettingsUpdater } from "@lichtblick/suite-base/components/PanelExtensionAdapter/types";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import { DEFAULT_SCENE_EXTENSION_CONFIG } from "@lichtblick/suite-base/panels/ThreeDeeRender/SceneExtensionConfig";
import {
  DEFAULT_FOLLOW_MODE,
  PANEL_STYLE,
  isTransformPreloadEnabled,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/constants";
import { SELECTED_ID_VARIABLE } from "@lichtblick/suite-base/panels/ThreeDeeRender/settings";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { findShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { localResourceFolders } from "@lichtblick/suite-base/util/localResourceFolders";

import type { ImageModeConfig, RendererConfig, RendererSubscription } from "./IRenderer";
import { reportPersistentErrors, type Path } from "./LayerErrors";
import type { PickedRenderable } from "./Picker";
import { NO_FRAME_SELECTED, Renderer } from "./Renderer";
import { RendererContext, useRendererEvent, useRendererProperty } from "./RendererContext";
import { RendererOverlay } from "./RendererOverlay";
import { onlyLastByTopicMessage } from "./SceneExtension";
import type { SharedMap } from "./SharedMap";
import { useStyles } from "./ThreeDeeRender.style";
import { CameraState, DEFAULT_CAMERA_STATE } from "./camera";
import {
  PublishRos1Datatypes,
  PublishRos2Datatypes,
  makePointMessage,
  makePoseEstimateMessage,
  makePoseMessage,
} from "./publish";
import type { LayerSettingsTransform } from "./renderables/FrameAxes";
import { PublishClickEventMap, PublishClickType } from "./renderables/PublishClickTool";
import { DEFAULT_PUBLISH_SETTINGS } from "./renderables/PublishSettings";
import { DecayHistoryIngest, isDecayHistoryIngest } from "./renderables/pointExtensionUtils";
import { THREE_DEE_SHORTCUTS } from "./shortcuts";
import { readTransformRange, readTransformsBefore, TransformTopic } from "./transformHistoryReads";
import { Shared3DPanelState, ThreeDeeRenderProps } from "./types";
import { useGpuRecovery } from "./useGpuRecovery";

import "maplibre-gl/dist/maplibre-gl.css";

const LAYER_ERROR_LOG_GRACE_MS = 3000;

const log = Logger.getLogger(__filename);

/** Frames placed under a parent, which reads of transforms around a time should refresh */
function placedFrameIds(renderer: Renderer): string[] {
  const ids: string[] = [];
  for (const frame of renderer.transformTree.frames().values()) {
    if (frame.parent()) {
      ids.push(frame.id);
    }
  }
  return ids;
}

/**
 * A panel that renders a 3D scene. This is a thin wrapper around a `Renderer` instance.
 */
export function ThreeDeeRender(props: Readonly<ThreeDeeRenderProps>): React.JSX.Element {
  const {
    context,
    interfaceMode,
    testOptions,
    customCameraModels,
    enqueueSnackbarFromParent,
    logError,
  } = props;
  const {
    initialState,
    saveState,
    unstable_fetchAsset: fetchAsset,
    unstable_setMessagePathDropConfig: setMessagePathDropConfig,
    unstable_setAlert: setPanelAlert,
  } = context;
  const analytics = useAnalytics();
  const { classes } = useStyles();
  const { t, i18n } = useTranslation("threeDee");

  // Load and save the persisted panel configuration
  const [config, setConfig] = useState<Immutable<RendererConfig>>(() => {
    const partialConfig = initialState as DeepPartial<RendererConfig> | undefined;

    // Initialize the camera from default settings overlaid with persisted settings
    const cameraState: CameraState = _.merge(
      structuredClone(DEFAULT_CAMERA_STATE),
      partialConfig?.cameraState,
    );
    const publish = _.merge(structuredClone(DEFAULT_PUBLISH_SETTINGS), partialConfig?.publish);

    const transforms = (partialConfig?.transforms ?? {}) as Record<
      string,
      Partial<LayerSettingsTransform>
    >;

    return {
      cameraState,
      followMode: partialConfig?.followMode ?? DEFAULT_FOLLOW_MODE,
      followTf: partialConfig?.followTf,
      scene: partialConfig?.scene ?? {},
      transforms,
      topics: partialConfig?.topics ?? {},
      layers: _.mapValues(partialConfig?.layers ?? {}, (layer) =>
        layer?.layerId === "lichtblick.Map"
          ? _.omit(layer, ["rendering", "size", "drawBehind"])
          : layer,
      ),
      publish,
      // deep partial on config, makes gradient tuple type [string | undefined, string | undefined]
      // which is incompatible with `Partial<ColorModeSettings>`
      imageMode: (partialConfig?.imageMode ?? {}) as Partial<ImageModeConfig>,
    };
  });
  const configRef = useLatest(config);
  const lastSavedConfig = useRef<Immutable<RendererConfig> | undefined>(undefined);

  // Save panel settings whenever they change. flushOnExit saves a pending change on unmount.
  const throttledSave = useDebouncedCallback(
    (newConfig: Immutable<RendererConfig>) => {
      // Immediate converter saves already persist this config.
      if (newConfig !== lastSavedConfig.current) {
        saveState(newConfig);
        lastSavedConfig.current = newConfig;
      }
    },
    100,
    { leading: false, trailing: true, maxWait: 1000, flushOnExit: true },
  );

  // Disposing a renderer can write a camera move that was waiting for the camera to rest (see
  // Renderer.dispose). An unmounting panel never re-renders to run the debounced save, so when
  // disposing changed the config, save it right away.
  const latestDisposeRenderer = useLatest((disposedRenderer: Renderer) => {
    const configBefore = disposedRenderer.config;
    disposedRenderer.dispose();
    const configAfter = disposedRenderer.config;
    if (configAfter !== configBefore && configAfter !== lastSavedConfig.current) {
      throttledSave.cancel();
      saveState(configAfter);
      lastSavedConfig.current = configAfter;
    }
  });
  const disposeRenderer = useCallback(
    (disposedRenderer: Renderer) => {
      latestDisposeRenderer.current(disposedRenderer);
    },
    [latestDisposeRenderer],
  );
  const { cameraState } = config;
  const backgroundColor = config.scene.backgroundColor;

  const [sceneCanvas, setSceneCanvas] = useState<HTMLCanvasElement | null>(null);
  const [mapContainer, setMapContainer] = useState<HTMLDivElement | null>(null);
  const [sharedMap, setSharedMap] = useState<SharedMap>();
  const [failedSharedMapLayerId, setFailedSharedMapLayerId] = useState<string>();
  const requestedSharedMapLayerId =
    interfaceMode === "3d"
      ? Object.entries(config.layers).find(
          ([, layer]) => layer?.layerId === "lichtblick.Map" && layer.visible !== false,
        )?.[0]
      : undefined;
  const sharedMapLayerId =
    requestedSharedMapLayerId === failedSharedMapLayerId ? undefined : requestedSharedMapLayerId;
  // The scene always draws into its own canvas; a map shows through it from below
  const canvas = sceneCanvas;
  const { revision: resourceRevision } = useSyncExternalStore(
    localResourceFolders.subscribe,
    localResourceFolders.getSnapshot,
  );
  const [renderer, setRenderer] = useState<Renderer | undefined>(undefined);
  const rendererRef = useRef<Renderer | undefined>(undefined);
  const { canvasKey, status: contextStatus, recreate } = useGpuRecovery(renderer);

  const displayTemporaryError = useCallback(
    (errorString: string) => {
      if (enqueueSnackbarFromParent) {
        enqueueSnackbarFromParent(errorString, "error");
      }
    },
    [enqueueSnackbarFromParent],
  );

  useEffect(() => {
    if (!mapContainer || !sharedMapLayerId) {
      return;
    }
    let disposed = false;
    let instance: SharedMap | undefined;
    void Promise.all([import("@lichtblick/suite-base/panels/Map/maplibre"), import("./SharedMap")])
      .then(([{ Map }, { SharedMap }]) => {
        if (disposed) {
          return;
        }
        const map = new Map({
          container: mapContainer,
          style: { version: 8, sources: {}, layers: [], projection: { type: "mercator" } },
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          maxZoom: 24,
          maxPitch: 85,
          canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
        });
        instance = new SharedMap(map, sharedMapLayerId);
        setSharedMap(instance);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        setFailedSharedMapLayerId(sharedMapLayerId);
        displayTemporaryError(String(error));
      });
    return () => {
      disposed = true;
      const disposedRenderer = rendererRef.current;
      rendererRef.current = undefined;
      if (disposedRenderer) {
        disposeRenderer(disposedRenderer);
      }
      instance?.dispose();
      setSharedMap(undefined);
    };
  }, [mapContainer, sharedMapLayerId, canvasKey, displayTemporaryError, disposeRenderer]);

  useEffect(() => {
    const newRenderer =
      canvas?.isConnected === true
        ? new Renderer({
            canvas,
            sharedMap: sharedMapLayerId ? sharedMap : undefined,
            config: configRef.current,
            interfaceMode,
            fetchAsset,
            sceneExtensionConfig: DEFAULT_SCENE_EXTENSION_CONFIG,
            displayTemporaryError,
            testOptions,
            customCameraModels,
          })
        : undefined;
    setRenderer(newRenderer);
    rendererRef.current = newRenderer;
    return () => {
      const disposedRenderer = rendererRef.current;
      rendererRef.current = undefined;
      if (disposedRenderer) {
        disposeRenderer(disposedRenderer);
      }
    };
  }, [
    canvas,
    sharedMap,
    sharedMapLayerId,
    configRef,
    config.scene.transforms?.enablePreloading,
    config.scene.logDepth,
    // GPU timing is set up with the renderer
    config.scene.enableStats,
    customCameraModels,
    interfaceMode,
    fetchAsset,
    resourceRevision,
    testOptions,
    displayTemporaryError,
    disposeRenderer,
  ]);

  useEffect(() => {
    renderer?.setCustomCameraModels(customCameraModels);
  }, [renderer, customCameraModels]);

  useEffect(() => {
    if (renderer) {
      renderer.setAnalytics(analytics);
    }
  }, [renderer, analytics]);

  useEffect(() => {
    setMessagePathDropConfig(
      renderer
        ? {
            getDropStatus: renderer.getDropStatus,
            handleDrop: renderer.handleDrop,
          }
        : undefined,
    );
  }, [setMessagePathDropConfig, renderer]);

  const [colorScheme, setColorScheme] = useState<"dark" | "light" | undefined>();
  const [timezone, setTimezone] = useState<string | undefined>();
  const [topics, setTopics] = useState<ReadonlyArray<Topic> | undefined>();
  const [parameters, setParameters] = useState<
    Immutable<Map<string, ParameterValue>> | undefined
  >();
  const [variables, setVariables] = useState<ReadonlyMap<string, VariableValue> | undefined>();
  const [currentFrameMessages, setCurrentFrameMessages] = useState<
    ReadonlyArray<MessageEvent> | undefined
  >();
  const [currentTime, setCurrentTime] = useState<Time | undefined>();
  const [didSeek, setDidSeek] = useState<boolean>(false);
  const [sharedPanelState, setSharedPanelState] = useState<undefined | Shared3DPanelState>();
  const [isLoadingTransforms, setIsLoadingTransforms] = useState<boolean>(false);
  const [loadedTransformCount, setLoadedTransformCount] = useState<number>(0);
  // Times of the transform history the tree holds completely, in ns; -1n when none
  const transformsCompleteUntilRef = useRef(-1n);
  const seekReadRef = useRef<AbortController | undefined>(undefined);
  const decayReadRef = useRef<AbortController | undefined>(undefined);
  // Transform topic names the transform tree was filled from
  const transformTopicNamesRef = useRef<string | undefined>(undefined);

  const renderRef = useRef({ needsRender: false });
  // Marks that the frame currently being processed resulted from a seek. On such frames the panel
  // defers the frame barrier (`renderDone`) until any in-flight video decode has settled, so the
  // player parks the cursor on the seek target until the frame is actually rendered.
  const seekFrameRef = useRef(false);
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  const schemaSubscriptions = useRendererProperty(
    "schemaSubscriptions",
    "schemaSubscriptionsChanged",
    () => new Map(),
    renderer,
  );
  const topicSubscriptions = useRendererProperty(
    "topicSubscriptions",
    "topicSubscriptionsChanged",
    () => new Map(),
    renderer,
  );

  // Share camera moves with synced panels. The renderer draws them itself and writes them to the
  // config once the camera rests (see CameraStateSettings), so no React update runs per move.
  useEffect(() => {
    if (!renderer || config.scene.syncCamera !== true) {
      return;
    }
    const listener = () => {
      const newCameraState = renderer.getCameraState();
      if (newCameraState) {
        context.setSharedPanelState({
          cameraState: newCameraState,
          followMode: config.followMode,
          followTf: renderer.followFrameId,
        });
      }
    };
    renderer.addListener("cameraMove", listener);
    return () => void renderer.removeListener("cameraMove", listener);
  }, [config.scene.syncCamera, config.followMode, context, renderer?.followFrameId, renderer]);

  // Handle user changes in the settings sidebar
  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (renderer) {
        const initialCameraState = renderer.getCameraState();
        renderer.settings.handleAction(action);
        const updatedCameraState = renderer.getCameraState();
        // Communicate camera changes from settings to the global state if syncing.
        if (updatedCameraState !== initialCameraState && config.scene.syncCamera === true) {
          context.setSharedPanelState({
            cameraState: updatedCameraState,
            followMode: config.followMode,
            followTf: renderer.followFrameId,
          });
        }
      }
    },
    [config.followMode, config.scene.syncCamera, context, renderer],
  );

  // Maintain the settings tree
  const [settingsTree, setSettingsTree] = useState<SettingsTreeNodes | undefined>(undefined);
  const updateSettingsTree = useCallback((curRenderer: Renderer) => {
    setSettingsTree(curRenderer.settings.tree());
  }, []);
  useRendererEvent("settingsTreeChange", updateSettingsTree, renderer);

  // Save the panel configuration when it changes
  const updateConfig = useCallback(
    (curRenderer: Renderer) => {
      // A renderer created before the next render (e.g. replacing a disposed one) must start from
      // this config, not the one from the last render
      configRef.current = curRenderer.config;
      setConfig(curRenderer.config);
    },
    [configRef],
  );
  useRendererEvent("configChange", updateConfig, renderer);

  // Write to a global variable when the current selection changes
  const updateSelectedRenderable = useCallback(
    (selection: PickedRenderable | undefined) => {
      const id = selection?.renderable.idFromMessage();
      const customVariable = selection?.renderable.selectedIdVariable();
      if (customVariable) {
        context.setVariable(customVariable, id);
      }
      context.setVariable(SELECTED_ID_VARIABLE, id);
    },
    [context],
  );
  useRendererEvent("selectedRenderable", updateSelectedRenderable, renderer);

  const setVariable = useCallback(
    (name: string, value: VariableValue) => {
      context.setVariable(name, value);
    },
    [context],
  );
  useRendererEvent("setVariable", setVariable, renderer);

  // Log LayerErrors to PanelLogs
  const handleLayerErrorUpdate = useCallback(
    (path: Path, errorId: string, errorMessage: string, raisedAt: bigint) => {
      // Every panel starts without frames; logging that floods the log after each seek
      if (logError != undefined && errorId !== NO_FRAME_SELECTED) {
        const pathString = path.join(" > ");
        const fullMessage = `[${pathString}] ${errorMessage}`;
        // 0n: no frame rendered yet, so the panel uses the playback time
        logError(fullMessage, undefined, raisedAt === 0n ? undefined : fromNanoSec(raisedAt));
      }
    },
    [logError],
  );

  // Log layer errors that outlive the moment it takes a good recording to deliver its transforms
  // and camera info; transient ones only show in the settings tree while active.
  useEffect(() => {
    if (!renderer?.settings.errors) {
      return;
    }
    return reportPersistentErrors(
      renderer.settings.errors,
      handleLayerErrorUpdate,
      LAYER_ERROR_LOG_GRACE_MS,
      () => renderer.currentTime,
    );
  }, [renderer, handleLayerErrorUpdate]);

  const [focusedSettingsPath, setFocusedSettingsPath] = useState<undefined | readonly string[]>();

  const onShowTopicSettings = useCallback((topic: string) => {
    setFocusedSettingsPath(["topics", topic]);
  }, []);

  // Rebuild the settings sidebar tree as needed
  useEffect(() => {
    let topicsBeforeAction = renderer?.config.topics;

    // Detect direct field edits even when the scene handler applies them first.
    const handleSettingsAction = (action: SettingsTreeAction) => {
      topicsBeforeAction = renderer?.config.topics;
      actionHandler(action);
    };

    // Save immediately so stale editor values cannot overwrite the latest edits.
    const applyConverterSettings: TopicSettingsUpdater = (updateSettings) => {
      if (renderer) {
        renderer.updateConfig(updateSettings);
        if (renderer.config.topics !== topicsBeforeAction) {
          // A pending debounced save holds an older config; it must not overwrite this one.
          throttledSave.cancel();
          saveState(renderer.config);
          lastSavedConfig.current = renderer.config;
        }
      }
    };

    context.updatePanelSettingsEditor(
      {
        actionHandler: handleSettingsAction,
        enableFilter: true,
        focusedPath: focusedSettingsPath,
        nodes: settingsTree ?? {},
      },
      applyConverterSettings,
    );
  }, [
    actionHandler,
    context,
    focusedSettingsPath,
    settingsTree,
    renderer,
    saveState,
    throttledSave,
  ]);

  // Update the renderer's reference to `config` when it changes. Note that this does *not*
  // automatically update the settings tree.
  useEffect(() => {
    if (renderer) {
      renderer.config = config;
      renderRef.current.needsRender = true;
    }
  }, [config, renderer]);

  // Update the renderer's reference to `topics` when it changes
  useEffect(() => {
    if (renderer) {
      renderer.setTopics(topics);
      renderRef.current.needsRender = true;
    }
  }, [topics, renderer]);

  const isPreloadingEnabled = isTransformPreloadEnabled(config);
  // How many times the preloaded transform history was halved to fit the sample budget
  const [transformDecimations, setTransformDecimations] = useState(0);
  // Live transforms are thinned too, without a preload read to report it
  useEffect(() => {
    if (!renderer) {
      return;
    }
    const onUpdate = () => {
      setTransformDecimations(renderer.transformTree.decimations);
    };
    renderer.addListener("transformTreeUpdated", onUpdate);
    return () => {
      renderer.removeListener("transformTreeUpdated", onUpdate);
    };
  }, [renderer]);
  useEffect(() => {
    setPanelAlert?.(
      "transform-preload",
      transformDecimations > 0
        ? {
            severity: "info",
            message: t("transformHistoryThinnedAlert"),
            tip: t("transformHistoryThinnedAlertTip", { factor: 2 ** transformDecimations }),
          }
        : undefined,
    );
  }, [transformDecimations, setPanelAlert, t]);

  // Tell the renderer if we are connected to a ROS data source
  useEffect(() => {
    if (renderer) {
      renderer.ros = context.dataSourceProfile === "ros1" || context.dataSourceProfile === "ros2";
    }
  }, [context.dataSourceProfile, renderer]);

  useEffect(() => {
    throttledSave(config);
  }, [config, throttledSave]);

  // Keep default panel title up to date with selected image topic in image mode
  useEffect(() => {
    if (interfaceMode === "image") {
      context.setDefaultPanelTitle(config.imageMode.imageTopic);
    }
  }, [interfaceMode, context, config.imageMode.imageTopic]);

  // Build a list of topics to subscribe to
  const [topicsToSubscribe, setTopicsToSubscribe] = useState<Subscription[] | undefined>(undefined);

  // Transform topics, whose history is read with range reads instead of player preloading
  const [transformTopics, setTransformTopics] = useState<readonly TransformTopic[]>([]);

  // Subscribed topics drawn with a decay time by a layer that takes read-back history (not e.g.
  // Velodyne scans), the layer, and how far back their history reaches in ns
  const decayTopics: (TransformTopic & { decayNs: bigint; ingest: DecayHistoryIngest })[] = [];
  const historyLayers: DecayHistoryIngest[] = [];
  for (const extension of renderer?.sceneExtensions.values() ?? []) {
    if (isDecayHistoryIngest(extension)) {
      historyLayers.push(extension);
    }
  }
  for (const { topic, convertTo } of topicsToSubscribe ?? []) {
    const decayTime = (config.topics[topic] as { decayTime?: number } | undefined)?.decayTime ?? 0;
    const schema = convertTo ?? topics?.find((candidate) => candidate.name === topic)?.schemaName;
    const ingest = historyLayers.find(
      (layer) => schema != undefined && layer.historySchemas.has(schema),
    );
    if (decayTime > 0 && ingest) {
      decayTopics.push({ topic, convertTo, decayNs: BigInt(Math.round(decayTime * 1e9)), ingest });
    }
  }
  const decayTopicsRef = useLatest(decayTopics);
  const decayKey = decayTopics.map((d) => `${d.topic} ${d.convertTo} ${d.decayNs}`).join("\n");

  // A seek empties the decay histories: read each decayed topic's window before the new time again.
  // The layers put messages older than their latest one straight into the history. With `only`,
  // read just those topics and keep the reads in flight (a decay time changed, not the time).
  const readDecayHistory = useCallback(
    (time: bigint, only?: ReadonlySet<string>) => {
      if (only == undefined || decayReadRef.current?.signal.aborted !== false) {
        decayReadRef.current?.abort();
        decayReadRef.current = new AbortController();
      }
      const abort = decayReadRef.current;
      if (!renderer || decayTopicsRef.current.length === 0) {
        abort.abort();
        return;
      }
      for (const { decayNs, ingest, ...source } of decayTopicsRef.current) {
        if (only != undefined && !only.has(source.topic)) {
          continue;
        }
        void readTransformRange({
          subscribeRange: context.unstable_subscribeMessageRange,
          topics: [source],
          start: time - decayNs,
          end: time,
          signal: abort.signal,
          onBatch: (batch) => {
            // Decoded right away into the history, so only one batch of raw messages is ever held
            for (const messageEvent of batch) {
              ingest.addHistoricalMessage(messageEvent);
            }
            renderer.queueAnimationFrame();
          },
        });
      }
    },
    // context is static, we're just using it to subscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderer, decayTopicsRef],
  );
  useLayoutEffect(() => () => decayReadRef.current?.abort(), [readDecayHistory]);

  // After a seek past the preloaded history (or with preloading off), read the transforms just
  // before the new time, so every frame is placed right without waiting for preloading. The first
  // window covers the longest decay time, so the decay histories read back are placed too.
  const readTransformsAfterSeek = useCallback(
    (time: bigint, knownFrameIds: readonly string[]) => {
      seekReadRef.current?.abort();
      const floor = transformsCompleteUntilRef.current;
      if (!renderer || transformTopics.length === 0 || time <= floor) {
        return;
      }
      const abort = new AbortController();
      seekReadRef.current = abort;
      const refreshed = new Set<string>();
      void readTransformsBefore({
        subscribeRange: context.unstable_subscribeMessageRange,
        topics: transformTopics,
        time,
        floor,
        minLookback: decayTopicsRef.current.reduce(
          (max, d) => (d.decayNs > max ? d.decayNs : max),
          0n,
        ),
        signal: abort.signal,
        onBatch: (batch) => {
          renderer.addTransformMessages(batch, refreshed);
        },
        // A frame counts as found once this read gave it a transform; a cached one may be stale.
        // Static frames are published once and restored from their cache, so they never block.
        isMissing: () =>
          knownFrameIds.some((id) => !refreshed.has(id) && !renderer.isStaticTransformFrame(id)),
      }).then((ok) => {
        if (!ok && !abort.signal.aborted) {
          // Older windows cannot stand in for the part that failed; the frames keep what they had
          log.warn("Reading transforms around the seek time failed; some frames may be stale");
        }
      });
    },
    // context is static, we're just using it to subscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderer, transformTopics],
  );
  // A layout effect, declared before the preloading one: React runs its cleanup before that effect
  // starts a new read, so the cleanup cannot cancel it (a passive cleanup would run after).
  useLayoutEffect(() => () => seekReadRef.current?.abort(), [readTransformsAfterSeek]);

  // A new or longer decay time shows its window at once, read for just that topic (scans already
  // in the history are skipped before decoding), with the transforms of the new window so the
  // older scans are placed (e.g. while paused); with no decayed topic left, the reads stop
  const decayReadNsRef = useRef(new Map<string, bigint>());
  // A new renderer starts with empty histories: every decayed topic counts as new
  useEffect(() => {
    decayReadNsRef.current = new Map();
  }, [renderer]);
  useEffect(() => {
    if (!renderer) {
      return;
    }
    const grown = new Set<string>();
    const readNs = new Map<string, bigint>();
    for (const { topic, decayNs } of decayTopicsRef.current) {
      readNs.set(topic, decayNs);
      if (decayNs > (decayReadNsRef.current.get(topic) ?? 0n)) {
        grown.add(topic);
      }
    }
    decayReadNsRef.current = readNs;
    if (readNs.size === 0) {
      readDecayHistory(renderer.currentTime); // stops the reads
    } else if (grown.size > 0) {
      readTransformsAfterSeek(renderer.currentTime, placedFrameIds(renderer));
      readDecayHistory(renderer.currentTime, grown);
    }
  }, [renderer, decayKey, readDecayHistory, readTransformsAfterSeek, decayTopicsRef]);

  // Preloading: read the whole transform history into the renderer's transform tree
  useLayoutEffect(() => {
    if (!renderer) {
      return;
    }
    transformsCompleteUntilRef.current = -1n;
    setIsLoadingTransforms(false);
    setLoadedTransformCount(0);
    const topicNames = new Set(transformTopics.map(({ topic }) => topic));
    const topicsKey = [...topicNames].sort().join("\n");
    const topicsChanged = topicsKey !== transformTopicNamesRef.current;
    transformTopicNamesRef.current = topicsKey;
    if (
      renderer.transformTree.isComplete() ||
      (topicsChanged && renderer.transformTree.frames().size > 0)
    ) {
      // The history came from other topics (or preloading is turning off): start over from the
      // current ones, and read the transforms around the current time again right away
      const knownFrameIds = [...renderer.transformTree.frames().keys()];
      renderer.resetTransformHistory(topicNames);
      readTransformsAfterSeek(renderer.currentTime, knownFrameIds);
    }
    setTransformDecimations(renderer.transformTree.decimations);
    if (!isPreloadingEnabled || transformTopics.length === 0) {
      return;
    }

    const abort = new AbortController();
    // Newest time read per range read (a topic can be read natively and converted); the tree is
    // complete up to the oldest of them
    const key = ({ topic, convertTo }: TransformTopic) => `${topic}\n${convertTo ?? ""}`;
    const readUntil = new Map(transformTopics.map((source) => [key(source), -1n]));
    const updateCompleteUntil = () => {
      let until: bigint | undefined;
      for (const time of readUntil.values()) {
        until = until == undefined || time < until ? time : until;
      }
      transformsCompleteUntilRef.current = until ?? -1n;
    };
    let count = 0;
    let lastUiUpdate = 0;
    const updateUi = () => {
      setLoadedTransformCount(count);
      setTransformDecimations(renderer.transformTree.decimations);
    };

    void readTransformRange({
      subscribeRange: context.unstable_subscribeMessageRange,
      topics: transformTopics,
      signal: abort.signal,
      onBatch: (batch, source) => {
        // Only a source with ranges (a recording) has a complete history; live sources never get here
        if (count === 0) {
          renderer.transformTree.setComplete(true);
          setIsLoadingTransforms(true);
        }
        renderer.addTransformMessages(batch);
        readUntil.set(key(source), toNanoSec(batch[batch.length - 1]!.receiveTime));
        updateCompleteUntil();
        count += batch.length;
        const now = Date.now();
        if (now - lastUiUpdate > 100) {
          lastUiUpdate = now;
          updateUi();
        }
      },
      onTopicDone: (source) => {
        readUntil.set(key(source), BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000_000n);
        updateCompleteUntil();
      },
    }).then(() => {
      if (!abort.signal.aborted && count > 0) {
        updateUi();
        setIsLoadingTransforms(false);
      }
    });

    return () => {
      abort.abort();
    };
    // in this case context is static, we're just using it to subscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, isPreloadingEnabled, transformTopics, readTransformsAfterSeek]);

  // Establish a connection to the message pipeline with context.watch and context.onRender
  useLayoutEffect(() => {
    context.onRender = (renderState: Immutable<RenderState>, done) => {
      if (renderState.currentTime) {
        setCurrentTime(renderState.currentTime);
      }

      // Check if didSeek is set to true to reset the preloadedMessageTime and
      // trigger a state flush in Renderer
      if (renderState.didSeek === true) {
        setDidSeek(true);
        seekFrameRef.current = true;
      }

      // Set the done callback into a state variable to trigger a re-render
      setRenderDone(() => done);

      // Keep UI elements and the renderer aware of the current color scheme
      setColorScheme(renderState.colorScheme);
      if (renderState.appSettings) {
        const tz = renderState.appSettings.get(AppSetting.TIMEZONE);
        setTimezone(typeof tz === "string" ? tz : undefined);
      }

      // We may have new topics - since we are also watching for messages in
      // the current frame, topics may not have changed
      setTopics(renderState.topics);

      setSharedPanelState(renderState.sharedPanelState as Shared3DPanelState);

      // Watch for any changes in the map of observed parameters
      setParameters(renderState.parameters);

      if (renderState.variables) {
        // Immutable<Map> is structurally the same map; the renderer only reads it
        setVariables(renderState.variables as ReadonlyMap<string, VariableValue>);
      }

      // currentFrame has messages on subscribed topics since the last render call
      setCurrentFrameMessages(renderState.currentFrame);
    };

    context.watch("colorScheme");
    context.watch("currentFrame");
    context.watch("currentTime");
    context.watch("didSeek");
    context.watch("parameters");
    context.watch("variables");
    context.watch("sharedPanelState");
    context.watch("topics");
    context.watch("appSettings");
    context.subscribeAppSettings([AppSetting.TIMEZONE]);
  }, [context, renderer]);

  useEffect(() => {
    if (!topics) {
      setTopicsToSubscribe(undefined);
      return;
    }

    const newSubscriptions: Subscription[] = [];
    const newTransformTopics: TransformTopic[] = [];

    const addSubscription = (
      topic: Topic,
      rendererSubscription: RendererSubscription,
      convertTo?: string,
    ) => {
      let shouldSubscribe = rendererSubscription.shouldSubscribe?.(topic.name);
      if (shouldSubscribe == undefined) {
        if (config.topics[topic.name]?.visible === true) {
          shouldSubscribe = true;
        } else if (config.imageMode.annotations?.[topic.name]?.visible === true) {
          shouldSubscribe = true;
        } else {
          shouldSubscribe = false;
        }
      }
      if (shouldSubscribe) {
        // Timestamp sync needs every message to find matching stamps
        const synced =
          config.scene.syncTimestamps === true && config.topics[topic.name]?.sync === true;
        const latestOnly =
          !synced &&
          (rendererSubscription.latestOnly?.() ??
            rendererSubscription.filterQueue === onlyLastByTopicMessage);
        const sampling =
          rendererSubscription.preload !== true && latestOnly
            ? { mode: "latest-per-render-tick" as const }
            : undefined;
        newSubscriptions.push({ topic: topic.name, convertTo, sampling });
        if (rendererSubscription.preload === true) {
          newTransformTopics.push({ topic: topic.name, convertTo });
        }
      }
    };

    for (const topic of topics) {
      for (const rendererSubscription of topicSubscriptions.get(topic.name) ?? []) {
        addSubscription(topic, rendererSubscription);
      }
      for (const rendererSubscription of schemaSubscriptions.get(topic.schemaName) ?? []) {
        addSubscription(topic, rendererSubscription);
      }
      for (const schemaName of topic.convertibleTo ?? []) {
        for (const rendererSubscription of schemaSubscriptions.get(schemaName) ?? []) {
          addSubscription(topic, rendererSubscription, schemaName);
        }
      }
    }

    // Sort the list to make comparisons stable
    newSubscriptions.sort((a, b) => a.topic.localeCompare(b.topic));
    setTopicsToSubscribe((prev) => (_.isEqual(prev, newSubscriptions) ? prev : newSubscriptions));
    newTransformTopics.sort((a, b) => a.topic.localeCompare(b.topic));
    setTransformTopics((prev) => (_.isEqual(prev, newTransformTopics) ? prev : newTransformTopics));
  }, [
    topics,
    config.topics,
    // Need to update subscriptions when imagemode topics change
    // shouldSubscribe values will be re-evaluated
    config.imageMode.calibrationTopic,
    config.imageMode.imageTopic,
    schemaSubscriptions,
    topicSubscriptions,
    config.imageMode.annotations,
    // Image sampling depends on synchronization
    config.imageMode.synchronize,
    config.scene.syncTimestamps,
    // Need to update subscriptions when layers change as URDF layers might subscribe to topics
    // shouldSubscribe values will be re-evaluated
    config.layers,
  ]);

  // A replacement renderer needs the current messages again, including while playback is paused.
  useEffect(() => {
    if (!renderer) {
      return;
    }
    return () => {
      context.subscribe([] as Subscription[]);
    };
  }, [context, renderer]);

  // Notify the extension context when our subscription list changes.
  useEffect(() => {
    if (!renderer) {
      return;
    }
    context.subscribe(topicsToSubscribe ?? []);
  }, [context, topicsToSubscribe, renderer]);

  // Keep the renderer parameters up to date
  useEffect(() => {
    if (renderer) {
      renderer.setParameters(parameters);
    }
  }, [parameters, renderer]);

  useEffect(() => {
    if (renderer && variables) {
      renderer.setVariables(variables);
    }
  }, [variables, renderer]);

  // Keep the renderer currentTime up to date and handle seeking
  useEffect(() => {
    const newTimeNs = currentTime ? toNanoSec(currentTime) : undefined;

    /*
     * NOTE AROUND SEEK HANDLING
     * Seeking MUST be handled even if there is no change in current time.  When there is a subscription
     * change while paused, the player goes into `seek-backfill` which sets didSeek to true.
     *
     * We cannot early return here when there is no change in current time due to that, otherwise it would
     * handle seek next time the current time changes and clear the backfilled messages and transforms.
     */
    if (!renderer || newTimeNs == undefined) {
      return;
    }
    const oldTimeNs = renderer.currentTime;

    renderer.setCurrentTime(newTimeNs);
    if (didSeek) {
      // Frames placed before the seek, collected before handleSeek may clear them
      const frameIds = placedFrameIds(renderer);
      renderer.handleSeek(oldTimeNs);
      readTransformsAfterSeek(newTimeNs, frameIds);
      readDecayHistory(newTimeNs);
      setDidSeek(false);
    }
  }, [currentTime, renderer, didSeek, readTransformsAfterSeek, readDecayHistory]);

  // Keep the renderer colorScheme and backgroundColor up to date
  useEffect(() => {
    if (colorScheme && renderer) {
      renderer.setColorScheme(colorScheme, backgroundColor);
      renderRef.current.needsRender = true;
    }
  }, [backgroundColor, colorScheme, renderer]);

  // Handle messages and render a frame if new messages are available
  useEffect(() => {
    if (!renderer || !currentFrameMessages) {
      return;
    }

    for (const message of currentFrameMessages) {
      renderer.addMessageEvent(message);
    }

    renderRef.current.needsRender = true;
  }, [currentFrameMessages, renderer]);

  // Update the renderer when the camera moves
  useEffect(() => {
    if (!_.isEqual(cameraState, renderer?.getCameraState())) {
      renderer?.setCameraState(cameraState);
      renderRef.current.needsRender = true;
    }
  }, [cameraState, renderer]);

  // Sync camera with shared state, if enabled.
  useEffect(() => {
    if (!renderer || sharedPanelState == undefined || config.scene.syncCamera !== true) {
      return;
    }

    if (sharedPanelState.followMode !== config.followMode) {
      renderer.setCameraSyncError(
        `Follow mode must be ${sharedPanelState.followMode} to sync camera.`,
      );
    } else if (sharedPanelState.followTf !== renderer.followFrameId) {
      renderer.setCameraSyncError(
        `Display frame must be ${sharedPanelState.followTf} to sync camera.`,
      );
    } else {
      const newCameraState = sharedPanelState.cameraState;
      renderer.setCameraState(newCameraState);
      renderRef.current.needsRender = true;
      setConfig((prevConfig) => ({
        ...prevConfig,
        cameraState: newCameraState,
      }));
      renderer.setCameraSyncError(undefined);
    }
  }, [
    config.scene.syncCamera,
    config.followMode,
    renderer,
    renderer?.followFrameId,
    sharedPanelState,
  ]);

  // Render a new frame if requested
  useEffect(() => {
    if (renderer && renderRef.current.needsRender) {
      renderer.animationFrame();
      renderRef.current.needsRender = false;
    }
  });

  // Invoke the done callback once the render is complete. On a seek frame, defer the callback
  // until any in-flight video decode has settled so the player parks the cursor on the seek target
  // until the frame is actually painted (matching the "stop, render, then resume" seek behavior),
  // instead of resuming playback and racing the video forward to catch up. Steady-state frames
  // invoke the callback immediately, leaving normal playback pacing unchanged.
  useEffect(() => {
    const done = renderDone;
    if (!done) {
      return;
    }

    if (!renderer || !seekFrameRef.current) {
      done();
      return;
    }
    seekFrameRef.current = false;

    let invoke: (() => void) | undefined = done;
    const callOnce = () => {
      if (invoke) {
        invoke();
        invoke = undefined;
      }
    };
    renderer.settleVideoDecodes().then(callOnce, callOnce);
    // If a newer frame supersedes this one before the decode settles, release the barrier so the
    // pipeline is never left waiting on a stale frame.
    return callOnce;
  }, [renderDone, renderer]);

  // Create a useCallback wrapper for adding a new panel to the layout, used to open the
  // "Raw Messages" panel from the object inspector
  const addPanel = useCallback(
    (params: Parameters<LayoutActions["addPanel"]>[0]) => {
      context.layout.addPanel(params);
    },
    [context.layout],
  );

  const [measureActive, setMeasureActive] = useState(false);
  useEffect(() => {
    const onStart = () => {
      setMeasureActive(true);
    };
    const onEnd = () => {
      setMeasureActive(false);
    };
    renderer?.measurementTool.addEventListener("foxglove.measure-start", onStart);
    renderer?.measurementTool.addEventListener("foxglove.measure-end", onEnd);
    return () => {
      renderer?.measurementTool.removeEventListener("foxglove.measure-start", onStart);
      renderer?.measurementTool.removeEventListener("foxglove.measure-end", onEnd);
    };
  }, [renderer?.measurementTool]);

  const onClickMeasure = useCallback(() => {
    if (measureActive) {
      renderer?.measurementTool.stopMeasuring();
    } else {
      renderer?.measurementTool.startMeasuring();
      renderer?.publishClickTool.stop();
    }
  }, [measureActive, renderer]);

  const [publishActive, setPublishActive] = useState(false);
  useEffect(() => {
    if (renderer?.publishClickTool.publishClickType !== config.publish.type) {
      renderer?.publishClickTool.setPublishClickType(config.publish.type);
      // stop if we changed types while a publish action was already in progress
      renderer?.publishClickTool.stop();
    }
  }, [config.publish.type, renderer]);

  const publishTopics = useMemo(() => {
    return {
      goal: config.publish.poseTopic,
      point: config.publish.pointTopic,
      pose: config.publish.poseEstimateTopic,
    };
  }, [config.publish.poseTopic, config.publish.pointTopic, config.publish.poseEstimateTopic]);

  useEffect(() => {
    const datatypes =
      context.dataSourceProfile === "ros2" ? PublishRos2Datatypes : PublishRos1Datatypes;
    context.advertise?.(publishTopics.goal, "geometry_msgs/PoseStamped", { datatypes });
    context.advertise?.(publishTopics.point, "geometry_msgs/PointStamped", { datatypes });
    context.advertise?.(publishTopics.pose, "geometry_msgs/PoseWithCovarianceStamped", {
      datatypes,
    });

    return () => {
      context.unadvertise?.(publishTopics.goal);
      context.unadvertise?.(publishTopics.point);
      context.unadvertise?.(publishTopics.pose);
    };
  }, [publishTopics, context, context.dataSourceProfile]);

  const latestPublishConfig = useLatest(config.publish);

  useEffect(() => {
    const onStart = () => {
      setPublishActive(true);
    };
    const onSubmit = (event: PublishClickEventMap["foxglove.publish-submit"]) => {
      const frameId = renderer?.followFrameId;
      if (frameId == undefined) {
        log.warn("Unable to publish, renderFrameId is not set");
        return;
      }
      if (!context.publish) {
        log.error("Data source does not support publishing");
        return;
      }
      if (context.dataSourceProfile !== "ros1" && context.dataSourceProfile !== "ros2") {
        log.warn("Publishing is only supported in ros1 and ros2");
        return;
      }

      try {
        switch (event.publishClickType) {
          case "point": {
            const message = makePointMessage(event.point, frameId);
            context.publish(publishTopics.point, message);
            break;
          }
          case "pose": {
            const message = makePoseMessage(event.pose, frameId);
            context.publish(publishTopics.goal, message);
            break;
          }
          case "pose_estimate": {
            const message = makePoseEstimateMessage(
              event.pose,
              frameId,
              latestPublishConfig.current.poseEstimateXDeviation,
              latestPublishConfig.current.poseEstimateYDeviation,
              latestPublishConfig.current.poseEstimateThetaDeviation,
            );
            context.publish(publishTopics.pose, message);
            break;
          }
        }
      } catch (error) {
        log.info(error);
      }
    };
    const onEnd = () => {
      setPublishActive(false);
    };
    renderer?.publishClickTool.addEventListener("foxglove.publish-start", onStart);
    renderer?.publishClickTool.addEventListener("foxglove.publish-submit", onSubmit);
    renderer?.publishClickTool.addEventListener("foxglove.publish-end", onEnd);
    return () => {
      renderer?.publishClickTool.removeEventListener("foxglove.publish-start", onStart);
      renderer?.publishClickTool.removeEventListener("foxglove.publish-submit", onSubmit);
      renderer?.publishClickTool.removeEventListener("foxglove.publish-end", onEnd);
    };
  }, [
    context,
    latestPublishConfig,
    publishTopics,
    renderer?.followFrameId,
    renderer?.publishClickTool,
  ]);

  const onClickPublish = useCallback(() => {
    if (publishActive) {
      renderer?.publishClickTool.stop();
    } else {
      renderer?.publishClickTool.start();
      renderer?.measurementTool.stopMeasuring();
    }
  }, [publishActive, renderer]);

  const onChangePublishClickType = useCallback(
    (type: PublishClickType) => {
      renderer?.publishClickTool.setPublishClickType(type);
      renderer?.publishClickTool.start();
    },
    [renderer],
  );

  const onTogglePerspective = useCallback(() => {
    const currentState = renderer?.getCameraState()?.perspective ?? false;
    actionHandler({
      action: "update",
      payload: {
        input: "boolean",
        path: ["cameraState", "perspective"],
        value: !currentState,
      },
    });
  }, [actionHandler, renderer]);

  const [hoverInspector, setHoverInspector] = useState(true);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (findShortcut(THREE_DEE_SHORTCUTS, event)?.id) {
        case "3d.togglePerspective":
          onTogglePerspective();
          break;
        case "3d.recenter":
          actionHandler({
            action: "update",
            payload: { input: "vec3", path: ["cameraState", "targetOffset"], value: [0, 0, 0] },
          });
          break;
        case "3d.toggleInspector":
          setHoverInspector((on) => !on);
          break;
        default:
          return;
      }
      event.stopPropagation();
      event.preventDefault();
    },
    [actionHandler, onTogglePerspective],
  );

  // The 3d panel only supports publishing to ros1 and ros2 data sources
  const isRosDataSource =
    context.dataSourceProfile === "ros1" || context.dataSourceProfile === "ros2";
  const canPublish = context.publish != undefined && isRosDataSource;

  return (
    <ThemeProvider
      isDark={colorScheme === "dark"}
      ownerDocument={context.panelElement.ownerDocument}
    >
      <div style={PANEL_STYLE} onKeyDown={onKeyDown}>
        <div
          key={`map-${canvasKey}`}
          ref={setMapContainer}
          className={classes.sharedMap}
          style={{ display: sharedMapLayerId ? undefined : "none" }}
        />
        <canvas
          key={`canvas-${sharedMapLayerId ?? "3d"}-${canvasKey}`}
          ref={setSceneCanvas}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            ...((measureActive || publishActive) && { cursor: "crosshair" }),
          }}
        />
        {isLoadingTransforms && config.scene.enableStats === true && (
          <div className={classes.loadingTransforms}>
            {t("loadingTransforms", {
              count: loadedTransformCount,
              formattedCount: loadedTransformCount.toLocaleString(i18n.language),
            })}
          </div>
        )}
        {contextStatus !== "ok" && (
          <div className={classes.contextLost} role="status">
            {contextStatus === "unsupported" ? (
              (renderer?.gpuError?.message ?? t("webGpuRequired"))
            ) : contextStatus === "restoring" ? (
              t("graphicsContextRestoring")
            ) : (
              <>
                {t("graphicsContextLost")}
                <Button size="small" variant="outlined" color="inherit" onClick={recreate}>
                  {t("restoreGraphics")}
                </Button>
              </>
            )}
          </div>
        )}
        <RendererContext.Provider value={renderer}>
          <RendererOverlay
            interfaceMode={interfaceMode}
            canvas={canvas}
            addPanel={addPanel}
            enableStats={config.scene.enableStats ?? false}
            perspective={config.cameraState.perspective}
            onTogglePerspective={onTogglePerspective}
            hoverInspector={hoverInspector}
            measureActive={measureActive}
            onClickMeasure={onClickMeasure}
            canPublish={canPublish}
            publishActive={publishActive}
            onClickPublish={onClickPublish}
            onShowTopicSettings={onShowTopicSettings}
            publishClickType={renderer?.publishClickTool.publishClickType ?? "point"}
            onChangePublishClickType={onChangePublishClickType}
            timezone={timezone}
          />
        </RendererContext.Provider>
      </div>
    </ThemeProvider>
  );
}
