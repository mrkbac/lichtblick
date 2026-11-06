// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { mat4 } from "gl-matrix";
import * as THREE from "three";

import { ObjectPool } from "@lichtblick/den/collection";

import { CoordinateFrame } from "./CoordinateFrame";
import { Transform } from "./Transform";
import { TransformTree } from "./TransformTree";
import {
  applyOffset,
  formatStaticTransformPublisher,
  formatUrdfJoint,
  formatYaml,
  nudge,
  offsetForResult,
  parseTransformOffsets,
  Quat,
  quatToRpyDegrees,
  rpyDegreesToQuat,
  Vec3,
  withFrameOffset,
} from "./transformOffsets";

const recordedPos: Vec3 = [1, 2, 0.5];
const recordedRot = rpyDegreesToQuat([0, 60, 90]);

function expectVecClose(actual: readonly number[], expected: readonly number[]) {
  actual.forEach((v, i) => {
    expect(v).toBeCloseTo(expected[i]!, 6);
  });
}

describe("transformOffsets", () => {
  it("applyOffset matches what CoordinateFrame renders", () => {
    const offset = { xyz: [0.1, -0.2, 0.3] as Vec3, rpy: [1, 2, 3] as Vec3 };
    const tree = new TransformTree(new ObjectPool(Transform.Empty));
    tree.addTransform("child", "parent", 0n, new Transform(recordedPos, recordedRot));
    const child = tree.frame("child")!;
    child.offsetPosition = offset.xyz;
    child.offsetEulerDegrees = offset.rpy;
    const rendered = mat4.create();
    CoordinateFrame.GetTransformMatrix(rendered, tree.frame("parent")!, child, 0n, 0n);

    const { position, rotation } = applyOffset(recordedPos, recordedRot, offset);
    const expected = mat4.fromRotationTranslation(mat4.create(), rotation, position);
    expectVecClose(Array.from(rendered), Array.from(expected));
  });

  it("editing the result to 61 deg on a 60 deg recording yields a 1 deg offset", () => {
    const offset = offsetForResult(recordedPos, recordedRot, recordedPos, [0, 61, 90]);
    expectVecClose(offset.xyz, [0, 0, 0]);
    // rotation offset is around the frame's own axes: pitch of a frame yawed by 90 deg
    const result = applyOffset(recordedPos, recordedRot, offset);
    expectVecClose(quatToRpyDegrees(result.rotation), [0, 61, 90]);
    expect(
      new THREE.Quaternion(...rpyDegreesToQuat(offset.rpy)).angleTo(new THREE.Quaternion()),
    ).toBeCloseTo(Math.PI / 180, 6);
  });

  it("offsetForResult round-trips position and rotation", () => {
    const resultXyz: Vec3 = [1.234, -0.5, 2];
    const resultRpy: Vec3 = [-3, 12.5, 170];
    const offset = offsetForResult(recordedPos, recordedRot, resultXyz, resultRpy);
    const result = applyOffset(recordedPos, recordedRot, offset);
    expectVecClose(result.position, resultXyz);
    expectVecClose(quatToRpyDegrees(result.rotation), resultRpy);
  });

  it("parses only well-formed variable values", () => {
    expect(parseTransformOffsets(undefined)).toEqual({ frames: {} });
    expect(parseTransformOffsets("nope")).toEqual({ frames: {} });
    expect(
      parseTransformOffsets({
        showOriginal: true,
        frames: {
          ok: { xyz: [1, 2, 3], rpy: [0, 0, 1] },
          bad: { xyz: [1, 2], rpy: [0, 0, 0] },
          nan: { xyz: [1, 2, Number.NaN], rpy: [0, 0, 0] },
        },
      }),
    ).toEqual({ showOriginal: true, frames: { ok: { xyz: [1, 2, 3], rpy: [0, 0, 1] } } });
  });

  it("withFrameOffset drops zero offsets and float noise", () => {
    const set = withFrameOffset({ frames: {} }, "a", { xyz: [0.1 + 0.2, 0, 0], rpy: [0, 0, 0] });
    expect(set.frames.a).toEqual({ xyz: [0.3, 0, 0], rpy: [0, 0, 0] });
    expect(withFrameOffset(set, "a", { xyz: [0, 0, 0], rpy: [0, 0, 0] }).frames).toEqual({});
  });

  it("nudges translation and rotation", () => {
    expect(nudge(undefined, "ArrowUp", { rotate: false, amount: 0.01 })).toEqual({
      xyz: [0.01, 0, 0],
      rpy: [0, 0, 0],
    });
    expect(nudge(undefined, "ArrowLeft", { rotate: false, amount: 0.01 }).xyz).toEqual([
      0, 0.01, 0,
    ]);
    expect(nudge(undefined, "PageDown", { rotate: false, amount: 0.01 }).xyz).toEqual([
      0, 0, -0.01,
    ]);
    expect(nudge(undefined, "ArrowDown", { rotate: true, amount: 0.1 }).rpy).toEqual([0, -0.1, 0]);
    expect(nudge(undefined, "ArrowRight", { rotate: true, amount: 0.1 }).rpy).toEqual([0, 0, -0.1]);
    expect(nudge(undefined, "PageUp", { rotate: true, amount: 0.1 }).rpy).toEqual([0.1, 0, 0]);
  });

  it("escapes frame ids from recordings in every format", () => {
    const evil = `a;rm -rf ~ "x" <y> 'z'`;
    expect(formatStaticTransformPublisher("base", evil, [0, 0, 0], [0, 0, 0, 1])).toContain(
      `--child-frame-id 'a;rm -rf ~ "x" <y> '\\''z'\\'''`,
    );
    expect(formatUrdfJoint("base", evil, [0, 0, 0], [0, 0, 0, 1])).toContain(
      `<child link="a;rm -rf ~ &quot;x&quot; &lt;y&gt; 'z'"/>`,
    );
    expect(formatYaml("base", evil, [0, 0, 0], [0, 0, 0, 1])).toContain(
      `child_frame: "a;rm -rf ~ \\"x\\" <y> 'z'"`,
    );
  });

  describe("formats", () => {
    const rotation: Quat = rpyDegreesToQuat([0, 15, 90]);
    const position: Vec3 = [1, 0, 2];

    it("URDF rpy is extrinsic XYZ in radians", () => {
      const text = formatUrdfJoint("base", "sensor", position, rotation);
      const rpy = /rpy="([^"]+)"/.exec(text)![1]!.split(" ").map(Number) as Vec3;
      // URDF: R = Rz(yaw) * Ry(pitch) * Rx(roll), i.e. three.js "ZYX" order
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], "ZYX"));
      expect(q.angleTo(new THREE.Quaternion(...rotation))).toBeCloseTo(0, 5);
      expect(text).toContain('<parent link="base"/>');
      expect(text).toContain('xyz="1 0 2"');
    });

    it("static_transform_publisher and YAML carry the quaternion", () => {
      const q = rotation.map((v) => String(Number(v.toFixed(6))));
      expect(formatStaticTransformPublisher("base", "sensor", position, rotation)).toBe(
        `ros2 run tf2_ros static_transform_publisher --x 1 --y 0 --z 2 --qx ${q[0]} --qy ${q[1]} --qz ${q[2]} --qw ${q[3]} --frame-id base --child-frame-id sensor`,
      );
      const yaml = formatYaml("base", "sensor", position, rotation);
      expect(yaml).toContain(`rotation: {x: ${q[0]}, y: ${q[1]}, z: ${q[2]}, w: ${q[3]}}`);
      expect(yaml).toContain("rotation_euler_xyz_deg: [0, 15, 90]");
    });
  });
});
