// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  clearFrames,
  composePoses,
  distance,
  findMissingLink,
  formatMeasurementText,
  formatRotation,
  parseFrameMeasurement,
  pickFrame,
  Pose,
  relativePose,
  setEnd,
  swapFrames,
} from "./frameMeasurement";
import { Quat } from "./transformOffsets";

const S = Math.SQRT1_2;
/** 90° around z */
const YAW_90: Quat = [0, 0, S, S];
const IDENTITY: Quat = [0, 0, 0, 1];

function expectPose(actual: Pose, expected: Pose) {
  actual.position.forEach((v, i) => {
    expect(v).toBeCloseTo(expected.position[i]!, 9);
  });
  // q and -q are the same rotation
  const sign = actual.rotation[3] * expected.rotation[3] < 0 ? -1 : 1;
  actual.rotation.forEach((v, i) => {
    expect(v * sign).toBeCloseTo(expected.rotation[i]!, 9);
  });
}

describe("relativePose", () => {
  it("expresses To in From's axes", () => {
    // From at (1,0,0) yawed 90°, To at (1,2,0) unrotated: To is 2 m along From's x axis
    const from: Pose = { position: [1, 0, 0], rotation: YAW_90 };
    const to: Pose = { position: [1, 2, 0], rotation: IDENTITY };
    const pose = relativePose(from, to);
    expectPose(pose, { position: [2, 0, 0], rotation: [0, 0, -S, S] });
    expect(distance(pose)).toBeCloseTo(2, 9);
  });

  it("is the inverse when From and To swap", () => {
    const a: Pose = { position: [0.3, -1, 2], rotation: [0.1, 0.2, 0.3, 0.927] };
    const b: Pose = { position: [-4, 0.5, 1], rotation: YAW_90 };
    const ab = relativePose(a, b);
    const ba = relativePose(b, a);
    expectPose(composePoses([ab, ba]), { position: [0, 0, 0], rotation: IDENTITY });
  });
});

describe("composePoses", () => {
  it("chains parent->child transforms from the root", () => {
    // map -> base: 1 m along x, yawed 90°; base -> sensor: 1 m along base's x (= map's y)
    const pose = composePoses([
      { position: [1, 0, 0], rotation: YAW_90 },
      { position: [1, 0, 0], rotation: IDENTITY },
    ]);
    expectPose(pose, { position: [1, 1, 0], rotation: YAW_90 });
  });
});

describe("findMissingLink", () => {
  const parents: Record<string, string> = { base: "map", lidar: "base", cam: "camera_rig" };
  const parentOf = (frame: string) => parents[frame];
  const hasFrame = (frame: string) =>
    Object.hasOwn(parents, frame) || Object.values(parents).includes(frame);

  it("is undefined for frames in the same tree", () => {
    expect(findMissingLink("lidar", "map", parentOf, hasFrame)).toBeUndefined();
  });

  it("names a frame without a transform", () => {
    expect(findMissingLink("lidar", "gps", parentOf, hasFrame)).toEqual({ frame: "gps" });
  });

  it("names both roots of disconnected trees", () => {
    expect(findMissingLink("lidar", "cam", parentOf, hasFrame)).toEqual({
      between: ["map", "camera_rig"],
    });
  });

  it("terminates on a parent cycle", () => {
    const cyclic: Record<string, string> = { a: "b", b: "a" };
    expect(
      findMissingLink(
        "a",
        "a",
        (f) => cyclic[f],
        () => true,
      ),
    ).toBeUndefined();
  });
});

describe("picking", () => {
  it("fills From, then To, then starts over", () => {
    let m = pickFrame({ rotationFormat: "radians" }, "base");
    expect(m).toEqual({ rotationFormat: "radians", from: "base" });
    expect(pickFrame(m, "base")).toBe(m); // a frame can't be measured to itself
    m = pickFrame(m, "lidar");
    expect(m).toEqual({ rotationFormat: "radians", from: "base", to: "lidar" });
    expect(pickFrame(m, "cam")).toEqual({ rotationFormat: "radians", from: "cam" });
  });

  it("swaps instead of measuring a frame to itself when setting an end", () => {
    const m = { from: "a", to: "b" };
    expect(setEnd(m, "to", "a")).toEqual({ from: "b", to: "a" });
    expect(setEnd(m, "from", "c")).toEqual({ from: "c", to: "b" });
    expect(setEnd(m, "from", undefined)).toEqual({ to: "b" });
  });

  it("swaps and clears but keeps the display options", () => {
    const m = {
      from: "a",
      to: "b",
      rotationFormat: "quaternion",
      convention: "intrinsic",
    } as const;
    expect(swapFrames(m)).toEqual({ ...m, from: "b", to: "a" });
    expect(clearFrames(m)).toEqual({ rotationFormat: "quaternion", convention: "intrinsic" });
  });
});

describe("parseFrameMeasurement", () => {
  it("drops malformed values", () => {
    expect(parseFrameMeasurement(undefined)).toEqual({});
    expect(parseFrameMeasurement([1])).toEqual({});
    expect(
      parseFrameMeasurement({ from: 3, to: "", rotationFormat: "gradians", convention: "zyx" }),
    ).toEqual({});
    expect(
      parseFrameMeasurement({
        from: "a",
        to: "b",
        rotationFormat: "radians",
        convention: "intrinsic",
      }),
    ).toEqual({ from: "a", to: "b", rotationFormat: "radians", convention: "intrinsic" });
  });
});

describe("formatting", () => {
  it("shows the rotation in each format", () => {
    expect(formatRotation(YAW_90, "degrees", "extrinsic")).toEqual({
      labels: ["roll", "pitch", "yaw"],
      values: ["0.00", "0.00", "90.00"],
      unit: "°",
    });
    expect(formatRotation(YAW_90, "radians", "extrinsic").values).toEqual([
      "0.0000",
      "0.0000",
      "1.5708",
    ]);
    expect(formatRotation(YAW_90, "quaternion", "extrinsic").values).toEqual([
      "0.0000",
      "0.0000",
      "0.7071",
      "0.7071",
    ]);
  });

  it("uses the chosen Euler convention", () => {
    // 90° yaw then 90° pitch: the conventions give different angles for the same rotation
    const q: Quat = [-0.5, 0.5, 0.5, 0.5];
    expect(formatRotation(q, "degrees", "extrinsic").values).not.toEqual(
      formatRotation(q, "degrees", "intrinsic").values,
    );
  });

  it("formats copy text", () => {
    const text = formatMeasurementText(
      "base",
      "lidar",
      { position: [3, 4, 0], rotation: YAW_90 },
      "degrees",
      "extrinsic",
    );
    expect(text).toBe(
      [
        "lidar in base",
        "distance: 5.0000 m",
        "translation (m): 3.0000, 4.0000, 0.0000",
        "rpy extrinsic (°): 0.00, 0.00, 90.00",
      ].join("\n"),
    );
  });
});
