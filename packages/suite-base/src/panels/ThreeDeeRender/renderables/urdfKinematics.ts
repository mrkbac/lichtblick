// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";

import type { UrdfJoint } from "@lichtblick/den/urdf";

/** A link's pose relative to the root link of its kinematic tree. */
export type LinkPose = { root: string; matrix: THREE.Matrix4 };

const tempAxis = new THREE.Vector3();
const tempMotion = new THREE.Matrix4();
const tempOrigin = new THREE.Matrix4();
const tempEuler = new THREE.Euler();

/** The value a joint takes: its own, or for a mimic joint the mimicked joint's scaled and offset. */
export function jointValue(joint: UrdfJoint, values: (jointName: string) => number): number {
  if (joint.mimic) {
    return joint.mimic.multiplier * values(joint.mimic.joint) + joint.mimic.offset;
  }
  return values(joint.name);
}

/**
 * Forward kinematics: the pose of every link relative to the root link of its tree, given each
 * joint's position (radians for revolute/continuous, meters for prismatic). Floating and planar
 * joints stay at their origin. `out` is reused across calls to avoid allocating every frame.
 */
export function forwardKinematics(
  joints: readonly UrdfJoint[],
  values: (jointName: string) => number,
  out = new Map<string, LinkPose>(),
): Map<string, LinkPose> {
  const childJoints = new Map<string, UrdfJoint[]>();
  const children = new Set<string>();
  for (const joint of joints) {
    children.add(joint.child);
    const siblings = childJoints.get(joint.parent);
    if (siblings) {
      siblings.push(joint);
    } else {
      childJoints.set(joint.parent, [joint]);
    }
  }

  const setPose = (link: string, root: string): THREE.Matrix4 => {
    let entry = out.get(link);
    if (!entry) {
      entry = { root, matrix: new THREE.Matrix4() };
      out.set(link, entry);
    }
    entry.root = root;
    return entry.matrix;
  };

  for (const root of childJoints.keys()) {
    if (children.has(root)) {
      continue;
    }
    setPose(root, root).identity();
    // Depth-first; a URDF is a tree, the visited check only guards against malformed cycles
    const stack = [root];
    const visited = new Set<string>([root]);
    while (stack.length > 0) {
      const parent = stack.pop()!;
      const parentMatrix = out.get(parent)!.matrix;
      for (const joint of childJoints.get(parent) ?? []) {
        if (visited.has(joint.child)) {
          continue;
        }
        visited.add(joint.child);
        const { xyz, rpy } = joint.origin;
        tempOrigin.makeRotationFromEuler(tempEuler.set(rpy.x, rpy.y, rpy.z, "ZYX"));
        tempOrigin.setPosition(xyz.x, xyz.y, xyz.z);
        jointMotion(joint, jointValue(joint, values), tempMotion);
        setPose(joint.child, root).multiplyMatrices(parentMatrix, tempOrigin).multiply(tempMotion);
        stack.push(joint.child);
      }
    }
  }
  return out;
}

function jointMotion(joint: UrdfJoint, value: number, out: THREE.Matrix4): THREE.Matrix4 {
  const axis = tempAxis.set(joint.axis.x, joint.axis.y, joint.axis.z);
  if (axis.lengthSq() === 0 || !Number.isFinite(value)) {
    return out.identity();
  }
  axis.normalize();
  switch (joint.jointType) {
    case "revolute":
    case "continuous":
      return out.makeRotationAxis(axis, value);
    case "prismatic":
      return out.makeTranslation(axis.x * value, axis.y * value, axis.z * value);
    default:
      return out.identity();
  }
}
