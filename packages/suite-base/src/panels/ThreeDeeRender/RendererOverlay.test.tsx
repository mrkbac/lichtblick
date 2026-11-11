/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";

import { act, fireEvent, render, waitFor } from "@testing-library/react";

import { PanelContextMenuItem } from "@lichtblick/suite-base/components/PanelContextMenu";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { RendererOverlay } from "./RendererOverlay";

let mockLastHoverTooltipProps: any = undefined;

vi.mock("./Interactions/HoverTooltip", () => {
  return {
    __esModule: true,
    HoverTooltip: (props: any) => {
      mockLastHoverTooltipProps = props;
      return undefined;
    },
  };
});

vi.mock("./Interactions", () => {
  return {
    __esModule: true,
    InteractionContextMenu: () => undefined,
    Interactions: () => undefined,
  };
});

vi.mock("@lichtblick/suite-base/hooks/usePanelMousePresence", () => {
  return {
    __esModule: true,
    usePanelMousePresence: () => true,
  };
});

vi.mock("react-use", () => {
  return {
    __esModule: true,
    useLongPress: () => ({}),
  };
});

vi.mock("@lichtblick/suite-base/panels/ThreeDeeRender/HUD", () => {
  return {
    __esModule: true,
    HUD: () => undefined,
  };
});

const mockFramePicking = { current: false };
// Covered by FrameMeasureOverlay.test.tsx; needs a renderer with layout variables and a TF tree
vi.mock("./FrameMeasureOverlay", () => {
  return {
    __esModule: true,
    FrameMeasureOverlay: (props: { picking: boolean }) => {
      mockFramePicking.current = props.picking;
      return undefined;
    },
  };
});

vi.mock("./MeasurePanel", () => {
  return {
    __esModule: true,
    MeasurePanel: () => undefined,
  };
});

vi.mock("./Stats", () => {
  return {
    __esModule: true,
    Stats: () => undefined,
  };
});

const mockRendererEventCallbacks = new Map<string, (...args: any[]) => void>();
const mockRenderer = {
  setPickingEnabled: vi.fn(),
  zoomToData: vi.fn(),
  setSelectedRenderable: vi.fn(),
  canResetView: vi.fn(() => false),
  getContextMenuItems: vi.fn((): PanelContextMenuItem[] => []),
  fixedFrameId: undefined,
};

vi.mock("./RendererContext", () => {
  return {
    __esModule: true,
    useRenderer: () => mockRenderer,
    useRendererEvent: (eventName: string, cb: (...args: any[]) => void) => {
      mockRendererEventCallbacks.set(eventName, cb);
    },
  };
});

describe("<RendererOverlay /> hover wiring", () => {
  beforeEach(() => {
    mockRendererEventCallbacks.clear();
    mockLastHoverTooltipProps = undefined;
    vi.clearAllMocks();
  });

  function renderOverlay(canvas: HTMLCanvasElement | null) {
    return render(
      <ThemeProvider isDark={false}>
        <RendererOverlay
          addPanel={vi.fn() as any}
          canPublish={false}
          canvas={canvas}
          enableStats={false}
          interfaceMode="3d"
          measureActive={false}
          onChangePublishClickType={vi.fn()}
          onClickMeasure={vi.fn()}
          onClickPublish={vi.fn()}
          onShowTopicSettings={vi.fn()}
          onTogglePerspective={vi.fn()}
          perspective={false}
          publishActive={false}
          publishClickType="point"
          timezone={undefined}
        />
      </ThemeProvider>,
    );
  }

  it("zooms to data from the 3D toolbar", () => {
    renderOverlay(document.createElement("canvas"));
    fireEvent.click(document.querySelector('[aria-label="Zoom to data"]')!);
    expect(mockRenderer.zoomToData).toHaveBeenCalledOnce();
  });

  it("maps hovered selections into HoverTooltip entities and absolute client position", async () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 200,
      right: 500,
      bottom: 600,
      width: 400,
      height: 400,
      x: 100,
      y: 200,
      toJSON: () => "",
    }));

    renderOverlay(canvas);

    const cb = mockRendererEventCallbacks.get("renderableHovered");
    expect(cb).toBeDefined();
    const hoverMovedCb = mockRendererEventCallbacks.get("hoverMoved");
    expect(hoverMovedCb).toBeDefined();

    const details = {
      metadata: [
        { key: "m1", value: "mv1" },
        { key: 123, value: true },
      ],
      id: 42,
      frame_id: "map",
      enabled: false,
      nested: { a: 1 },
    };

    const renderable = {
      topic: "/my_topic",
      name: "my_entity on /my_topic",
      userData: { entityId: "my_entity" },
      details: vi.fn(() => details),
      instanceDetails: vi.fn(),
    };

    act(() => {
      hoverMovedCb?.({ x: 10, y: 20 } as any);
      cb?.(
        [
          {
            renderable,
            instanceIndex: undefined,
          },
        ] as any,
        { x: 10, y: 20 } as any,
      );
    });

    await waitFor(() => {
      expect(mockLastHoverTooltipProps).toBeDefined();
      expect(mockLastHoverTooltipProps.position).toEqual({ clientX: 110, clientY: 220 });
      expect(mockLastHoverTooltipProps.entities).toHaveLength(1);
    });

    const entity = mockLastHoverTooltipProps.entities[0];
    expect(entity.topic).toBe("/my_topic");
    expect(entity.entityId).toBe("my_entity");

    // metadata[] is included and coerced to strings
    expect(entity.metadata).toEqual(
      expect.arrayContaining([
        { key: "m1", value: "mv1" },
        { key: "123", value: "true" },
      ]),
    );

    // primitive top-level fields are included
    expect(entity.metadata).toEqual(
      expect.arrayContaining([
        { key: "id", value: "42" },
        { key: "frame_id", value: "map" },
        { key: "enabled", value: "false" },
      ]),
    );

    // nested objects are excluded
    expect(entity.metadata).not.toEqual(
      expect.arrayContaining([{ key: "nested", value: "[object Object]" }]),
    );
  });

  it("uses instanceDetails when instanceIndex is provided", async () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => "",
    }));

    renderOverlay(canvas);

    const cb = mockRendererEventCallbacks.get("renderableHovered");
    expect(cb).toBeDefined();

    const renderable = {
      topic: "/t",
      name: "n",
      userData: { entityId: "n" },
      details: vi.fn(() => ({ metadata: [{ key: "wrong", value: "wrong" }] })),
      instanceDetails: vi.fn(() => ({ metadata: [{ key: "ok", value: "yes" }], id: 9 })),
    };

    act(() => {
      cb?.(
        [
          {
            renderable,
            instanceIndex: 3,
          },
        ] as any,
        { x: 1, y: 2 } as any,
      );
    });

    await waitFor(() => {
      expect(mockLastHoverTooltipProps.entities).toHaveLength(1);
    });

    expect(renderable.instanceDetails).toHaveBeenCalledWith(3);
    expect(renderable.details).not.toHaveBeenCalled();

    const entity = mockLastHoverTooltipProps.entities[0];
    expect(entity.metadata).toEqual(expect.arrayContaining([{ key: "ok", value: "yes" }]));
    expect(entity.metadata).toEqual(expect.arrayContaining([{ key: "id", value: "9" }]));
  });

  it("clears hovered entities when selections are empty", async () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => "",
    }));

    renderOverlay(canvas);

    const cb = mockRendererEventCallbacks.get("renderableHovered");
    expect(cb).toBeDefined();

    act(() => {
      cb?.([] as any, { x: 0, y: 0 } as any);
    });

    await waitFor(() => {
      expect(mockLastHoverTooltipProps.entities).toEqual([]);
    });
  });

  it("does not create tooltip entries for selections with no topic and no metadata", async () => {
    const canvas = document.createElement("canvas");
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => "",
    }));

    renderOverlay(canvas);

    const cb = mockRendererEventCallbacks.get("renderableHovered");
    expect(cb).toBeDefined();

    const renderable = {
      topic: undefined,
      name: "af949d5a-8243-4e53-8b39-dfb05aac50ba",
      userData: {},
      details: vi.fn(() => undefined),
      instanceDetails: vi.fn(() => undefined),
    };

    act(() => {
      cb?.(
        [
          {
            renderable,
            instanceIndex: undefined,
          },
        ] as any,
        { x: 10, y: 20 } as any,
      );
    });

    await waitFor(() => {
      expect(mockLastHoverTooltipProps).toBeDefined();
      expect(mockLastHoverTooltipProps.entities).toEqual([]);
    });
  });
});

describe("<RendererOverlay /> download image button", () => {
  function renderOverlay(interfaceMode: "3d" | "image") {
    return render(
      <ThemeProvider isDark={false}>
        <RendererOverlay
          addPanel={vi.fn() as any}
          canPublish={false}
          canvas={null}
          enableStats={false}
          interfaceMode={interfaceMode}
          measureActive={false}
          onChangePublishClickType={vi.fn()}
          onClickMeasure={vi.fn()}
          onClickPublish={vi.fn()}
          onShowTopicSettings={vi.fn()}
          onTogglePerspective={vi.fn()}
          perspective={false}
          publishActive={false}
          publishClickType="point"
          timezone={undefined}
        />
      </ThemeProvider>,
    );
  }

  it("triggers the Download image context menu action in image mode", () => {
    const onclick = vi.fn();
    mockRenderer.getContextMenuItems.mockReturnValue([
      { type: "item", label: "Download image", onclick },
    ]);

    const { getByTestId } = renderOverlay("image");
    fireEvent.click(getByTestId("download-image-button"));

    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the action is disabled", () => {
    const onclick = vi.fn();
    mockRenderer.getContextMenuItems.mockReturnValue([
      { type: "item", label: "Download image", onclick, disabled: true },
    ]);

    const { getByTestId } = renderOverlay("image");
    fireEvent.click(getByTestId("download-image-button"));

    expect(onclick).not.toHaveBeenCalled();
  });

  it("is not shown in 3d mode", () => {
    const { queryByTestId } = renderOverlay("3d");
    expect(queryByTestId("download-image-button")).toBeNull();
  });
});

describe("<RendererOverlay /> frame picking", () => {
  function renderOverlay(props: { measureActive: boolean; publishActive: boolean }) {
    const onClickMeasure = vi.fn();
    const onClickPublish = vi.fn();
    const element = (active: typeof props) => (
      <ThemeProvider isDark={false}>
        <RendererOverlay
          addPanel={vi.fn() as any}
          canPublish
          canvas={null}
          enableStats={false}
          interfaceMode="3d"
          measureActive={active.measureActive}
          onChangePublishClickType={vi.fn()}
          onClickMeasure={onClickMeasure}
          onClickPublish={onClickPublish}
          onShowTopicSettings={vi.fn()}
          onTogglePerspective={vi.fn()}
          perspective={false}
          publishActive={active.publishActive}
          publishClickType="point"
          timezone={undefined}
        />
      </ThemeProvider>
    );
    const result = render(element(props));
    return { ...result, element, onClickMeasure, onClickPublish };
  }

  it.each([
    { measureActive: true, publishActive: false },
    { measureActive: false, publishActive: true },
  ])("stops the other click tool when frame picking starts (%o)", (active) => {
    const { getByTestId, rerender, element, onClickMeasure, onClickPublish } =
      renderOverlay(active);
    fireEvent.click(getByTestId("measure-frames-button"));
    expect(onClickMeasure).toHaveBeenCalledTimes(active.measureActive ? 1 : 0);
    expect(onClickPublish).toHaveBeenCalledTimes(active.publishActive ? 1 : 0);
    // The panel then reports the stopped tool as inactive; frame picking stays on
    rerender(element({ measureActive: false, publishActive: false }));
    expect(mockFramePicking.current).toBe(true);
  });

  it("stops frame picking when publishing starts", () => {
    const { getByTestId, rerender, element } = renderOverlay({
      measureActive: false,
      publishActive: false,
    });
    fireEvent.click(getByTestId("measure-frames-button"));
    expect(mockFramePicking.current).toBe(true);
    rerender(element({ measureActive: false, publishActive: true }));
    expect(mockFramePicking.current).toBe(false);
  });
});
