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
  it("reads ROS TFMessage and strips leading slashes", () => {
    const event = rosTf("/tf", 1, [["/map", "odom"]]);
    expect(samplesFromMessage(event.schemaName, event.message)).toEqual([
      {
        parent: "map",
        child: "odom",
        translation: { x: 1, y: 2, z: 3 },
        rotation: IDENTITY,
        stamp: 1,
      },
    ]);
  });

  it("reads foxglove FrameTransforms", () => {
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
    expect(samplesFromMessage("foxglove.FrameTransforms", message)).toMatchObject([
      { parent: "base_link", child: "lidar", stamp: 2.5 },
    ]);
  });
});

describe("quaternionToRpy", () => {
  it("converts a 90° yaw", () => {
    const rpy = quaternionToRpy({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
    expect(rpy.x).toBeCloseTo(0);
    expect(rpy.y).toBeCloseTo(0);
    expect(rpy.z).toBeCloseTo(Math.PI / 2);
  });
});

describe("buildRows", () => {
  it("builds a depth-first tree with sorted children and static frames", () => {
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

    const result = rows(entries, 1.2);
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

  it("hides children of collapsed frames", () => {
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [
        ["map", "odom"],
        ["odom", "base_link"],
      ]),
    ]);
    expect(rows(entries, 1, ["odom"]).map((row) => row.frame)).toEqual(["map", "odom"]);
  });

  it("flags frames with several parents", () => {
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [["map", "base_link"]]),
      rosTf("/tf", 2, [["odom", "base_link"]]),
    ]);
    const baseLink = rows(entries, 2).find((row) => row.frame === "base_link");
    expect(baseLink?.warnings).toContain("multipleParents");
    expect(baseLink?.entry?.parent).toBe("odom");
  });

  it("flags stale dynamic frames but never static ones", () => {
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [["map", "odom"]]),
      rosTf("/tf", 1.1, [["map", "odom"]]),
      rosTf("/tf_static", 0, [["odom", "base_link"]]),
    ]);
    const result = rows(entries, 5);
    expect(result.find((row) => row.frame === "odom")?.warnings).toEqual(["stale"]);
    expect(result.find((row) => row.frame === "base_link")?.warnings).toEqual([]);
  });

  it("keeps known frames without current data as noData", () => {
    const known = addTransformEvents(new Map(), [rosTf("/tf", 1, [["map", "odom"]])]);
    const result = buildRows({
      current: new Map(),
      known,
      now: 2,
      collapsed: new Set(),
      staticTopics: new Set(),
    });
    expect(result.find((row) => row.frame === "odom")?.warnings).toEqual(["noData"]);
  });

  it("does not warn about frames that are only published later, e.g. after looping", () => {
    // Seen on a previous pass: odom from t=1, base_link only from t=5.
    const known = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [["map", "odom"]]),
      rosTf("/tf", 5, [["odom", "base_link"]]),
    ]);
    // Looped back to the start: nothing received yet this pass.
    const result = buildRows({
      current: new Map(),
      known,
      now: 2,
      collapsed: new Set(),
      staticTopics: new Set(),
    });
    const odom = result.find((row) => row.frame === "odom");
    const baseLink = result.find((row) => row.frame === "base_link");
    expect(odom).toMatchObject({ notYetPublished: false, warnings: ["noData"] });
    expect(baseLink).toMatchObject({ notYetPublished: true, warnings: [] });
  });

  it("still shows frames that form a cycle", () => {
    const entries = addTransformEvents(new Map(), [
      rosTf("/tf", 1, [
        ["a", "b"],
        ["b", "a"],
      ]),
    ]);
    expect(rows(entries, 1).map((row) => row.frame)).toEqual(["a", "b"]);
  });
});

describe("mergeEntries", () => {
  it("keeps parents from both maps", () => {
    const fromStatic = addTransformEvents(new Map(), [
      rosTf("/tf_static", 0, [["base_footprint", "base_link"]]),
    ]);
    const fromTf = addTransformEvents(new Map(), [rosTf("/tf", 1, [["odom", "base_link"]])]);
    const merged = mergeEntries(fromStatic, fromTf);
    expect(merged.get("base_link")?.parent).toBe("odom");
    expect(merged.get("base_link")?.parents).toEqual(["base_footprint", "odom"]);
    expect(merged.get("base_link")?.firstReceiveTime).toBe(0);
  });
});
