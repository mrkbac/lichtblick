// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import { ObjectPool } from "@lichtblick/den/collection";

import {
  angleAt,
  formatArea,
  formatLength,
  frameTransform,
  pathLength,
  polygonArea,
  profileSeries,
  summarize,
} from "./geometry";
import { Transform, TransformTree } from "../../transforms";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("measure geometry", () => {
  it("computes open and closed path lengths", () => {
    const square = [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)];
    expect(pathLength(square)).toBeCloseTo(3);
    expect(pathLength(square, { closed: true })).toBeCloseTo(4);
    expect(pathLength([v(0, 0, 0), v(3, 4, 12)])).toBeCloseTo(13);
    expect(pathLength([])).toBe(0);
  });

  it("computes the angle at the middle vertex", () => {
    expect(angleAt(v(1, 0, 0), v(0, 0, 0), v(0, 1, 0))).toBeCloseTo(Math.PI / 2);
    expect(angleAt(v(1, 0, 0), v(0, 0, 0), v(-1, 0, 0))).toBeCloseTo(Math.PI);
    expect(angleAt(v(1, 0, 0), v(0, 0, 0), v(1, 1, 0))).toBeCloseTo(Math.PI / 4);
    expect(angleAt(v(0, 0, 0), v(0, 0, 0), v(1, 0, 0))).toBe(0);
  });

  it("computes polygon area in any orientation", () => {
    expect(polygonArea([v(0, 0, 0), v(2, 0, 0), v(2, 3, 0), v(0, 3, 0)])).toBeCloseTo(6);
    // Same rectangle standing up in the XZ plane, wound the other way
    expect(polygonArea([v(0, 0, 0), v(0, 0, 3), v(2, 0, 3), v(2, 0, 0)])).toBeCloseTo(6);
    // Concave L shape: 2x2 square minus a 1x1 corner
    expect(
      polygonArea([v(0, 0, 0), v(2, 0, 0), v(2, 1, 0), v(1, 1, 0), v(1, 2, 0), v(0, 2, 0)]),
    ).toBeCloseTo(3);
    // Tilted triangle: right triangle with legs 1 and sqrt(2)
    expect(polygonArea([v(0, 0, 0), v(1, 0, 0), v(0, 1, 1)])).toBeCloseTo(Math.SQRT2 / 2);
  });

  it("builds a height profile over horizontal distance", () => {
    expect(profileSeries([v(0, 0, 1), v(3, 4, 2), v(3, 4, 5), v(3, 7, 0)])).toEqual({
      x: [0, 5, 5, 8],
      z: [1, 2, 5, 0],
    });
  });

  it("formats lengths and areas with sensible units", () => {
    expect(formatLength(0.123)).toBe("12.3 cm");
    expect(formatLength(-2.5)).toBe("-2.50 m");
    expect(formatLength(1234.5)).toBe("1.234 km");
    expect(formatArea(12.345)).toBe("12.35 m²");
    expect(formatArea(2_500_000)).toBe("2.500 km²");
  });

  it("summarizes each kind", () => {
    expect(summarize("distance", [v(0, 0, 0), v(3, 4, 0)]).label).toBe("5.00 m");
    expect(summarize("height", [v(0, 0, 1), v(3, 4, 3)]).label).toBe("Δz 2.00 m");
    expect(summarize("angle", [v(1, 0, 0), v(0, 0, 0), v(0, 2, 0)]).label).toBe("90.0°");
    expect(summarize("point", [v(1, 2, 3)]).label).toBe("1.000, 2.000, 3.000");
    const area = summarize("area", [v(0, 0, 0), v(2, 0, 0), v(2, 2, 0)]);
    expect(area.label).toBe("2.00 m²");
    expect(area.segmentLabels).toHaveLength(3);
    const polyline = summarize("polyline", [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0)]);
    expect(polyline.label).toBe("2.00 m");
    expect(polyline.segmentLabels).toEqual(["1.00 m", "1.00 m"]);
    expect(summarize("distance", []).label).toBe("");
  });

  it("transforms points between frames", () => {
    const tree = new TransformTree(new ObjectPool(Transform.Empty));
    // child sits 1m up and is rotated 90° about z relative to parent
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    tree.addTransform("child", "parent", 0n, new Transform([0, 0, 1], [q.x, q.y, q.z, q.w]));

    const childToParent = new THREE.Matrix4();
    expect(frameTransform(childToParent, tree, "parent", "parent", "child", 0n)).toBe(true);
    const p = v(1, 0, 0).applyMatrix4(childToParent);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
    expect(p.z).toBeCloseTo(1);

    // Height of the same two points differs by frame; distance does not
    const a = v(0, 0, 0);
    const b = v(0, 0, 2);
    const parentToChild = new THREE.Matrix4();
    expect(frameTransform(parentToChild, tree, "child", "parent", "parent", 0n)).toBe(true);
    const aChild = a.clone().applyMatrix4(parentToChild);
    const bChild = b.clone().applyMatrix4(parentToChild);
    expect(aChild.z).toBeCloseTo(-1);
    expect(aChild.distanceTo(bChild)).toBeCloseTo(2);

    expect(frameTransform(childToParent, tree, "parent", undefined, "missing", 0n)).toBe(false);
  });
});
