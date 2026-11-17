// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import type { UrdfJoint } from "@lichtblick/den/urdf";

import { forwardKinematics } from "./urdfKinematics";

function joint(
  name: string,
  jointType: UrdfJoint["jointType"],
  parent: string,
  child: string,
  extra: Partial<UrdfJoint> = {},
): UrdfJoint {
  return {
    name,
    jointType,
    parent,
    child,
    origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
    axis: { x: 0, y: 0, z: 1 },
    ...extra,
  };
}

function position(poses: ReturnType<typeof forwardKinematics>, link: string): number[] {
  const p = new THREE.Vector3().setFromMatrixPosition(poses.get(link)!.matrix);
  return p.toArray().map((v) => Math.round(v * 1e6) / 1e6 + 0);
}

describe("forwardKinematics", () => {
  const chain = [
    joint("shoulder", "revolute", "base", "upper"),
    joint("slide", "prismatic", "upper", "lower", { axis: { x: 2, y: 0, z: 0 } }),
    joint("wrist", "fixed", "lower", "tool"),
  ];

  it("composes joint origins and motion along the chain", () => {
    // When
    const values: Record<string, number> = { shoulder: Math.PI / 2, slide: 0.5 };
    const poses = forwardKinematics(chain, (name) => values[name] ?? 0);
    // Then
    expect(position(poses, "base")).toEqual([0, 0, 0]);
    expect(position(poses, "upper")).toEqual([1, 0, 0]);
    // The slide's origin and its (normalized) axis turn with the shoulder
    expect(position(poses, "lower")).toEqual([1, 1.5, 0]);
    expect(position(poses, "tool")).toEqual([1, 2.5, 0]);
    expect(poses.get("tool")!.root).toBe("base");
  });

  it("uses the joint origin for zero positions and the rpy of the origin", () => {
    // Given a joint whose origin is yawed by 90°
    const yawed = [
      joint("a", "continuous", "base", "l1", {
        origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: Math.PI / 2 } },
      }),
      joint("b", "fixed", "l1", "l2"),
    ];
    // When
    const poses = forwardKinematics(yawed, () => 0);
    // Then l2 is 1 m along l1's x axis, which points along base y
    expect(position(poses, "l2")).toEqual([1, 1, 0]);
  });

  it("follows mimic joints", () => {
    // Given
    const joints = [
      joint("leader", "prismatic", "base", "a", { axis: { x: 0, y: 1, z: 0 } }),
      joint("follower", "prismatic", "base", "b", {
        axis: { x: 0, y: 1, z: 0 },
        mimic: { joint: "leader", multiplier: -2, offset: 0.5 },
      }),
    ];
    // When
    const poses = forwardKinematics(joints, (name) => (name === "leader" ? 1 : 0));
    // Then
    expect(position(poses, "a")).toEqual([1, 1, 0]);
    expect(position(poses, "b")).toEqual([1, -1.5, 0]);
  });

  it("poses each tree relative to its own root and ignores non-finite positions", () => {
    // Given
    const joints = [joint("a", "revolute", "r1", "c1"), joint("b", "prismatic", "r2", "c2")];
    // When
    const poses = forwardKinematics(joints, () => NaN);
    // Then
    expect(poses.get("c1")!.root).toBe("r1");
    expect(poses.get("c2")!.root).toBe("r2");
    expect(position(poses, "c2")).toEqual([1, 0, 0]);
  });

  it("reuses the output map and its matrices", () => {
    // Given
    const out = forwardKinematics(chain, () => 0);
    const matrix = out.get("tool")!.matrix;
    // When
    const again = forwardKinematics(chain, (name) => (name === "slide" ? 1 : 0), out);
    // Then
    expect(again).toBe(out);
    expect(again.get("tool")!.matrix).toBe(matrix);
    expect(position(again, "tool")).toEqual([4, 0, 0]);
  });
});
