// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SettingsTreeAction } from "@lichtblick/suite";

import { ADD_ALL_ACTION, addAllTopics, settingsReducer } from "./settings";
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

  it("adds all missing image topics in sorted order after existing ones", () => {
    const start = { ...DEFAULT_CONFIG, tiles: [makeTile("/z")] };
    const next = settingsReducer(start, nodeAction(ADD_ALL_ACTION, ["general"]), [
      "/a",
      "/b",
      "/z",
    ]);
    expect(topicsOf(next)).toEqual(["/z", "/a", "/b"]);
    expect(addAllTopics(next, ["/a", "/b", "/z"])).toBe(next);
  });

  it("adds a single topic once", () => {
    const next = settingsReducer(config, update(["general", "add"], "/d"), []);
    expect(topicsOf(next)).toEqual(["/a", "/b", "/c", "/d"]);
    expect(settingsReducer(next, update(["general", "add"], "/a"), [])).toEqual(next);
  });

  it("moves and removes tiles", () => {
    expect(topicsOf(settingsReducer(config, nodeAction("move-up", ["topics", "2"]), []))).toEqual([
      "/a",
      "/c",
      "/b",
    ]);
    expect(topicsOf(settingsReducer(config, nodeAction("move-down", ["topics", "0"]), []))).toEqual(
      ["/b", "/a", "/c"],
    );
    const dragged = settingsReducer(
      config,
      { action: "reorder-node", payload: { path: ["topics", "0"], targetPath: ["topics", "2"] } },
      [],
    );
    expect(topicsOf(dragged)).toEqual(["/b", "/c", "/a"]);
    expect(topicsOf(settingsReducer(config, nodeAction("remove", ["topics", "1"]), []))).toEqual([
      "/a",
      "/c",
    ]);
  });

  it("does not switch a tile to a topic already in the grid", () => {
    expect(settingsReducer(config, update(["topics", "0", "topic"], "/b"), [])).toEqual(config);
    expect(topicsOf(settingsReducer(config, update(["topics", "0", "topic"], "/x"), []))).toEqual([
      "/x",
      "/b",
      "/c",
    ]);
  });

  it("treats an empty column count as auto", () => {
    const fixed = settingsReducer(config, update(["general", "columns"], 3), []);
    expect(fixed.columns).toBe(3);
    expect(settingsReducer(fixed, update(["general", "columns"], undefined), []).columns).toBe(
      undefined,
    );
  });
});
