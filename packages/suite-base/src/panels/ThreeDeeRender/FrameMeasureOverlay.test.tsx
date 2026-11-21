/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import EventEmitter from "eventemitter3";
import * as THREE from "three";

import { ObjectPool } from "@lichtblick/den/collection";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { FrameMeasureOverlay } from "./FrameMeasureOverlay";
import type { Renderer } from "./Renderer";
import { Transform, TransformTree } from "./transforms";
import { FRAME_MEASUREMENT_VARIABLE, FrameMeasurement } from "./transforms/frameMeasurement";

/**
 * A renderer whose layout variables round-trip like the panel's: "setVariable" writes the shared
 * variable and every panel (here: this one) gets "variablesChange".
 */
function setup(initial: FrameMeasurement | undefined, { picking = false } = {}) {
  const transformTree = new TransformTree(new ObjectPool(Transform.Empty));
  transformTree.addTransform("base", "map", 0n, new Transform([1, 0, 0], [0, 0, 0, 1]));
  transformTree.addTransform("lidar", "base", 0n, new Transform([3, 4, 0], [0, 0, 0, 1]));
  transformTree.addTransform("imu", "rig", 0n, Transform.Identity());

  const variables = new Map<string, unknown>();
  if (initial) {
    variables.set(FRAME_MEASUREMENT_VARIABLE, initial);
  }
  const frameUnderCursor = { id: undefined as string | undefined };
  const pickObject = vi.fn(
    async (_cursor: THREE.Vector2): Promise<THREE.Object3D | undefined> => new THREE.Object3D(),
  );
  const frameAxes = {
    frameIdOf: vi.fn(() => frameUnderCursor.id),
    setLabelHighlights: vi.fn(),
  };
  const emitter = new EventEmitter();
  const renderer = Object.assign(emitter, {
    transformTree,
    variables,
    fixedFrameId: "map",
    currentTime: 0n,
    framePicking: false,
    input: new EventEmitter(),
    pickObject,
    sceneExtensions: new Map([["foxglove.FrameAxes", frameAxes]]),
  }) as unknown as Renderer;
  const written: unknown[] = [];
  emitter.on("setVariable", (name: string, value: unknown) => {
    written.push(value);
    variables.set(name, value);
    emitter.emit("variablesChange", variables, renderer);
  });
  const onStopPicking = vi.fn();
  const result = render(
    <ThemeProvider isDark>
      <FrameMeasureOverlay renderer={renderer} picking={picking} onStopPicking={onStopPicking} />
    </ThemeProvider>,
  );
  // Picks resolve asynchronously
  const click = async (frame: string | undefined) => {
    frameUnderCursor.id = frame;
    await act(async () => {
      renderer.input.emit(
        "click",
        new THREE.Vector2(),
        new THREE.Vector3(),
        new MouseEvent("click"),
      );
    });
  };
  return {
    renderer,
    emitter,
    variables,
    written,
    frameAxes,
    pickObject,
    onStopPicking,
    click,
    result,
  };
}

describe("FrameMeasureOverlay", () => {
  it("renders nothing without a pair and while not picking", () => {
    setup(undefined);
    expect(screen.queryByTestId("frame-measure")).toBeNull();
  });

  it("shows the pair another panel set, with To expressed in From", () => {
    setup({ from: "base", to: "lidar" });
    expect(screen.getByTestId("frame-measure-values")).toHaveTextContent("5.000 m");
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("base");
    expect(screen.getByRole("combobox", { name: "To" })).toHaveValue("lidar");
  });

  it("follows a change of the shared pair and highlights both labels", () => {
    const { emitter, variables, renderer, frameAxes } = setup({ from: "base", to: "lidar" });
    variables.set(FRAME_MEASUREMENT_VARIABLE, { from: "lidar", to: "map" });
    act(() => {
      emitter.emit("variablesChange", variables, renderer);
    });
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("lidar");
    // lidar is at (4, 4, 0) in map
    expect(screen.getAllByText("-4.000")).toHaveLength(2);
    expect(screen.getByTestId("frame-measure-values")).toHaveTextContent("5.657 m");
    const highlights = frameAxes.setLabelHighlights.mock.lastCall![0] as Map<string, string>;
    expect([...highlights.keys()].sort()).toEqual(["lidar", "map"]);
  });

  it("picks From, then To from clicks on frames, writes the shared pair and stops picking", async () => {
    const { written, click, onStopPicking, renderer } = setup(undefined, { picking: true });
    expect(renderer.framePicking).toBe(true);
    await click(undefined); // background
    await click("base");
    await click("lidar");
    expect(written).toEqual([{ from: "base" }, { from: "base", to: "lidar" }]);
    expect(onStopPicking).toHaveBeenCalled();
  });

  it("applies clicks in click order when their picks resolve out of order", async () => {
    const { renderer, written, frameAxes, pickObject } = setup(undefined, { picking: true });
    const resolvers: ((object: THREE.Object3D) => void)[] = [];
    pickObject.mockImplementation(
      async () => await new Promise((resolve) => resolvers.push(resolve)),
    );
    frameAxes.frameIdOf.mockImplementation((object?: THREE.Object3D) => object?.name);
    const base = Object.assign(new THREE.Object3D(), { name: "base" });
    const lidar = Object.assign(new THREE.Object3D(), { name: "lidar" });
    const emitClick = () => {
      renderer.input.emit(
        "click",
        new THREE.Vector2(),
        new THREE.Vector3(),
        new MouseEvent("click"),
      );
    };
    await act(async () => {
      emitClick();
      emitClick();
      resolvers[1]!(lidar);
      resolvers[0]!(base);
    });
    expect(written).toEqual([{ from: "base" }, { from: "base", to: "lidar" }]);
  });

  it("ignores failed picks and picks that resolve after picking stopped", async () => {
    const { renderer, written, frameAxes, pickObject, click, result, onStopPicking } = setup(
      undefined,
      {
        picking: true,
      },
    );
    frameAxes.frameIdOf.mockImplementation((object?: THREE.Object3D) => object?.name);
    pickObject.mockRejectedValueOnce(new Error("device lost"));
    await click(undefined);
    expect(written).toEqual([]);

    let resolve: (object: THREE.Object3D) => void = () => {};
    pickObject.mockImplementationOnce(async () => await new Promise((r) => (resolve = r)));
    await click(undefined);
    result.rerender(
      <ThemeProvider isDark>
        <FrameMeasureOverlay renderer={renderer} picking={false} onStopPicking={onStopPicking} />
      </ThemeProvider>,
    );
    await act(async () => {
      resolve(Object.assign(new THREE.Object3D(), { name: "base" }));
    });
    expect(written).toEqual([]);
  });

  it("starts a new pair when picking again after both ends are set", async () => {
    const { written, click } = setup({ from: "base", to: "lidar" }, { picking: true });
    await click("map");
    expect(written).toEqual([{ from: "map" }]);
  });

  it("names the missing link instead of showing numbers", () => {
    setup({ from: "lidar", to: "imu" });
    expect(screen.queryByTestId("frame-measure-values")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "No transform between map and rig: they are in separate trees.",
    );
  });

  it("names a frame without a transform", () => {
    setup({ from: "lidar", to: "gps" });
    expect(screen.getByRole("status")).toHaveTextContent("No transform for gps");
  });

  it("swaps From and To, and dismisses", () => {
    const { written } = setup({ from: "base", to: "lidar", rotationFormat: "radians" });
    fireEvent.click(screen.getByRole("button", { name: "Swap From and To" }));
    expect(written.at(-1)).toEqual({ from: "lidar", to: "base", rotationFormat: "radians" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(written.at(-1)).toEqual({ rotationFormat: "radians" });
    expect(screen.queryByTestId("frame-measure")).toBeNull();
  });
});
