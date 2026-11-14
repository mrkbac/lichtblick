// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { defaultCompareSides } from "@lichtblick/suite-base/util/compareSides";

import { CompareSideInfo } from "./CompareContext";
import { compareSupport } from "./compareView";
import {
  collapsePaths,
  configuredFocus,
  expandPaths,
  expandedSides,
  sidePath,
  unsidePath,
} from "./comparedPaths";
import { SideView } from "./sideView";

type Path = { value: string; label?: string; enabled: boolean; color?: string };

const SIDES = ["/a", "/b"].map(
  (prefix, index): CompareSideInfo => ({
    prefix,
    name: prefix,
    start: { sec: 0, nsec: 0 },
    end: { sec: 1, nsec: 0 },
    sharedStart: { sec: 0, nsec: 0 },
    offsetSec: 0,
    index,
    label: index === 0 ? "A" : "B",
    color: index === 0 ? "blue" : "orange",
    view: new SideView(prefix, ["/a", "/b"]),
  }),
);
const PREFIXES = ["/a", "/b"];
const style = (_path: Path, side: CompareSideInfo) => ({ color: side.color });
const isTopicPath = (path: Path) => Number.isNaN(Number(path.value));

describe("sidePath", () => {
  it("prefixes the topic of a path, quoting it when needed", () => {
    expect(sidePath("/odom.pose.x", "/b")).toEqual("/b/odom.pose.x");
    expect(sidePath('"/my.topic".x', "/b")).toEqual('"/b/my.topic".x');
    expect(sidePath("/b/odom.x", "/b")).toEqual("/b/odom.x");
    expect(unsidePath("/b/odom.pose.x", PREFIXES)).toEqual("/odom.pose.x");
    expect(unsidePath('"/b/my.topic".x', PREFIXES)).toEqual('"/my.topic".x');
    expect(unsidePath("/odom.x", PREFIXES)).toEqual("/odom.x");
  });
});

describe("expandPaths and collapsePaths", () => {
  const configured: Path[] = [
    { value: "/odom.speed", enabled: true },
    { value: "3", enabled: true, label: "limit" },
    { value: "/imu.z", enabled: true, label: "Z", color: "red" },
  ];

  it("draws each topic path once per side; other paths stay single", () => {
    const expanded = expandPaths(configured, SIDES, style, isTopicPath);
    expect(expanded.map((path) => [path.value, path.label, path.color])).toEqual([
      ["/a/odom.speed", undefined, "blue"],
      ["/b/odom.speed", undefined, "orange"],
      ["3", "limit", undefined],
      ["/a/imu.z", "Z (A)", "blue"],
      ["/b/imu.z", "Z (B)", "orange"],
    ]);
  });

  it("gives back the configured paths when nothing was edited", () => {
    const expanded = expandPaths(configured, SIDES, style, isTopicPath);
    expect(collapsePaths(expanded, configured, PREFIXES)).toEqual(configured);
  });

  it("applies an edit made to any side to the configured path", () => {
    const expanded = expandPaths(configured, SIDES, style, isTopicPath);
    const edited = expanded.map((path, index) =>
      index === 4 ? { ...path, enabled: false, value: "/b/imu.y" } : path,
    );
    expect(collapsePaths(edited, configured, PREFIXES)).toEqual([
      configured[0],
      configured[1],
      { value: "/imu.y", enabled: false, label: "Z", color: "red" },
    ]);
  });

  it("keeps paths added while expanded, without a side prefix", () => {
    const expanded = expandPaths(configured, SIDES, style, isTopicPath);
    const added = [...expanded, { value: "/a/gps.lat", enabled: true }];
    expect(collapsePaths(added, configured, PREFIXES).at(-1)).toEqual({
      value: "/gps.lat",
      enabled: true,
    });
  });

  it("drops a configured path when any of its sides was removed", () => {
    const expanded = expandPaths(configured, SIDES, style, isTopicPath);
    expect(collapsePaths(expanded.slice(0, 3), configured, PREFIXES)).toEqual(
      configured.slice(0, 2),
    );
    expect(collapsePaths([...expanded.slice(0, 3), expanded[4]!], configured, PREFIXES)).toEqual(
      configured.slice(0, 2),
    );
  });

  it("keeps a path that names a side single, and keeps its prefix", () => {
    const own: Path[] = [{ value: "/a/odom.x", enabled: true }];
    const expanded = expandPaths(own, SIDES, style, isTopicPath);
    expect(expanded.map((path) => path.value)).toEqual(["/a/odom.x"]);
    expect(collapsePaths(expanded, own, PREFIXES)).toEqual(own);
  });

  it("points settings focus at the configured path", () => {
    const expanded = expandPaths(configured, SIDES, style, isTopicPath);
    expect(configuredFocus(["paths", "4", "color"], expanded)).toEqual(["paths", "2", "color"]);
    expect(configuredFocus(["general"], expanded)).toEqual(["general"]);
  });
});

describe("defaultCompareSides", () => {
  const file = (name: string, folder?: string) =>
    ({ name, webkitRelativePath: folder ? `${folder}/${name}` : "" }) as File;

  it("compares folders when the files come from several, else each file", () => {
    expect(
      defaultCompareSides([file("1.mcap", "run1"), file("2.mcap", "run1"), file("1.mcap", "run2")]),
    ).toEqual(["run1", "run1", "run2"]);
    expect(defaultCompareSides([file("x.mcap", "run1"), file("y.mcap", "run1")])).toEqual([
      "x.mcap",
      "y.mcap",
    ]);
    expect(defaultCompareSides([file("x.mcap"), file("x.mcap")])).toEqual(["x.mcap", "x.mcap (2)"]);
    expect(
      defaultCompareSides([file("recording.mcap"), file("recording.mcap"), file("other.mcap")]),
    ).toEqual(["recording.mcap", "recording.mcap (2)", "other.mcap"]);
    expect(
      defaultCompareSides([file("a.mcap", "run.mcap"), file("b.mcap", "other"), file("run.mcap")]),
    ).toEqual(["run.mcap", "other", "run.mcap (2)"]);
    expect(defaultCompareSides([file("e.mcap"), file("e.mcap"), file("e.mcap (2)")])).toEqual([
      "e.mcap",
      "e.mcap (2)",
      "e.mcap (2) (2)",
    ]);
  });
});

describe("compareSupport", () => {
  it("shows a plot with a panel-wide x path as one copy per recording", () => {
    expect(compareSupport("Plot", { xAxisVal: "timestamp" }).mode).toEqual("native");
    expect(compareSupport("Plot", { xAxisVal: "custom" }).mode).toEqual("copies");
    expect(compareSupport("Plot", { xAxisVal: "currentCustom" }).mode).toEqual("copies");
    expect(compareSupport("Tab").mode).toEqual("none");
  });

  it("expands the paths of a plot only when it draws every recording itself", () => {
    const compare = { sides: SIDES, activeSide: "/a", setActiveSide: vi.fn() } as never;
    const all = { compareView: { show: "all" } };
    expect(expandedSides("Plot", { ...all, xAxisVal: "timestamp" }, compare)).toBe(SIDES);
    // Its copies each show one recording, with the panel-wide x path of that recording
    expect(expandedSides("Plot", { ...all, xAxisVal: "custom" }, compare)).toBeUndefined();
    expect(expandedSides("Plot", { ...all, xAxisVal: "currentCustom" }, compare)).toBeUndefined();
    expect(expandedSides("Plot", { xAxisVal: "timestamp" }, undefined)).toBeUndefined();
  });
});
