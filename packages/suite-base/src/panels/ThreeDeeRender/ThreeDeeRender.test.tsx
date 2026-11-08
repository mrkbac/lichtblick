/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import { produce } from "immer";
import type { Mock } from "vitest";

import { SettingsTreeAction, Topic } from "@lichtblick/suite";
import MockPanelContextProvider from "@lichtblick/suite-base/components/MockPanelContextProvider";
import {
  BuiltinPanelExtensionContext,
  PanelExtensionAdapter,
} from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { useAnalytics } from "@lichtblick/suite-base/context/AnalyticsContext";
import {
  DEFAULT_FOLLOW_MODE,
  MAX_TRANSFORM_MESSAGES,
} from "@lichtblick/suite-base/panels/ThreeDeeRender/constants";
import type { MessageEvent } from "@lichtblick/suite-base/players/types";
import * as PanelStateContextProvider from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";
import RenderStateBuilder from "@lichtblick/suite-base/testing/builders/RenderStateBuilder";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { RendererConfig } from "./IRenderer";
import { Renderer } from "./Renderer";
import { ThreeDeeRender } from "./ThreeDeeRender";
import { DEFAULT_CAMERA_STATE } from "./camera";
import type { InterfaceMode, ThreeDeeRenderProps } from "./types";

// three.js modules
vi.mock("./ModelCache", () => ({
  ModelCache: vi.fn(),
}));

vi.mock("./SceneExtensionConfig", () => ({
  DEFAULT_SCENE_EXTENSION_CONFIG: {},
}));

vi.mock("@lichtblick/suite-base/context/AnalyticsContext", () => ({
  useAnalytics: vi.fn(),
}));

const createMockRenderer = (overrides?: Record<string, any>) => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const defaultRenderer = {
    dispose: vi.fn(),
    config: {},
    setTopics: vi.fn(),
    setParameters: vi.fn(),
    setCurrentTime: vi.fn(),
    handleSeek: vi.fn(),
    setColorScheme: vi.fn(),
    handleAllFramesMessages: vi.fn(),
    addMessageEvent: vi.fn(),
    setCameraState: vi.fn(),
    getCameraState: vi.fn().mockReturnValue(undefined),
    animationFrame: vi.fn(),
    addListener: vi.fn(function (event: string, listener: (...args: any[]) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(listener);
    }),
    removeListener: vi.fn(function (event: string, listener: (...args: any[]) => void) {
      listeners.get(event)?.delete(listener);
    }),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((listener) => {
        listener(...args);
      });
    },
    topicSubscriptions: new Map(),
    schemaSubscriptions: new Map(),
    settings: {
      handleAction: vi.fn(),
      tree: vi.fn().mockReturnValue({}),
      errors: {
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    getDropStatus: vi.fn(),
    handleDrop: vi.fn(),
    setAnalytics: vi.fn(),
    setCustomCameraModels: vi.fn(),
    setCameraSyncError: vi.fn(),
    followFrameId: "base_link",
    ros: false,
    currentTime: undefined,
    measurementTool: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      startMeasuring: vi.fn(),
      stopMeasuring: vi.fn(),
    },
    publishClickTool: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      setPublishClickType: vi.fn(),
      publishClickType: "point",
    },
    settleVideoDecodes: vi.fn().mockResolvedValue(undefined),
  };

  return { ...defaultRenderer, ...overrides };
};

vi.mock("./Renderer", () => ({
  Renderer: vi.fn().mockImplementation(function () {
    return createMockRenderer();
  }),
}));

vi.mock("@lichtblick/suite-base/theme/ThemeProvider", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./RendererOverlay", () => ({
  RendererOverlay: () => <div data-testid="renderer-overlay">Renderer Overlay</div>,
}));

const createMockContext = (
  overrides: Partial<BuiltinPanelExtensionContext> = {},
): BuiltinPanelExtensionContext => {
  return {
    panelElement: document.createElement("div"),
    initialState: {},
    saveState: vi.fn(),
    watch: vi.fn(),
    onRender: undefined,
    subscribe: vi.fn(),
    unsubscribeAll: vi.fn(),
    updatePanelSettingsEditor: vi.fn(),
    setDefaultPanelTitle: vi.fn(),
    unstable_fetchAsset: vi.fn(),
    unstable_setMessagePathDropConfig: vi.fn(),
    unstable_subscribeMessageRange: vi.fn(),
    unstable_setAlert: vi.fn(),
    dataSourceProfile: "ros1",
    layout: {
      addPanel: vi.fn(),
    },
    setVariable: vi.fn(),
    setSharedPanelState: vi.fn(),
    advertise: vi.fn(),
    unadvertise: vi.fn(),
    publish: vi.fn(),
    subscribeAppSettings: vi.fn(),
    ...overrides,
  } as BuiltinPanelExtensionContext;
};

function buildTfMessages({
  topic = "/tf",
  count,
  startSec = 100,
  startNsec = 0,
  schemaName = "tf2_msgs/TFMessage",
  sizeInBytes = 100,
}: {
  count: number;
  topic?: string;
  startSec?: number;
  startNsec?: number;
  schemaName?: string;
  sizeInBytes?: number;
}): MessageEvent[] {
  return Array.from({ length: count }, (_, i) =>
    MessageEventBuilder.messageEvent({
      topic,
      message: { transforms: [] },
      schemaName,
      sizeInBytes,
      receiveTime: {
        sec: startSec,
        nsec: startNsec + i,
      },
    }),
  );
}

describe("ThreeDeeRender", () => {
  const mockAnalytics = { logEvent: vi.fn() };
  const mockedRenderer = vi.mocked(Renderer);

  const setup = (
    propsOverrides?: Partial<Omit<ThreeDeeRenderProps, "context">>,
    contextOrOverrides?: BuiltinPanelExtensionContext | Partial<BuiltinPanelExtensionContext>,
  ): ThreeDeeRenderProps => {
    // If contextOrOverrides has 'onRender' property (even if undefined), treat it as a full context
    const context =
      contextOrOverrides && "watch" in contextOrOverrides && "subscribe" in contextOrOverrides
        ? (contextOrOverrides as BuiltinPanelExtensionContext)
        : createMockContext(contextOrOverrides);
    return {
      context,
      interfaceMode: "3d",
      testOptions: {},
      customCameraModels: new Map(),
      ...propsOverrides,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAnalytics as Mock).mockReturnValue(mockAnalytics);

    // WebGL context
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      canvas: document.createElement("canvas"),
      drawArrays: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      viewport: vi.fn(),
    });
  });

  it("renders without crashing", () => {
    // Given
    const props = setup();

    // When
    const { container } = render(<ThreeDeeRender {...props} />);

    // Then
    expect(container).toBeInTheDocument();
  });

  it("saves direct and nested converter edits immediately and preserves them after a later save", () => {
    // GIVEN a panel with a disabled nested setting
    vi.useFakeTimers();
    const renderer = {
      ...createMockRenderer(),
      updateConfig: (handler: (draft: RendererConfig) => void) => {
        renderer.config = produce(renderer.config as RendererConfig, handler);
        renderer.emit("configChange", renderer);
      },
    };
    mockedRenderer.mockImplementationOnce(function () {
      return renderer as unknown as Renderer;
    });
    const initialConfig = { topics: { topic: { text: "", child: { enabled: false } } } };
    // The scene handler applies direct fields before the converter handles the same edit.
    renderer.settings.handleAction.mockImplementation((action: SettingsTreeAction) => {
      if (action.action === "update" && action.payload.path.length === 3) {
        renderer.updateConfig((draft) => {
          (draft.topics.topic as typeof initialConfig.topics.topic).text = action.payload
            .value as string;
        });
      }
    });
    let savedConfig: unknown = initialConfig;
    const saveConfig: SaveConfig<unknown> = (update) => {
      savedConfig = typeof update === "function" ? update(savedConfig) : update;
    };

    // AND GIVEN an adapter with a converter that handles nested settings
    const updateSettingsTree = vi.fn();
    const settingsTreeSpy = vi
      .spyOn(PanelStateContextProvider, "usePanelSettingsTreeUpdate")
      .mockReturnValue(updateSettingsTree);
    const initPanel = vi.fn<(context: BuiltinPanelExtensionContext) => void>();
    const adapterView = render(
      <MockPanelContextProvider type="3D">
        <PanelSetup
          fixture={{
            topics: [{ name: "topic", schemaName: "test.Schema" }],
            messageConverters: [
              {
                fromSchemaName: "test.Schema",
                toSchemaName: "foxglove.SceneUpdate",
                converter: () => ({}),
                panelSettings: {
                  "3D": {
                    settings: () => ({}),
                    handler: (action, config) => {
                      if (action.action === "update") {
                        const topicConfig = config as typeof initialConfig.topics.topic;
                        if (action.payload.path[2] === "text") {
                          topicConfig.text = action.payload.value as string;
                        } else {
                          topicConfig.child.enabled = action.payload.value as boolean;
                        }
                      }
                    },
                  },
                },
              },
            ],
          }}
        >
          <PanelExtensionAdapter
            config={initialConfig}
            saveConfig={saveConfig}
            initPanel={initPanel}
          />
        </PanelSetup>
      </MockPanelContextProvider>,
    );

    // AND GIVEN a 3D panel using the adapter's settings and save methods
    const context = initPanel.mock.calls.at(-1)![0];
    const props = setup(undefined, {
      initialState: context.initialState,
      saveState: context.saveState.bind(context),
      updatePanelSettingsEditor: context.updatePanelSettingsEditor.bind(context),
    });
    const view = render(<ThreeDeeRender {...props} />);

    try {
      // WHEN the nested setting is enabled
      act(() => {
        updateSettingsTree.mock.calls.at(-1)![0].actionHandler({
          action: "update",
          payload: {
            path: ["topics", "topic", "child", "enabled"],
            input: "boolean",
            value: true,
          },
        });
      });

      // THEN the edit is saved
      expect(savedConfig).toMatchObject({
        topics: { topic: { child: { enabled: true } } },
      });

      // WHEN text is typed in a direct field without waiting for the debounced save
      for (const text of ["h", "he", "hello", "hello world"]) {
        act(() => {
          updateSettingsTree.mock.calls.at(-1)![0].actionHandler({
            action: "update",
            payload: { path: ["topics", "topic", "text"], input: "string", value: text },
          });
        });

        // THEN the settings editor can read the latest text after every edit
        expect(savedConfig).toMatchObject({
          topics: { topic: { text, child: { enabled: true } } },
        });
      }

      // WHEN camera movement triggers a later save
      act(() => {
        renderer.getCameraState.mockReturnValue({ ...DEFAULT_CAMERA_STATE, distance: 10 });
        renderer.emit("cameraMove");
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // THEN both converter settings survive the later save
      expect(savedConfig).toMatchObject({
        topics: { topic: { text: "hello world", child: { enabled: true } } },
      });
    } finally {
      view.unmount();
      adapterView.unmount();
      settingsTreeSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("renders a canvas element", () => {
    // Given
    const props = setup();

    // When
    const { container } = render(<ThreeDeeRender {...props} />);

    // Then
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });

  it("renders the RendererOverlay component", () => {
    const props = setup();

    const { getByTestId } = render(<ThreeDeeRender {...props} />);
    expect(getByTestId("renderer-overlay")).toBeInTheDocument();
  });

  it("initializes with default camera state when no initial state is provided", () => {
    // Given
    const props = setup();

    // When
    const { container } = render(<ThreeDeeRender {...props} />);
    expect(container).toBeInTheDocument();

    // Then
    expect(mockedRenderer).toHaveBeenCalled();
    const rendererConfig = mockedRenderer.mock.calls[0]?.[0]?.config;
    expect(rendererConfig?.cameraState).toMatchObject(DEFAULT_CAMERA_STATE);
    expect(rendererConfig?.followMode).toBe(DEFAULT_FOLLOW_MODE);
    expect(rendererConfig?.followTf).toBeUndefined();
  });

  it("initializes with custom camera state when an initial state is provided", () => {
    // Given
    const customCameraState = {
      cameraState: {
        perspective: true,
        distance: 10,
        far: 1000,
        fovy: 50,
        near: 0.5,
        phi: 45,
        thetaOffset: 90,
        target: [0, 0, 0],
        targetOffset: [0, 0, 0],
        targetOrientation: [0, 0, 0, 1],
      },
      followMode: "follow-position" as const,
      followTf: "base_link",
    };
    const props = setup({}, { initialState: customCameraState });

    // When
    const { container } = render(<ThreeDeeRender {...props} />);

    // Then
    expect(container).toBeInTheDocument();

    expect(mockedRenderer).toHaveBeenCalled();
    const rendererConfig = mockedRenderer.mock.calls[0]?.[0]?.config;
    expect(rendererConfig?.cameraState).toEqual(customCameraState.cameraState);
    expect(rendererConfig?.followMode).toBe(customCameraState.followMode);
    expect(rendererConfig?.followTf).toBe(customCameraState.followTf);
  });

  it("retains cached topics when subscriptions change and clears them on unmount", async () => {
    // Given
    const subscribe = vi.fn();
    const context = createMockContext({ subscribe });
    const instance = createMockRenderer({
      schemaSubscriptions: new Map([["test", [{ shouldSubscribe: () => true }]]]),
    });
    vi.mocked(Renderer).mockImplementationOnce(function () {
      return instance as unknown as Renderer;
    });
    vi.mocked(Renderer).mockImplementationOnce(function () {
      return createMockRenderer({
        schemaSubscriptions: instance.schemaSubscriptions,
      }) as unknown as Renderer;
    });
    const props = setup({}, context);
    const { unmount, rerender } = render(<ThreeDeeRender {...props} />);
    const topicA = RenderStateBuilder.topic({ name: "/a", schemaName: "test" });
    const topicB = RenderStateBuilder.topic({ name: "/b", schemaName: "test" });
    act(() => {
      context.onRender!({ topics: [topicA] }, vi.fn());
    });
    await waitFor(() => {
      expect(subscribe).toHaveBeenLastCalledWith([expect.objectContaining({ topic: "/a" })]);
    });
    subscribe.mockClear();

    // When
    act(() => {
      context.onRender!({ topics: [topicA, topicB] }, vi.fn());
    });

    // Then
    await waitFor(() => {
      expect(subscribe).toHaveBeenLastCalledWith([
        expect.objectContaining({ topic: "/a" }),
        expect.objectContaining({ topic: "/b" }),
      ]);
    });
    expect(subscribe).not.toHaveBeenCalledWith([]);
    // A replacement renderer refreshes paused messages by clearing and re-subscribing.
    subscribe.mockClear();
    rerender(<ThreeDeeRender {...props} testOptions={{}} />);
    expect(subscribe).toHaveBeenCalledWith([]);
    await waitFor(() => {
      expect(subscribe).toHaveBeenLastCalledWith([
        expect.objectContaining({ topic: "/a" }),
        expect.objectContaining({ topic: "/b" }),
      ]);
    });
    unmount();
    expect(subscribe).toHaveBeenLastCalledWith([]);
  });

  it.each([undefined, "texture", "shared"])(
    "migrates old map-renderer settings (%s)",
    (rendering) => {
      // Given
      const retained = {
        layerId: "lichtblick.Map",
        instanceId: "map",
        visible: false,
        layers: [{ id: "roads", source: "ofm-liberty", visible: true, opacity: 0.6 }],
        locationTopic: "/gps",
        locationFrame: "base_link",
        enuFrame: "map",
        zOffset: 2,
      };
      const grid = { layerId: "foxglove.Grid", visible: false, size: 10 };
      const props = setup(
        {},
        {
          initialState: {
            layers: { map: { ...retained, rendering, size: 500, drawBehind: true }, grid },
          },
        },
      );
      // When
      render(<ThreeDeeRender {...props} />);
      // Then
      const layers = mockedRenderer.mock.calls[0]![0].config.layers;
      expect(layers.map).toEqual(retained);
      expect(layers.grid).toEqual(grid);
    },
  );

  it("initializes with image interface mode", () => {
    // Given
    const initialState = {
      interfaceMode: "image" as InterfaceMode,
    };
    const props = setup({ ...initialState });

    // When
    const { container } = render(<ThreeDeeRender {...props} />);

    // Then
    expect(container).toBeInTheDocument();
    expect(mockedRenderer).toHaveBeenCalled();
    const rendererCall = mockedRenderer.mock.calls[0]?.[0];
    expect(rendererCall?.interfaceMode).toBe(initialState.interfaceMode);
  });

  it("passes custom scene extensions to renderer", () => {
    const customSceneExtensions = {
      extensionsById: {
        "foxglove.SceneSettings": {
          init: (renderer: any) => renderer,
          supportedInterfaceModes: ["3d" as const],
        },
      },
    };
    const props = setup({ customSceneExtensions });

    const { container } = render(<ThreeDeeRender {...props} />);
    expect(container).toBeInTheDocument();

    expect(mockedRenderer).toHaveBeenCalled();
    const rendererCall = mockedRenderer.mock.calls[0]?.[0];
    expect(rendererCall?.sceneExtensionConfig).toMatchObject(customSceneExtensions);
  });

  it("renders with custom camera models", () => {
    const mockCameraModelBuilder = (info: any) => ({
      width: info.width,
      height: info.height,
      fx: 100,
      fy: 100,
      cx: 50,
      cy: 50,
      projectPixelTo3dPlane: vi.fn(),
      projectPixelTo3dRay: vi.fn(),
    });

    const customCameraModels = new Map([
      [
        "custom_test_model",
        { extensionId: "test-extension", modelBuilder: mockCameraModelBuilder },
      ],
    ]);

    const props = setup({ customCameraModels });

    const { container } = render(<ThreeDeeRender {...props} />);
    expect(container).toBeInTheDocument();
    expect(mockedRenderer).toHaveBeenCalled();
    const rendererCall = mockedRenderer.mock.calls[0]?.[0];
    expect(rendererCall?.customCameraModels).toBe(customCameraModels);
  });

  describe("seek render barrier", () => {
    function deferred<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }
    it("invokes done immediately for non-seek frames", async () => {
      const customRendererInstance = createMockRenderer();
      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createMockContext();
      const props = setup({}, mockContext);
      render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(mockContext.onRender).toBeDefined();
      });

      const done = vi.fn();
      act(() => {
        mockContext.onRender!(
          {
            topics: [],
            currentFrame: [],
            currentTime: { sec: 0, nsec: 1 },
          },
          done,
        );
      });

      await waitFor(() => {
        expect(done).toHaveBeenCalledTimes(1);
      });
      expect(customRendererInstance.settleVideoDecodes).not.toHaveBeenCalled();
    });

    it("defers done on seek frames until video decode settles", async () => {
      const settle = deferred<void>();
      const customRendererInstance = createMockRenderer({
        settleVideoDecodes: vi.fn().mockImplementation(async () => {
          await settle.promise;
        }),
      });
      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createMockContext();
      const props = setup({}, mockContext);
      render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(mockContext.onRender).toBeDefined();
      });

      const done = vi.fn();
      act(() => {
        mockContext.onRender!(
          {
            topics: [],
            currentFrame: [],
            currentTime: { sec: 0, nsec: 2 },
            didSeek: true,
          },
          done,
        );
      });

      await waitFor(() => {
        expect(customRendererInstance.settleVideoDecodes).toHaveBeenCalledTimes(1);
      });
      expect(done).not.toHaveBeenCalled();

      await act(async () => {
        settle.resolve();
        await settle.promise;
      });

      expect(done).toHaveBeenCalledTimes(1);
    });

    it("releases done when settleVideoDecodes rejects", async () => {
      const settle = deferred<void>();
      const customRendererInstance = createMockRenderer({
        settleVideoDecodes: vi.fn().mockImplementation(async () => {
          await settle.promise;
        }),
      });
      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createMockContext();
      const props = setup({}, mockContext);
      render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(mockContext.onRender).toBeDefined();
      });

      const done = vi.fn();
      act(() => {
        mockContext.onRender!(
          {
            topics: [],
            currentFrame: [],
            currentTime: { sec: 0, nsec: 3 },
            didSeek: true,
          },
          done,
        );
      });

      await waitFor(() => {
        expect(customRendererInstance.settleVideoDecodes).toHaveBeenCalledTimes(1);
      });
      expect(done).not.toHaveBeenCalled();

      await act(async () => {
        settle.reject(new Error("decode failed"));
        await Promise.resolve();
      });

      expect(done).toHaveBeenCalledTimes(1);
    });
  });

  describe("transfom topic preloading", () => {
    const mockUnsubscribe = vi.fn();
    const createPreloadingContext = (overrides?: {
      onSubscribe?: (args: any) => (() => void) | void;
      initialState?: any;
    }) => {
      return createMockContext({
        initialState: {
          scene: {
            transforms: {
              enablePreloading: true,
            },
          },
          topics: {
            "/tf": { visible: true },
            "/tf_static": { visible: true },
            "/new_topic": { visible: true },
          },
          ...overrides?.initialState,
        },
        unstable_subscribeMessageRange: vi.fn(function (args: any) {
          const customUnsubscribe = overrides?.onSubscribe?.(args);
          return customUnsubscribe ?? mockUnsubscribe;
        }),
      });
    };

    it("does not trigger if transform preloading is disabled", async () => {
      // Given
      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([
          [
            "tf2_msgs/TFMessage",
            [
              {
                preload: false,
              },
            ],
          ],
        ]),
      });
      const topics = [
        RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" }),
        RenderStateBuilder.topic({ name: "/other", schemaName: "std_msgs/String" }),
      ];
      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        onSubscribe: () => mockUnsubscribe,
      });

      const props = setup({}, mockContext);

      // When
      render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      act(() => {
        mockContext.onRender!(
          {
            topics,
          },
          vi.fn(),
        );
      });

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toHaveBeenCalledWith(topics);
      });

      // Then
      expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(0);
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it("triggers re-subscription when preload topics change", async () => {
      // Given
      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });

      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        onSubscribe: () => mockUnsubscribe,
      });

      const props = setup({}, mockContext);
      const topics = [
        RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" }),
        RenderStateBuilder.topic({ name: "/other", schemaName: "std_msgs/String" }),
      ];
      const { rerender } = render(<ThreeDeeRender {...props} />);
      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      act(() => {
        mockContext.onRender!({ topics }, vi.fn());
      });

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toHaveBeenCalledWith(topics);
      });

      expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(1);
      expect(mockUnsubscribe).not.toHaveBeenCalled();

      // When
      const newTopics = [
        ...topics,
        RenderStateBuilder.topic(
          RenderStateBuilder.topic({ name: "/new_topic", schemaName: "tf2_msgs/TFMessage" }),
        ),
      ];

      act(() => {
        mockContext.onRender!({ topics: newTopics }, vi.fn());
      });

      rerender(<ThreeDeeRender {...props} />);

      // Then
      // subscribeMessageRange was called 3 times:
      // 1 call for /tf, After adding /new_topic: 2 more calls (for both /tf and /new_topic)
      expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(3);
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it("does not trigger re-subscription when non-preload topics change", async () => {
      // Given
      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });

      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        onSubscribe: () => mockUnsubscribe,
      });

      const props = setup({}, mockContext);
      const topics = [
        RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" }),
        RenderStateBuilder.topic({ name: "/other", schemaName: "std_msgs/String" }),
      ];
      const { rerender } = render(<ThreeDeeRender {...props} />);
      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      // Set initial topics to trigger subscription
      act(() => {
        mockContext.onRender!({ topics }, vi.fn());
      });

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toHaveBeenCalledWith(topics);
      });

      expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(1);
      expect(mockUnsubscribe).not.toHaveBeenCalled();

      // When
      // Add a non-preload topic (this shouldn't trigger the useLayoutEffect to re-run)
      const newTopics: Topic[] = [
        ...topics,
        RenderStateBuilder.topic(
          RenderStateBuilder.topic({ name: "/new_topic", schemaName: "std_msgs/String" }),
        ),
      ];

      act(() => {
        mockContext.onRender!({ topics: newTopics }, vi.fn());
      });

      rerender(<ThreeDeeRender {...props} />);

      // Then
      // subscribeMessageRange was not called again
      expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(1);
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    describe("cleans up subscriptions", () => {
      it("on preload setting disabled", async () => {
        // Given
        const customRendererInstance = createMockRenderer({
          schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
        });

        vi.mocked(Renderer).mockImplementationOnce(function () {
          return customRendererInstance as any;
        });

        const mockContext = createPreloadingContext({
          onSubscribe: () => mockUnsubscribe,
        });

        const props = setup({}, mockContext);
        const topics = [
          RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" }),
        ];
        render(<ThreeDeeRender {...props} />);
        await waitFor(() => {
          expect(customRendererInstance.setTopics).toBeDefined();
          expect(mockContext.onRender).toBeDefined();
        });

        act(() => {
          mockContext.onRender!({ topics }, vi.fn());
        });

        await waitFor(() => {
          expect(customRendererInstance.setTopics).toHaveBeenCalledWith(topics);
        });

        expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(1);
        expect(mockUnsubscribe).not.toHaveBeenCalled();

        // When
        const newTopics = [RenderStateBuilder.topic({ schemaName: "std_msgs/String" })];

        act(() => {
          mockContext.onRender!({ topics: newTopics }, vi.fn());
        });

        // Then
        expect(mockUnsubscribe).toHaveBeenCalled();
      });

      it("on unmount", async () => {
        // Given
        const customRendererInstance = createMockRenderer({
          schemaSubscriptions: new Map([
            [
              "tf2_msgs/TFMessage",
              [
                {
                  preload: true,
                },
              ],
            ],
          ]),
        });

        vi.mocked(Renderer).mockImplementationOnce(function () {
          return customRendererInstance as any;
        });

        const mockContext = createPreloadingContext({
          onSubscribe: () => mockUnsubscribe,
        });

        const props = setup({}, mockContext);
        const topics = [
          RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" }),
        ];
        const { unmount } = render(<ThreeDeeRender {...props} />);
        await waitFor(() => {
          expect(customRendererInstance.setTopics).toBeDefined();
          expect(mockContext.onRender).toBeDefined();
        });

        // When
        act(() => {
          mockContext.onRender!(
            {
              topics,
            },
            vi.fn(),
          );
        });

        await waitFor(() => {
          expect(customRendererInstance.setTopics).toHaveBeenCalledWith(topics);
        });

        expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(1);
        expect(mockUnsubscribe).not.toHaveBeenCalled();

        // When
        unmount();

        // Then
        expect(mockUnsubscribe).toHaveBeenCalled();
      });
    });

    it("trims messages to MAX_TRANSFORM_MESSAGES and keeps oldest", async () => {
      // Given
      const topicName = "/tf";
      const totalMessages = MAX_TRANSFORM_MESSAGES + 5;
      const messages = buildTfMessages({
        topic: topicName,
        count: totalMessages,
      });

      const topics = [
        RenderStateBuilder.topic({ name: topicName, schemaName: "tf2_msgs/TFMessage" }),
      ];

      const mockBatchIterator = {
        async *[Symbol.asyncIterator]() {
          yield messages;
        },
      };

      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });

      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        onSubscribe: (args: any) => {
          void args.onNewRangeIterator?.(mockBatchIterator);
        },
      });

      const props = setup({}, mockContext);

      // When
      render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      act(() => {
        mockContext.onRender!(
          {
            topics,
            currentFrame: [],
            currentTime: { sec: 100, nsec: 0 },
          },
          vi.fn(),
        );
      });

      await waitFor(
        () => {
          expect(customRendererInstance.handleAllFramesMessages).toHaveBeenCalled();
          const handleAllFrames = customRendererInstance.handleAllFramesMessages.mock.calls;
          // Get the last call which should have the actual messages
          const lastCall = handleAllFrames[handleAllFrames.length - 1];
          const trimmedMessages = lastCall?.[0];
          expect(trimmedMessages).toBeDefined();
          expect(trimmedMessages.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      const handleAllFrames = customRendererInstance.handleAllFramesMessages.mock.calls;
      const lastCall = handleAllFrames[handleAllFrames.length - 1];
      const trimmedMessages = lastCall?.[0];

      // Then
      expect(trimmedMessages).toHaveLength(MAX_TRANSFORM_MESSAGES);

      // Verify the FIRST (oldest) messages were kept
      expect(trimmedMessages[0].receiveTime).toEqual({ sec: 100, nsec: 0 });
      expect(trimmedMessages[MAX_TRANSFORM_MESSAGES - 1].receiveTime).toEqual({
        sec: 100,
        nsec: MAX_TRANSFORM_MESSAGES - 1,
      });
    });

    it("respects custom maxPreloadMessages configuration", async () => {
      // Given
      const customMaxMessages = 10;
      const totalMessages = customMaxMessages + 5;
      const topicName = "/tf";
      const messages = buildTfMessages({
        topic: topicName,
        count: totalMessages,
      });

      const topics = [
        RenderStateBuilder.topic({ name: topicName, schemaName: "tf2_msgs/TFMessage" }),
      ];

      const mockBatchIterator = {
        async *[Symbol.asyncIterator]() {
          yield messages;
        },
      };

      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });

      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        initialState: {
          scene: {
            transforms: {
              enablePreloading: true,
              maxPreloadMessages: customMaxMessages,
            },
          },
          topics: {
            "/tf": { visible: true },
          },
        },
        onSubscribe: (args: any) => {
          void args.onNewRangeIterator?.(mockBatchIterator);
        },
      });

      const props = setup({}, mockContext);

      // When
      render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      act(() => {
        mockContext.onRender!(
          {
            topics,
            currentFrame: [],
            currentTime: { sec: 100, nsec: 0 },
          },
          vi.fn(),
        );
      });

      await waitFor(
        () => {
          expect(customRendererInstance.handleAllFramesMessages).toHaveBeenCalled();
          const handleAllFrames = customRendererInstance.handleAllFramesMessages.mock.calls;
          const lastCall = handleAllFrames[handleAllFrames.length - 1];
          const trimmedMessages = lastCall?.[0];
          expect(trimmedMessages).toBeDefined();
          expect(trimmedMessages.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      const handleAllFrames = customRendererInstance.handleAllFramesMessages.mock.calls;
      const lastCall = handleAllFrames[handleAllFrames.length - 1];
      const trimmedMessages = lastCall?.[0];

      // Then
      expect(trimmedMessages).toHaveLength(customMaxMessages);
      expect(mockContext.unstable_setAlert).toHaveBeenLastCalledWith(
        "transform-preload",
        expect.objectContaining({ severity: "warn" }),
      );
    });

    it("updates loading indicator during progressive loading", async () => {
      // Given
      const topicName = "/tf";

      const messages1 = buildTfMessages({
        topic: topicName,
        count: 5,
      });

      const messages2 = buildTfMessages({
        topic: topicName,
        count: 5,
        startNsec: 100,
      });

      const topics = [
        RenderStateBuilder.topic({ name: topicName, schemaName: "tf2_msgs/TFMessage" }),
      ];

      const mockBatchIterator = {
        async *[Symbol.asyncIterator]() {
          yield messages1;
          await new Promise((resolve) => setTimeout(resolve, 60)); // Wait for debounce
          yield messages2;
        },
      };

      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });

      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        initialState: {
          scene: {
            transforms: { enablePreloading: true },
            enableStats: true, // Enable stats to show loading indicator
          },
          topics: {
            [topicName]: { visible: true },
          },
        },
        onSubscribe: (args: any) => {
          void args.onNewRangeIterator?.(mockBatchIterator);
        },
      });

      const props = setup({}, mockContext);

      // When
      const { container } = render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      act(() => {
        mockContext.onRender!(
          {
            topics,
            currentFrame: [],
            currentTime: { sec: 100, nsec: 0 },
          },
          vi.fn(),
        );
      });

      // Then - Loading indicator should appear
      await waitFor(
        () => {
          const loadingElement = container.querySelector('[class*="loadingTransforms"]');
          expect(loadingElement).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it("clears allFrames when clearPreloadBuffer event is emitted", async () => {
      // Given
      const topicName = "/tf";
      const messages = buildTfMessages({
        topic: topicName,
        count: 100,
      });

      const topics = [
        RenderStateBuilder.topic({ name: topicName, schemaName: "tf2_msgs/TFMessage" }),
      ];

      const mockBatchIterator = {
        async *[Symbol.asyncIterator]() {
          yield messages;
        },
      };

      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });

      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        onSubscribe: (args: any) => {
          void args.onNewRangeIterator?.(mockBatchIterator);
        },
      });

      const props = setup({}, mockContext);

      // When
      render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      act(() => {
        mockContext.onRender!(
          {
            topics,
            currentFrame: [],
            currentTime: { sec: 100, nsec: 0 },
          },
          vi.fn(),
        );
      });

      // Wait for initial load
      await waitFor(
        () => {
          expect(customRendererInstance.handleAllFramesMessages).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      // Reset the mock to track new calls
      customRendererInstance.handleAllFramesMessages.mockClear();
      (mockContext.unstable_subscribeMessageRange as Mock).mockClear();

      // When - Emit clearPreloadBuffer event
      act(() => {
        customRendererInstance.emit("clearPreloadBuffer");
      });

      // Then - Should trigger reload
      await waitFor(
        () => {
          expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });

    it("finishes loading when the source has no range to preload", async () => {
      // Given: a live source, the range subscription never calls back
      const topics = [RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" })];
      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });
      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });
      const mockContext = createPreloadingContext({
        initialState: {
          scene: { enableStats: true },
          topics: { "/tf": { visible: true } },
        },
      });
      const props = setup({}, mockContext);

      // When
      const { container } = render(<ThreeDeeRender {...props} />);
      await waitFor(() => {
        expect(mockContext.onRender).toBeDefined();
      });
      act(() => {
        mockContext.onRender!(
          { topics, currentFrame: [], currentTime: { sec: 100, nsec: 0 } },
          vi.fn(),
        );
      });

      // Then
      await waitFor(() => {
        expect(mockContext.unstable_subscribeMessageRange).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(container.querySelector('[class*="loadingTransforms"]')).not.toBeInTheDocument();
      });
    });

    it("does not show loading indicator when render stats is disabled", async () => {
      // Given
      const topicName = "/tf";
      const messages = buildTfMessages({
        topic: topicName,
        count: 100,
      });

      const topics = [
        RenderStateBuilder.topic({ name: topicName, schemaName: "tf2_msgs/TFMessage" }),
      ];

      const mockBatchIterator = {
        async *[Symbol.asyncIterator]() {
          yield messages;
        },
      };

      const customRendererInstance = createMockRenderer({
        schemaSubscriptions: new Map([["tf2_msgs/TFMessage", [{ preload: true }]]]),
      });

      vi.mocked(Renderer).mockImplementationOnce(function () {
        return customRendererInstance as any;
      });

      const mockContext = createPreloadingContext({
        initialState: {
          scene: {
            transforms: {
              enablePreloading: true,
            },
            enableStats: false, // Stats disabled
          },
          topics: {
            [topicName]: { visible: true },
          },
        },
        onSubscribe: (args: any) => {
          void args.onNewRangeIterator?.(mockBatchIterator);
        },
      });

      const props = setup({}, mockContext);

      // When
      const { container } = render(<ThreeDeeRender {...props} />);

      await waitFor(() => {
        expect(customRendererInstance.setTopics).toBeDefined();
        expect(mockContext.onRender).toBeDefined();
      });

      act(() => {
        mockContext.onRender!(
          {
            topics,
            currentFrame: [],
            currentTime: { sec: 100, nsec: 0 },
          },
          vi.fn(),
        );
      });

      // Wait for preloading to complete
      await waitFor(
        () => {
          expect(customRendererInstance.handleAllFramesMessages).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      // Then - Loading indicator should NOT appear (stats disabled)
      const loadingElement = container.querySelector('[class*="loadingTransforms"]');
      expect(loadingElement).not.toBeInTheDocument();
    });
  });

  describe("transform preload alert", () => {
    const TRANSFORM_ALERT_ID = "transform-preload";

    const lastAlertFor = (mockContext: BuiltinPanelExtensionContext, alertId: string): unknown => {
      const calls = (mockContext.unstable_setAlert as Mock).mock.calls.filter(
        (call) => call[0] === alertId,
      );
      return calls.at(-1)?.[1];
    };

    it("does not nag about preloading when transform topics exist", async () => {
      // Given: preloading is on by default, nothing was dropped
      const topics = [RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" })];
      const mockContext = createMockContext();
      const props = setup({}, mockContext);

      render(<ThreeDeeRender {...props} />);
      await waitFor(() => {
        expect(mockContext.onRender).toBeDefined();
      });

      // When
      act(() => {
        mockContext.onRender!({ topics }, vi.fn());
      });

      // Then
      await waitFor(() => {
        expect(mockContext.unstable_setAlert).toHaveBeenCalledWith(TRANSFORM_ALERT_ID, undefined);
      });
      expect(lastAlertFor(mockContext, TRANSFORM_ALERT_ID)).toBeUndefined();
    });

    it("does not show the alert when no transform topic exists", async () => {
      // Given
      const topics = [RenderStateBuilder.topic({ name: "/other", schemaName: "std_msgs/String" })];
      const mockContext = createMockContext();
      const props = setup({}, mockContext);

      render(<ThreeDeeRender {...props} />);
      await waitFor(() => {
        expect(mockContext.onRender).toBeDefined();
      });

      // When
      act(() => {
        mockContext.onRender!({ topics }, vi.fn());
      });

      // Then
      await waitFor(() => {
        expect(mockContext.unstable_setAlert).toHaveBeenCalledWith(TRANSFORM_ALERT_ID, undefined);
      });
      expect(lastAlertFor(mockContext, TRANSFORM_ALERT_ID)).toBeUndefined();
    });

    it("does not throw when the host does not provide unstable_setAlert", async () => {
      // Given
      const topics = [RenderStateBuilder.topic({ name: "/tf", schemaName: "tf2_msgs/TFMessage" })];
      const mockContext = createMockContext({ unstable_setAlert: undefined });
      const props = setup({}, mockContext);

      render(<ThreeDeeRender {...props} />);
      await waitFor(() => {
        expect(mockContext.onRender).toBeDefined();
      });

      // When / Then
      expect(() => {
        act(() => {
          mockContext.onRender!({ topics }, vi.fn());
        });
      }).not.toThrow();
    });
  });
  describe("WebGL context loss", () => {
    it("shows an overlay and remounts the canvas with a new renderer", () => {
      vi.useFakeTimers();
      try {
        const { container, getByRole } = render(<ThreeDeeRender {...setup()} />);
        const canvas = container.querySelector("canvas")!;
        expect(mockedRenderer).toHaveBeenCalledTimes(1);

        act(() => {
          canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
        });
        expect(getByRole("status")).toHaveTextContent("Graphics context lost — restoring…");

        act(() => {
          canvas.dispatchEvent(new Event("webglcontextrestored"));
        });

        const newCanvas = container.querySelector("canvas");
        expect(newCanvas).not.toBe(canvas);
        expect(mockedRenderer).toHaveBeenCalledTimes(2);
        expect(mockedRenderer.mock.calls[1]![0].canvas).toBe(newCanvas);
        expect(container.querySelector('[role="status"]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
