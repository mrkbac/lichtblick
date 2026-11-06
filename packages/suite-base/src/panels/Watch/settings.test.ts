// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { WatchConfig } from "./config";
import { buildSettingsTree, replaceRowPaths, settingsReducer } from "./settings";

const config: WatchConfig = {
  sparklines: true,
  flashChanges: true,
  showAge: true,
  staleAfterSec: 2,
  rows: [
    { id: "a", path: "/a.x" },
    { id: "b", path: "/b.x", label: "B" },
    { id: "c", path: "/c.x" },
  ],
};
const ids = (next: WatchConfig) => next.rows.map((row) => row.id);
const t = ((key: string) => key) as unknown as TFunction<"watch">;

describe("Watch settings", () => {
  it("builds one node per row, keyed by id", () => {
    const nodes = buildSettingsTree(config, new Map([["c", "bad"]]), t);
    expect(Object.keys(nodes.rows!.children!)).toEqual(["a", "b", "c"]);
    expect(nodes.rows!.children!.b!.label).toBe("B");
    expect(nodes.rows!.children!.c!.error).toBe("bad");
  });

  it("reorders rows", () => {
    const next = settingsReducer(config, {
      action: "reorder-node",
      payload: { path: ["rows", "c"], targetPath: ["rows", "a"] },
    });
    expect(ids(next)).toEqual(["c", "a", "b"]);
  });

  it("adds, duplicates and removes rows", () => {
    const action = (id: string, path: string[]) =>
      ({
        action: "perform-node-action",
        payload: { id, path },
      }) as const;
    const added = settingsReducer(config, action("add", ["rows"]));
    expect(added.rows).toHaveLength(4);
    const duplicated = settingsReducer(config, action("duplicate", ["rows", "b"]));
    expect(duplicated.rows[2]).toMatchObject({ path: "/b.x", label: "B" });
    expect(duplicated.rows[2]!.id).not.toBe("b");
    expect(ids(settingsReducer(config, action("remove", ["rows", "b"])))).toEqual(["a", "c"]);
  });

  it("updates row fields", () => {
    const update = (path: string[], value: unknown) =>
      settingsReducer(config, {
        action: "update",
        payload: { path, value, input: "string" },
      } as Parameters<typeof settingsReducer>[1]);
    expect(update(["rows", "a", "path"], "/z").rows[0]!.path).toBe("/z");
    expect(update(["rows", "b", "label"], "").rows[1]!.label).toBeUndefined();
    expect(update(["rows", "a", "precision"], 2.6).rows[0]!.precision).toBe(3);
    expect(update(["rows", "a", "unit"], "m").rows[0]!.unit).toBe("m");
    expect(update(["general", "sparklines"], false).sparklines).toBe(false);
    expect(update(["general", "showAge"], false).showAge).toBe(false);
    expect(update(["general", "flashChanges"], false).flashChanges).toBe(false);
  });

  it("sets the stale threshold per panel and per row", () => {
    const update = (path: string[], value: unknown) =>
      settingsReducer(config, {
        action: "update",
        payload: { path, value, input: "number" },
      } as Parameters<typeof settingsReducer>[1]);
    expect(update(["general", "staleAfterSec"], 10).staleAfterSec).toBe(10);
    // Cleared or invalid: keep the panel threshold
    expect(update(["general", "staleAfterSec"], undefined).staleAfterSec).toBe(2);
    expect(update(["rows", "a", "staleAfterSec"], 0.5).rows[0]!.staleAfterSec).toBe(0.5);
    // Cleared: fall back to the panel threshold
    expect(
      update(["rows", "a", "staleAfterSec"], undefined).rows[0]!.staleAfterSec,
    ).toBeUndefined();
    const nodes = buildSettingsTree(config, new Map(), t);
    expect(nodes.rows!.children!.a!.fields!.staleAfterSec!).toMatchObject({ placeholder: "2" });
  });
});

describe("replaceRowPaths", () => {
  it("edits the row in place and adds the other paths after it", () => {
    const rows = replaceRowPaths(config.rows, "b", ["/b.y", "/b.z"]);
    expect(rows.map((row) => row.path)).toEqual(["/a.x", "/b.y", "/b.z", "/c.x"]);
    expect(rows[1]).toMatchObject({ id: "b", label: undefined }); // the label named the old path
    expect(rows[2]!.id).not.toBe("b");
    expect(replaceRowPaths(config.rows, "b", ["/b.x"])[1]!.label).toBe("B");
  });
});
