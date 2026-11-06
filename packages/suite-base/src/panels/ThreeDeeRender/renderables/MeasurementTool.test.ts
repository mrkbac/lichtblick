/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { ObjectPool } from "@lichtblick/den/collection";

import type { IRenderer } from "../IRenderer";
import { Transform, TransformTree } from "../transforms";
import { MeasurementTool } from "./MeasurementTool";

function setup() {
  const transformTree = new TransformTree(new ObjectPool(Transform.Empty));
  const addBase = () => transformTree.addTransform("base", "map", 0n, Transform.Identity());
  addBase();

  const listeners = new Map<string, (cursor: THREE.Vector2) => void>();
  const canvas = document.createElement("canvas");
  document.createElement("div").appendChild(canvas);
  const picks: THREE.Vector3[] = [];
  const renderer = {
    transformTree,
    on: vi.fn(),
    off: vi.fn(),
    settings: { setNodesForKey: vi.fn() },
    queueAnimationFrame: vi.fn(),
    setSelectedRenderable: vi.fn(),
    currentTime: 0n,
    gl: { domElement: canvas },
    input: {
      canvasSize: new THREE.Vector2(100, 100),
      addListener: (event: string, fn: (cursor: THREE.Vector2) => void) => listeners.set(event, fn),
      removeListener: vi.fn(),
    },
    pickPoint: (_cursor: THREE.Vector2, out: THREE.Vector3) => {
      out.copy(picks.shift()!);
      return true;
    },
  } as unknown as IRenderer;

  const tool = new MeasurementTool(renderer);
  const frame = () => {
    tool.startFrame(0n, "base", "map");
  };
  frame();
  tool.startMeasuring("distance");
  picks.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 4, 0));
  listeners.get("click")!(new THREE.Vector2(10, 10));
  listeners.get("click")!(new THREE.Vector2(20, 20));
  tool.stopMeasuring();
  frame();
  return { tool, transformTree, addBase, frame };
}

describe("MeasurementTool", () => {
  it("marks a measurement unavailable while its transform is missing and recovers", () => {
    const { tool, transformTree, addBase, frame } = setup();
    expect(tool.measurements).toHaveLength(1);
    expect(tool.measurements[0]!.unavailable).toBe(false);
    expect(tool.measurements[0]!.summary.label).toContain("5");
    const copied = tool.copyText();
    expect(copied).toContain("5");

    // Seek back to before the transform was published
    transformTree.clear();
    frame();
    const info = tool.measurements[0]!;
    expect(info.unavailable).toBe(true);
    expect(info.summary.label).toBe("— (missing transform base)");
    expect(info.summary.details).toEqual([]);
    expect(tool.copyText()).toBe("");
    expect(tool.copyText(info.id)).toBe("");

    // The transform returns
    addBase();
    frame();
    expect(tool.measurements[0]!.unavailable).toBe(false);
    expect(tool.copyText()).toBe(copied);
  });

  it("does not name a present frame when only the path between frames is missing", () => {
    const { tool, transformTree, frame } = setup();
    // Every frame exists, but the result frame isn't connected to the measurement's frame
    transformTree.addTransform("other", "elsewhere", 0n, Transform.Identity());
    tool.setResultFrame("other");
    frame();
    expect(tool.measurements[0]!.unavailable).toBe(true);
    expect(tool.measurements[0]!.summary.label).toBe("— (transform unavailable)");
    expect(tool.copyText()).toBe("");
  });
});
