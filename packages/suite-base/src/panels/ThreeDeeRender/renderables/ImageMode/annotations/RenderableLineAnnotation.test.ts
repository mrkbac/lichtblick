// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { ICameraModel } from "@lichtblick/suite";

import { RenderableLineAnnotation } from "./RenderableLineAnnotation";
import { RenderablePointsAnnotation } from "./RenderablePointsAnnotation";
import { PointsAnnotation } from "./types";

const cameraModel = {
  projectPixelTo3dPlane: (out: THREE.Vector3, point: { x: number; y: number }) =>
    out.set(point.x, point.y, 1),
} as unknown as ICameraModel;

function annotation(i: number, outlineColors: PointsAnnotation["outlineColors"] = []) {
  return {
    type: "points" as const,
    stamp: { sec: i, nsec: 0 },
    style: "polygon" as const,
    points: [
      { x: i, y: 0 },
      { x: 10, y: i },
      { x: 0, y: 10 },
    ],
    outlineColors,
    outlineColor: { r: i / 10, g: 0, b: 0, a: 1 },
    fillColor: { r: 0, g: i / 10, b: 0, a: 0.5 },
    thickness: i,
    messagePath: [],
  };
}

function materialVersion(renderable: THREE.Object3D): number {
  let version = 0;
  renderable.traverse((object) => {
    const material = (object as Partial<THREE.Mesh>).material as THREE.Material | undefined;
    const picking = object.userData.pickingMaterial as THREE.Material | undefined;
    version += (material?.version ?? 0) + (picking?.version ?? 0);
  });
  return version;
}

describe("RenderableLineAnnotation", () => {
  it("only rebuilds shaders when a compiled property changes", () => {
    const renderable = new RenderableLineAnnotation("/annotations");
    renderable.setCameraModel(cameraModel);
    renderable.setScale(1, 100, 100, 1);
    renderable.setAnnotation(annotation(1), undefined);
    renderable.update();
    const initial = materialVersion(renderable);

    for (let i = 2; i <= 11; i++) {
      renderable.setAnnotation(annotation(i), undefined);
      renderable.update();
    }
    expect(materialVersion(renderable)).toBe(initial);

    const colors = [0, 1, 2].map(() => ({ r: 0, g: 0, b: 1, a: 1 }));
    renderable.setAnnotation(annotation(12, colors), undefined);
    renderable.update();
    expect(materialVersion(renderable)).toBeGreaterThan(initial);

    renderable.dispose();
  });

  it("does not rebuild point shaders when the point size changes", () => {
    const renderable = new RenderablePointsAnnotation("/annotations");
    renderable.setCameraModel(cameraModel);
    renderable.setScale(1, 100, 100, 1);
    renderable.setAnnotation({ ...annotation(1), style: "points" }, undefined);
    renderable.update();
    const initial = materialVersion(renderable);

    for (let i = 2; i <= 11; i++) {
      renderable.setAnnotation({ ...annotation(i), style: "points" }, undefined);
      renderable.update();
    }
    expect(materialVersion(renderable)).toBe(initial);

    renderable.dispose();
  });
});
