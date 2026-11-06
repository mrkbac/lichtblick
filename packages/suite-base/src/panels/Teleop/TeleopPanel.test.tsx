/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Mock } from "vitest";

import { DEFAULT_CONFIG } from "@lichtblick/suite-base/panels/Teleop/constants";
import {
  DirectionalPadAction,
  DirectionalPadProps,
  TeleopConfig,
} from "@lichtblick/suite-base/panels/Teleop/types";

import TeleopPanel from "./TeleopPanel";

function MockDirectionalPad({ onAction }: DirectionalPadProps): React.JSX.Element {
  return (
    <div data-testid="directional-pad">
      <button onClick={() => onAction?.(DirectionalPadAction.UP)}>UP</button>
      <button onClick={() => onAction?.(DirectionalPadAction.LEFT)}>LEFT</button>
      <button onClick={() => onAction?.()}>RELEASE</button>
    </div>
  );
}

vi.mock("./DirectionalPad", () => ({ __esModule: true, default: MockDirectionalPad }));

vi.mock("@lichtblick/suite-base/theme/ThemeProvider", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@lichtblick/suite-base/components/EmptyState", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));

vi.mock("@lichtblick/suite-base/components/Stack", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const ZERO = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };

function twist(linearX: number, angularZ = 0) {
  return { linear: { x: linearX, y: 0, z: 0 }, angular: { x: 0, y: 0, z: angularZ } };
}

// the mocked d-pad and speed 1 keep published values equal to the configured max
function getMockContext(overrides: Record<string, unknown> = {}) {
  const { initialState, ...rest } = overrides;
  return {
    saveState: vi.fn(),
    setDefaultPanelTitle: vi.fn(),
    watch: vi.fn(),
    updatePanelSettingsEditor: vi.fn(),
    advertise: vi.fn(),
    unadvertise: vi.fn(),
    publish: vi.fn(),
    onRender: undefined,
    ...rest,
    initialState: {
      topic: "/cmd",
      mode: "dpad",
      speedScale: 1,
      publishRate: 10,
      ...(initialState as Partial<TeleopConfig>),
    },
  } as unknown as Parameters<typeof TeleopPanel>[0]["context"] & {
    publish: Mock;
    advertise: Mock;
    unadvertise: Mock;
    saveState: Mock;
    updatePanelSettingsEditor: Mock;
  };
}

function setup(initialState: Partial<TeleopConfig> = {}, overrides: Record<string, unknown> = {}) {
  const context = getMockContext({ ...overrides, initialState });
  const result = render(<TeleopPanel context={context} />);
  const root = result.container.querySelector<HTMLElement>("[tabindex]")!;
  return { ...result, context, publish: context.publish, root };
}

/** What the layout storage gives back: JSON drops undefined fields */
function layoutRoundTrip(config: TeleopConfig): unknown {
  return JSON.parse(JSON.stringify(config) ?? "{}");
}

function lastSavedConfig(context: { saveState: Mock }): TeleopConfig {
  return context.saveState.mock.calls.at(-1)![0] as TeleopConfig;
}

describe("TeleopPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("setup", () => {
    it("asks for a data source that supports publishing", () => {
      setup({}, { publish: undefined });
      expect(screen.getByTestId("empty-state")).toHaveTextContent(
        "Connect to a data source that supports publishing",
      );
    });

    it("asks for a topic once the topic is cleared", () => {
      setup({ topic: "" });
      expect(screen.getByTestId("empty-state")).toHaveTextContent("Select a publish topic");
    });

    it("works out of the box on /cmd_vel", () => {
      const context = getMockContext();
      // a brand-new panel has no saved topic
      (context.initialState as Partial<TeleopConfig>).topic = undefined;
      render(<TeleopPanel context={context} />);
      expect(context.advertise).toHaveBeenCalledWith(
        "/cmd_vel",
        "geometry_msgs/Twist",
        expect.objectContaining({ datatypes: expect.any(Map) }),
      );
    });

    it("unadvertises the old topic when the topic changes (but not on the first render)", () => {
      const advertise = vi.fn();
      const unadvertise = vi.fn();
      const make = () => getMockContext({ advertise, unadvertise });
      const { rerender } = render(<TeleopPanel context={make()} />);
      rerender(<TeleopPanel context={make()} />);
      expect(unadvertise).not.toHaveBeenCalled();
      rerender(<TeleopPanel context={make()} />);
      expect(unadvertise).toHaveBeenCalledWith("/cmd");
    });

    it("advertises ROS 2 schema names with ROS 2 definitions", () => {
      const { context } = setup({ messageType: "TwistStamped" }, { dataSourceProfile: "ros2" });
      const [, schemaName, options] = context.advertise.mock.calls[0]!;
      expect(schemaName).toBe("geometry_msgs/msg/TwistStamped");
      // ROS 2 headers have no seq field
      expect(
        options.datatypes.get("std_msgs/Header").definitions.map((d: { name: string }) => d.name),
      ).toEqual(["stamp", "frame_id"]);
    });
  });

  describe("publishing", () => {
    it("publishes on press, repeats while held and stops on release", () => {
      const { publish } = setup();
      fireEvent.click(screen.getByText("UP"));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));

      publish.mockClear();
      vi.advanceTimersByTime(1000);
      expect(publish).toHaveBeenCalledTimes(10);

      fireEvent.click(screen.getByText("RELEASE"));
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);
      publish.mockClear();
      vi.advanceTimersByTime(1000);
      expect(publish).not.toHaveBeenCalled();
    });

    it("skips the zero command on release when stopOnRelease is off", () => {
      const { publish } = setup({ stopOnRelease: false });
      fireEvent.click(screen.getByText("UP"));
      publish.mockClear();
      fireEvent.click(screen.getByText("RELEASE"));
      expect(publish).not.toHaveBeenCalled();
    });

    it("publishes nothing when the publish rate is zero", () => {
      const { publish } = setup({ publishRate: 0 });
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
      expect(publish).not.toHaveBeenCalled();
    });

    it("logs publish errors without crashing", () => {
      const error = new Error("Topic not advertised");
      const { publish } = setup();
      publish.mockImplementation(() => {
        throw error;
      });
      fireEvent.click(screen.getByText("UP"));
      vi.advanceTimersByTime(200);
      expect(console.error).toHaveBeenCalledWith("Failed to publish message:", error);
      expect(screen.getByTestId("directional-pad")).toBeInTheDocument();
      (console.error as Mock).mockClear();
      // let the stop on unmount succeed
      publish.mockReset();
    });

    it("publishes TwistStamped with a header", () => {
      const { publish } = setup({ messageType: "TwistStamped", frameId: "base_link" });
      fireEvent.click(screen.getByText("UP"));
      expect(publish).toHaveBeenCalledWith("/cmd", {
        header: {
          stamp: { sec: expect.any(Number), nsec: expect.any(Number) },
          frame_id: "base_link",
        },
        twist: twist(1),
      });
    });

    it("publishes Joy in the ROS 2 joy layout with on-screen buttons", () => {
      Element.prototype.setPointerCapture = vi.fn();
      const { publish, context } = setup(
        { messageType: "Joy", topic: "/joy", joyEnableButton: "lb" },
        { dataSourceProfile: "ros2" },
      );
      expect(context.advertise.mock.calls[0]![1]).toBe("sensor_msgs/msg/Joy");

      // driving holds the configured enable button (index 9 = LB)
      fireEvent.click(screen.getByText("UP"));
      const joy = publish.mock.calls.at(-1)![1];
      expect(joy.axes).toEqual([0, 1, 0, 0, 0, 0]);
      expect(joy.buttons[9]).toBe(1);
      fireEvent.click(screen.getByText("RELEASE"));

      // the on-screen A button is Joy button 0
      fireEvent.pointerDown(screen.getByRole("button", { name: "A" }));
      expect(publish.mock.calls.at(-1)![1].buttons[0]).toBe(1);
      fireEvent.pointerUp(screen.getByRole("button", { name: "A" }));
      expect(publish.mock.calls.at(-1)![1]).toMatchObject({
        axes: [0, 0, 0, 0, 0, 0],
        buttons: Array(21).fill(0),
      });
    });
  });

  describe("keyboard", () => {
    it("drives with combined keys and stops when they are released", () => {
      const { publish, root } = setup();
      fireEvent.keyDown(root, { key: "w" });
      fireEvent.keyDown(root, { key: "ArrowLeft" });
      vi.advanceTimersByTime(100);
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1, 1.5));
      fireEvent.keyUp(root, { key: "w" });
      fireEvent.keyUp(root, { key: "ArrowLeft" });
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);
    });

    it("turns the right stick with Q/E", () => {
      const { publish, root } = setup({
        mapping: { ...DEFAULT_CONFIG.mapping, "angular-z": { input: "rightX", max: 2 } },
      });
      fireEvent.keyDown(root, { key: "q" });
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(0, 2));
    });

    it("drives at full speed while Shift is held and adjusts speed with +/-", () => {
      const { publish, root, context } = setup({ speedScale: 0.5 });
      fireEvent.keyDown(root, { key: "w" });
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(0.5));
      fireEvent.keyDown(root, { key: "Shift" });
      vi.advanceTimersByTime(100);
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));
      fireEvent.keyUp(root, { key: "Shift" });
      fireEvent.keyDown(root, { key: "+" });
      vi.advanceTimersByTime(100);
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(0.6));
      expect(lastSavedConfig(context).speedScale).toBe(0.6);
    });

    it("ignores drive keys with modifiers and when the keyboard is disabled", () => {
      const { publish, root } = setup();
      fireEvent.keyDown(root, { key: "w", metaKey: true });
      expect(publish).not.toHaveBeenCalled();

      const other = setup({ keyboard: false });
      fireEvent.keyDown(other.root, { key: "w" });
      expect(other.publish).not.toHaveBeenCalled();
    });
  });

  describe("safety", () => {
    it("stops on Space and stays stopped until every control is released", () => {
      const { publish, root } = setup();
      fireEvent.keyDown(root, { key: "w" });
      publish.mockClear();
      fireEvent.keyDown(root, { key: " " });
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);
      expect(screen.getByText(/release all controls/)).toBeInTheDocument();

      // still holding W does not drive
      publish.mockClear();
      fireEvent.keyDown(root, { key: "w" });
      vi.advanceTimersByTime(1000);
      expect(publish).not.toHaveBeenCalled();

      // after releasing everything, W drives again
      fireEvent.keyUp(root, { key: "w" });
      fireEvent.keyDown(root, { key: "w" });
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));
    });

    it("stops from the on-screen Stop button", () => {
      const { publish, root } = setup();
      fireEvent.keyDown(root, { key: "w" });
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);
    });

    it("stops when the window loses focus", () => {
      const { publish, root } = setup();
      fireEvent.keyDown(root, { key: "w" });
      publish.mockClear();
      fireEvent.blur(window);
      expect(publish).toHaveBeenCalledWith("/cmd", ZERO);
    });

    it("stops on focus loss even when stopOnRelease is off", () => {
      const { publish, root } = setup({ stopOnRelease: false });
      fireEvent.keyDown(root, { key: "w" });
      publish.mockClear();
      fireEvent.blur(window);
      expect(publish).toHaveBeenCalledWith("/cmd", ZERO);
    });

    it("stops the robot when unmounted while driving, even if stopOnRelease is off", () => {
      const { publish, unmount } = setup({ stopOnRelease: false });
      fireEvent.click(screen.getByText("UP"));
      fireEvent.click(screen.getByText("RELEASE"));
      publish.mockClear();
      unmount();
      expect(publish).toHaveBeenCalledWith("/cmd", ZERO);
    });

    it("does not resume driving from a held joystick after a stop", () => {
      Element.prototype.setPointerCapture = vi.fn();
      const { publish, root } = setup({ mode: "joystick" });
      const joystick = () => {
        const element = screen.getByTestId("teleop-joystick");
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
          left: 0,
          top: 0,
          width: 256,
          height: 256,
        } as DOMRect);
        return element;
      };
      // jsdom's PointerEvent drops clientX/clientY
      const pointer = (type: string) =>
        new MouseEvent(type, { bubbles: true, clientX: 128, clientY: 0 });

      fireEvent(joystick(), pointer("pointerdown"));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));

      fireEvent.keyDown(root, { key: " " });
      publish.mockClear();
      fireEvent(joystick(), pointer("pointermove"));
      vi.advanceTimersByTime(1000);
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe("gamepad", () => {
    let frames: FrameRequestCallback[] = [];
    let gamepads: Gamepad[] = [];

    function makeGamepad(
      axes: number[],
      pressed: number[] = [],
      id = "Test pad (STANDARD GAMEPAD)",
    ) {
      return {
        id,
        connected: true,
        // constant on purpose: some browsers never advance it, so input must not depend on it
        timestamp: 0,
        mapping: "standard",
        axes,
        buttons: Array.from({ length: 17 }, (_unused, index) => ({
          pressed: pressed.includes(index),
          touched: pressed.includes(index),
          value: pressed.includes(index) ? 1 : 0,
        })),
      } as unknown as Gamepad;
    }

    function step(...pads: Gamepad[]) {
      const change =
        pads.length > gamepads.length
          ? "gamepadconnected"
          : pads.length < gamepads.length
            ? "gamepaddisconnected"
            : undefined;
      gamepads = pads;
      if (change) {
        // like the browser: polling idles without a gamepad until one connects
        act(() => {
          window.dispatchEvent(new Event(change));
        });
      }
      const pending = frames;
      frames = [];
      act(() => {
        pending.forEach((frame) => {
          frame(0);
        });
      });
    }

    beforeEach(() => {
      frames = [];
      gamepads = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", () => {});
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => gamepads,
      });
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
    });

    it("prompts for a button press and then shows the connected gamepad", () => {
      setup();
      step();
      expect(screen.getByText("Press a gamepad button to connect it")).toBeInTheDocument();
      step(makeGamepad([0, 0, 0, 0]));
      expect(screen.getByText("Gamepad: Test pad")).toBeInTheDocument();
    });

    it("drives with the left stick", () => {
      const { publish } = setup();
      step(makeGamepad([0, -1, 0, 0]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));
      step(makeGamepad([0, 0, 0, 0]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);
    });

    it("stops a held stick when the tab is hidden, while polling is paused", () => {
      const { publish } = setup();
      step(makeGamepad([0, -1, 0, 0]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));

      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      fireEvent(document, new Event("visibilitychange"));
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);

      // no frames run while hidden, so the timer must not resend the old stick state
      publish.mockClear();
      vi.advanceTimersByTime(1000);
      expect(publish).not.toHaveBeenCalled();
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
    });

    it("keeps a Stop engaged across a hidden tab while the stick is still held", () => {
      const { publish } = setup();
      step(makeGamepad([0, -1, 0, 0]));
      // B = stop while the stick is held
      step(makeGamepad([0, -1, 0, 0], [1]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);

      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      fireEvent(document, new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { configurable: true, value: false });

      // back in the tab with the stick still forward: must not drive
      publish.mockClear();
      step(makeGamepad([0, -1, 0, 0]));
      vi.advanceTimersByTime(500);
      expect(publish).not.toHaveBeenCalled();
      expect(screen.getByText(/release all controls/)).toBeInTheDocument();

      // released, then pushed again: drives
      step(makeGamepad([0, 0, 0, 0]));
      step(makeGamepad([0, -1, 0, 0]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));
    });

    it("only drives while the enable button is held", () => {
      const { publish } = setup({ enableButton: "lb" });
      step(makeGamepad([0, -1, 0, 0]));
      expect(publish).not.toHaveBeenCalled();
      expect(screen.getByText("Hold LB / L1 to drive")).toBeInTheDocument();
      step(makeGamepad([0, -1, 0, 0], [4]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));
    });

    it("stops with the stop button, boosts with turbo and changes speed with the d-pad", () => {
      const { publish, context } = setup({ speedScale: 0.5 });
      step(makeGamepad([0, -1, 0, 0]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(0.5));

      // RB = turbo
      step(makeGamepad([0, -1, 0, 0], [5]));
      vi.advanceTimersByTime(100);
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));

      // B = stop, latched while the stick is still held
      step(makeGamepad([0, -1, 0, 0], [1]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);
      publish.mockClear();
      step(makeGamepad([0, -1, 0, 0]));
      vi.advanceTimersByTime(500);
      expect(publish).not.toHaveBeenCalled();

      // d-pad up = speed up
      step(makeGamepad([0, 0, 0, 0]));
      step(makeGamepad([0, 0, 0, 0], [12]));
      expect(lastSavedConfig(context).speedScale).toBe(0.6);
    });

    it("reads only the selected gamepad", () => {
      const { publish } = setup({ gamepadId: "Second" });
      step(makeGamepad([0, -1, 0, 0], [], "First"));
      expect(publish).not.toHaveBeenCalled();
      step(makeGamepad([0, -1, 0, 0], [], "First"), makeGamepad([0, -1, 0, 0], [], "Second"));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));
    });

    it("stops polling without a gamepad and stops the robot when it disconnects", () => {
      const { publish } = setup();
      step();
      expect(frames).toHaveLength(0);
      step(makeGamepad([0, -1, 0, 0]));
      expect(publish).toHaveBeenLastCalledWith("/cmd", twist(1));
      expect(frames).toHaveLength(1);
      step();
      expect(publish).toHaveBeenLastCalledWith("/cmd", ZERO);
      expect(frames).toHaveLength(0);
      expect(screen.getByText("Press a gamepad button to connect it")).toBeInTheDocument();
    });
  });

  describe("persistence", () => {
    it("restores every setting after the panel is closed and reopened", () => {
      // Given a panel whose settings and speed were changed
      const first = setup({ speedScale: 0.5 });
      const handler = first.context.updatePanelSettingsEditor.mock.calls.at(-1)![0].actionHandler;
      act(() => {
        handler({
          action: "update",
          payload: { path: ["controls", "mode"], input: "select", value: "dual" },
        });
        handler({
          action: "update",
          payload: { path: ["mapping", "linear-y"], input: "select", value: "rightX" },
        });
      });
      fireEvent.keyDown(first.root, { key: "+" });
      const saved = lastSavedConfig(first.context);
      first.unmount();

      // When it is mounted again from the saved layout state (e.g. after switching tabs)
      const context = getMockContext();
      (context as { initialState: unknown }).initialState = layoutRoundTrip(saved);
      render(<TeleopPanel context={context} />);

      // Then nothing was lost
      expect(lastSavedConfig(context)).toEqual(saved);
      expect(saved).toMatchObject({ mode: "dual", speedScale: 0.6 });
      expect(saved.mapping["linear-y"].input).toBe("rightX");
      expect(screen.getAllByTestId("teleop-joystick")).toHaveLength(2);
      expect(screen.getByText("Speed 60%")).toBeInTheDocument();
    });

    it("keeps a cleared topic cleared after a reload", () => {
      const first = setup();
      const handler = first.context.updatePanelSettingsEditor.mock.calls.at(-1)![0].actionHandler;
      act(() => {
        handler({
          action: "update",
          payload: { path: ["general", "topic"], input: "autocomplete", value: undefined },
        });
      });
      const saved = layoutRoundTrip(lastSavedConfig(first.context));
      first.unmount();

      const context = getMockContext();
      (context as { initialState: unknown }).initialState = saved;
      render(<TeleopPanel context={context} />);
      expect(screen.getByTestId("empty-state")).toHaveTextContent("Select a publish topic");
    });
  });
});
