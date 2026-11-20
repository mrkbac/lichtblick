/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { ObjectPool } from "@lichtblick/den/collection";

import type { Renderer } from "../Renderer";
import { Transform, TransformTree } from "../transforms";
import { MeasurementTool } from "./MeasurementTool";

/** Picks resolve asynchronously; a macrotask runs after every pending pick has */
async function flushPicks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setup(kind: "distance" | "profile" = "distance") {
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
    pickPoint: async (_cursor: THREE.Vector2, out: THREE.Vector3, camera?: THREE.Camera) => {
      if (camera) {
        // Profile samples look straight down onto a surface at z = 2
        return out.set(camera.position.x, camera.position.y, 2);
      }
      return out.copy(picks.shift()!);
    },
  } as unknown as Renderer;

  const tool = new MeasurementTool(renderer);
  const frame = () => {
    tool.startFrame(0n, "base", "map");
  };
  frame();
  tool.startMeasuring(kind);
  picks.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 4, 0));
  listeners.get("click")!(new THREE.Vector2(10, 10));
  await flushPicks();
  listeners.get("click")!(new THREE.Vector2(20, 20));
  await flushPicks();
  if (kind === "profile") {
    picks.push(new THREE.Vector3(3, 4, 0)); // the cursor point, dropped when finishing
    frame();
    await flushPicks();
  }
  tool.stopMeasuring();
  await flushPicks();
  frame();
  return { tool, transformTree, addBase, frame };
}

describe("MeasurementTool", () => {
  it("marks a measurement unavailable while its transform is missing and recovers", async () => {
    const { tool, transformTree, addBase, frame } = await setup();
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
    expect(info.summary.label).toBe("— (missing transform map)");
    expect(info.summary.details).toEqual([]);
    expect(tool.copyText()).toBe("");
    expect(tool.copyText(info.id)).toBe("");

    // The transform returns
    addBase();
    frame();
    expect(tool.measurements[0]!.unavailable).toBe(false);
    expect(tool.copyText()).toBe(copied);
  });

  it("does not name a present frame when only the path between frames is missing", async () => {
    const { tool, transformTree, frame } = await setup();
    // Every frame exists, but the result frame isn't connected to the measurement's frame
    transformTree.addTransform("other", "elsewhere", 0n, Transform.Identity());
    tool.setResultFrame("other");
    frame();
    expect(tool.measurements[0]!.unavailable).toBe(true);
    expect(tool.measurements[0]!.summary.label).toBe("— (transform unavailable)");
    expect(tool.copyText()).toBe("");
  });

  it("stays fixed in the world when the display frame moves", async () => {
    const { tool, transformTree, frame } = await setup();
    expect(tool.measurements[0]!.summary.details[0]).toBe("P1: 0.000, 0.000, 0.000");
    // The robot drives 1 m forward: the world point is now 1 m behind it
    transformTree.clear();
    transformTree.addTransform("base", "map", 0n, new Transform([1, 0, 0], [0, 0, 0, 1]));
    frame();
    expect(tool.measurements[0]!.summary.details[0]).toBe("P1: -1.000, 0.000, 0.000");
    expect(tool.measurements[0]!.summary.label).toContain("5");
  });

  it("samples the profile straight below the line", async () => {
    const { tool } = await setup("profile");
    const profile = tool.measurements[0]!.summary.profile!;
    expect(profile.z.length).toBeGreaterThan(10);
    expect(profile.z[0]).toBe(0);
    expect(profile.z.at(-1)).toBe(0);
    expect(profile.z.slice(1, -1).every((z) => z === 2)).toBe(true);
    expect(profile.x.at(-1)).toBeCloseTo(5);
  });
});
