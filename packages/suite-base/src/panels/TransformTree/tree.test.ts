// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { quaternionToRpy, samplesFromMessage } from "./transforms";
import { addTransformEvents, buildRows, mergeEntries } from "./tree";
import { FrameEntries } from "./types";

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function rosTf(topic: string, receiveSec: number, pairs: [string, string][]): MessageEvent {
  return {
    topic,
    schemaName: "tf2_msgs/msg/TFMessage",
    receiveTime: { sec: receiveSec, nsec: 0 },
    sizeInBytes: 0,
    message: {
      transforms: pairs.map(([parent, child]) => ({
        header: { stamp: { sec: receiveSec, nsec: 0 }, frame_id: parent },
        child_frame_id: child,
        transform: { translation: { x: 1, y: 2, z: 3 }, rotation: IDENTITY },
      })),
    },
  };
}

function rows(current: FrameEntries, now: number, collapsed: string[] = []) {
  return buildRows({
    current,
    known: current,
    now,
    collapsed: new Set(collapsed),
    staticTopics: new Set(["/tf_static"]),
  });
}

describe("samplesFromMessage", () => {
  it("should strip leading slashes when reading a ROS TFMessage", () => {
    // Given
    const event = rosTf("/tf", 1, [["/map", "odom"]]);

    // When
    const samples = samplesFromMessage(event.schemaName, event.message);

    // Then
    expect(samples).toEqual([
      {
        parent: "map",
        child: "odom",
        translation: { x: 1, y: 2, z: 3 },
        rotation: IDENTITY,
        stamp: 1,
      },
    ]);
  });

  it("should read parent, child and stamp when given foxglove FrameTransforms", () => {
    // Given
    const message = {
      transforms: [
        {
          timestamp: { sec: 2, nsec: 500_000_000 },
          parent_frame_id: "base_link",
          child_frame_id: "lidar",
          translation: { x: 0, y: 0, z: 1 },
          rotation: IDENTITY,
        },
      ],
    };

    // When
    const samples = samplesFromMessage("foxglove.FrameTransforms", message);

    // Then
    expect(samples).toMatchObject([{ parent: "base_link", child: "lidar", stamp: 2.5 }]);
  });
});

describe("quaternionToRpy", () => {
  it("should return a 90° yaw when given a 90° rotation around z", () => {
    // Given
    const rotation = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };

    // When
    const rpy = quaternionToRpy(rotation);

    // Then
    expect(rpy.x).toBeCloseTo(0);
    expect(rpy.y).toBeCloseTo(0);
    expect(rpy.z).toBeCloseTo(Math.PI / 2);
  });
});

describe("buildRows", () => {
  it("should build a depth-first tree with sorted children when given static and dynamic frames", () => {
    // Given
    let entries = addTransformEvents(new Map(), [
      rosTf("/tf_static", 0, [
        ["base_link", "lidar"],
        ["base_link", "camera"],
      ]),
      rosTf("/tf", 1, [
        ["map", "odom"],
        ["odom", "base_link"],
      ]),
    ]);
    entries = addTransformEvents(entries, [
      rosTf("/tf", 1.1, [
        ["map", "odom"],
        ["odom", "base_link"],
      ]),
    ]);

    // When
    const result = rows(entries, 1.2);

    // Then
    expect(result.map((row) => [row.frame, row.depth])).toEqual([
      ["map", 0],
      ["odom", 1],
      ["base_link", 2],
      ["camera", 3],
      ["lidar", 3],
    ]);
    expect(result[0]!.entry).toBeUndefined();
    expect(result[3]!.isStatic).toBe(true);
    expect(result[1]!.rate).toBeCloseTo(10);
    expect(result[1]!.age).toBeCloseTo(0.1);
    expect(result.every((row) => row.warnings.length === 0)).toBe(true);
  });

  it("should hide children when their parent is collapsed", () => {
    // Given
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [
        ["map", "odom"],
        ["odom", "base_link"],
      ]),
    ]);

    // When
    const result = rows(entries, 1, ["odom"]);

    // Then
    expect(result.map((row) => row.frame)).toEqual(["map", "odom"]);
  });

  it("should flag multipleParents when a frame is published with several parents", () => {
    // Given
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [["map", "base_link"]]),
      rosTf("/tf", 2, [["odom", "base_link"]]),
    ]);

    // When
    const baseLink = rows(entries, 2).find((row) => row.frame === "base_link");

    // Then
    expect(baseLink?.warnings).toContain("multipleParents");
    expect(baseLink?.entry?.parent).toBe("odom");
  });

  it("should flag stale dynamic frames but never static ones when no update arrives", () => {
    // Given
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [["map", "odom"]]),
      rosTf("/tf", 1.1, [["map", "odom"]]),
      rosTf("/tf_static", 0, [["odom", "base_link"]]),
    ]);

    // When
    const result = rows(entries, 5);

    // Then
    expect(result.find((row) => row.frame === "odom")?.warnings).toEqual(["stale"]);
    expect(result.find((row) => row.frame === "base_link")?.warnings).toEqual([]);
  });

  it("should keep known frames as noData when they have no current data", () => {
    // Given
    const known = addTransformEvents(new Map(), [rosTf("/tf", 1, [["map", "odom"]])]);

    // When
    const result = buildRows({
      current: new Map(),
      known,
      now: 2,
      collapsed: new Set(),
      staticTopics: new Set(),
    });

    // Then
    expect(result.find((row) => row.frame === "odom")?.warnings).toEqual(["noData"]);
  });

  it("should not warn about a frame when playback is before its first sample, e.g. after looping", () => {
    // Given seen on a previous pass: odom from t=1, base_link only from t=5
    const known = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [["map", "odom"]]),
      rosTf("/tf", 5, [["odom", "base_link"]]),
    ]);

    // When looped back to the start, with nothing received yet this pass
    const result = buildRows({
      current: new Map(),
      known,
      now: 2,
      collapsed: new Set(),
      staticTopics: new Set(),
    });

    // Then
    const odom = result.find((row) => row.frame === "odom");
    const baseLink = result.find((row) => row.frame === "base_link");
    expect(odom).toMatchObject({ notYetPublished: false, warnings: ["noData"] });
    expect(baseLink).toMatchObject({ notYetPublished: true, warnings: [] });
  });

  it("should still show frames when they form a cycle", () => {
    // Given
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [
        ["a", "b"],
        ["b", "a"],
      ]),
    ]);

    // When
    const result = rows(entries, 1);

    // Then
    expect(result.map((row) => row.frame)).toEqual(["a", "b"]);
  });
});

describe("mergeEntries", () => {
  it("should keep parents and the earliest first receive time from both maps", () => {
    // Given
    const fromStatic = addTransformEvents(new Map(), [
      rosTf("/tf_static", 0, [["base_footprint", "base_link"]]),
    ]);
    const fromTf = addTransformEvents(new Map(), [rosTf("/tf", 1, [["odom", "base_link"]])]);

    // When
    const merged = mergeEntries(fromStatic, fromTf);

    // Then
    expect(merged.get("base_link")?.parent).toBe("odom");
    expect(merged.get("base_link")?.parents).toEqual(["base_footprint", "odom"]);
    expect(merged.get("base_link")?.firstReceiveTime).toBe(0);
  });
});
