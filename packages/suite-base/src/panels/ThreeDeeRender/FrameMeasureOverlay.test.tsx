/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import EventEmitter from "eventemitter3";
import * as THREE from "three";

import { ObjectPool } from "@lichtblick/den/collection";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { FrameMeasureOverlay } from "./FrameMeasureOverlay";
import type { IRenderer } from "./IRenderer";
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
    pickObject: vi.fn(() => new THREE.Object3D()),
    sceneExtensions: new Map([["foxglove.FrameAxes", frameAxes]]),
  }) as unknown as IRenderer;
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
  const click = (frame: string | undefined) => {
    frameUnderCursor.id = frame;
    act(() => {
      renderer.input.emit(
        "click",
        new THREE.Vector2(),
        new THREE.Vector3(),
        new MouseEvent("click"),
      );
    });
  };
  return { renderer, emitter, variables, written, frameAxes, onStopPicking, click, result };
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

  it("picks From, then To from clicks on frames, writes the shared pair and stops picking", () => {
    const { written, click, onStopPicking, renderer } = setup(undefined, { picking: true });
    expect(renderer.framePicking).toBe(true);
    click(undefined); // background
    click("base");
    click("lidar");
    expect(written).toEqual([{ from: "base" }, { from: "base", to: "lidar" }]);
    expect(onStopPicking).toHaveBeenCalled();
  });

  it("starts a new pair when picking again after both ends are set", () => {
    const { written, click } = setup({ from: "base", to: "lidar" }, { picking: true });
    click("map");
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
