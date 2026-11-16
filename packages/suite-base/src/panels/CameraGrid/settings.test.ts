// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SettingsTreeAction } from "@lichtblick/suite";

import { addAllTopics, settingsReducer } from "./settings";
import { CameraGridConfig, DEFAULT_CONFIG, makeTile } from "./types";

const topicsOf = (config: CameraGridConfig) => config.tiles.map((tile) => tile.topic);
const nodeAction = (id: string, path: string[]): SettingsTreeAction => ({
  action: "perform-node-action",
  payload: { id, path },
});
const update = (path: string[], value: unknown): SettingsTreeAction =>
  ({
    action: "update",
    payload: { path, input: "select", value },
  }) as SettingsTreeAction;

describe("settingsReducer", () => {
  const config: CameraGridConfig = { ...DEFAULT_CONFIG, tiles: ["/a", "/b", "/c"].map(makeTile) };

  it("show all adds missing image topics after existing ones and shows every tile", () => {
    const start = { ...DEFAULT_CONFIG, tiles: [{ ...makeTile("/z"), visible: false }] };
    const next = settingsReducer(start, nodeAction("show-all", ["topics"]), ["/a", "/b", "/z"]);
    expect(topicsOf(next)).toEqual(["/z", "/a", "/b"]);
    expect(next.tiles.every((tile) => tile.visible)).toBe(true);
    expect(addAllTopics(next, ["/a", "/b", "/z"])).toBe(next);

    const hidden = settingsReducer(next, nodeAction("hide-all", ["topics"]), []);
    expect(topicsOf(hidden)).toEqual(["/z", "/a", "/b"]);
    expect(hidden.tiles.some((tile) => tile.visible)).toBe(false);
  });

  it("turning on a topic without a tile adds it once", () => {
    const next = settingsReducer(config, update(["topics", "/d", "visible"], true), []);
    expect(topicsOf(next)).toEqual(["/a", "/b", "/c", "/d"]);
    expect(settingsReducer(config, update(["topics", "/d", "visible"], false), [])).toEqual(config);
    const hidden = settingsReducer(next, update(["topics", "/a", "visible"], false), []);
    expect(topicsOf(hidden)).toEqual(["/a", "/b", "/c", "/d"]);
    expect(hidden.tiles[0]!.visible).toBe(false);
  });

  it("moves tiles", () => {
    expect(topicsOf(settingsReducer(config, nodeAction("move-up", ["topics", "/c"]), []))).toEqual([
      "/a",
      "/c",
      "/b",
    ]);
    expect(
      topicsOf(settingsReducer(config, nodeAction("move-down", ["topics", "/a"]), [])),
    ).toEqual(["/b", "/a", "/c"]);
    const dragged = settingsReducer(
      config,
      { action: "reorder-node", payload: { path: ["topics", "/a"], targetPath: ["topics", "/c"] } },
      [],
    );
    expect(topicsOf(dragged)).toEqual(["/b", "/c", "/a"]);
  });

  it("treats an empty column count as auto", () => {
    const fixed = settingsReducer(config, update(["general", "columns"], 3), []);
    expect(fixed.columns).toBe(3);
    expect(settingsReducer(fixed, update(["general", "columns"], undefined), []).columns).toBe(
      undefined,
    );
  });

  it("turns the automatic annotation match into the tile's own pick on the first toggle", () => {
    const start = { ...DEFAULT_CONFIG, tiles: [makeTile("/cam/image")] };
    const available = ["/cam/annotations", "/other/annotations"];
    const path = (topic: string) => ["topics", "/cam/image", "annotations", topic, "visible"];

    const added = settingsReducer(start, update(path("/other/annotations"), true), [], available);
    expect(added.tiles[0]!.annotationTopics).toEqual(["/cam/annotations", "/other/annotations"]);

    const removed = settingsReducer(added, update(path("/cam/annotations"), false), [], available);
    expect(removed.tiles[0]!.annotationTopics).toEqual(["/other/annotations"]);
  });

  it("toggles link zoom and annotation sync", () => {
    const next = settingsReducer(config, update(["general", "linkZoom"], true), []);
    expect(next.linkZoom).toBe(true);
    expect(
      settingsReducer(next, update(["general", "syncAnnotations"], true), []).syncAnnotations,
    ).toBe(true);
  });
});
