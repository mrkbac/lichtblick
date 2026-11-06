// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { SettingsTreeAction, SettingsTreeNodes } from "@lichtblick/suite";

import { WatchConfig, WatchRow, newRow, validStaleAfter } from "./config";

export function buildSettingsTree(
  config: WatchConfig,
  rowErrors: ReadonlyMap<string, string>,
  t: TFunction<"watch">,
): SettingsTreeNodes {
  const children: SettingsTreeNodes = {};
  for (const row of config.rows) {
    children[row.id] = {
      label: row.label ?? row.path,
      reorderable: true,
      defaultExpansionState: "collapsed",
      error: rowErrors.get(row.id),
      actions: [
        { type: "action", id: "duplicate", label: t("duplicate"), icon: "Add" },
        { type: "action", id: "remove", label: t("remove"), icon: "Delete", display: "inline" },
      ],
      fields: {
        path: {
          label: t("path"),
          input: "messagepath",
          value: row.path,
          supportsMathModifiers: true,
          supportsStreamModifiers: true,
        },
        label: { label: t("label"), input: "string", value: row.label, placeholder: row.path },
        precision: {
          label: t("precision"),
          input: "number",
          min: 0,
          max: 15,
          step: 1,
          precision: 0,
          placeholder: t("auto"),
          value: row.precision,
        },
        unit: { label: t("unit"), input: "string", value: row.unit },
        staleAfterSec: {
          label: t("staleAfter"),
          input: "number",
          min: 0,
          step: 1,
          placeholder: String(config.staleAfterSec),
          value: row.staleAfterSec,
        },
      },
    };
  }
  return {
    general: {
      label: t("general"),
      fields: {
        sparklines: { label: t("sparklines"), input: "boolean", value: config.sparklines },
        flashChanges: { label: t("flashChanges"), input: "boolean", value: config.flashChanges },
        showAge: { label: t("showAge"), input: "boolean", value: config.showAge },
        staleAfterSec: {
          label: t("staleAfter"),
          help: t("staleAfterHelp"),
          input: "number",
          min: 0,
          step: 1,
          value: config.staleAfterSec,
        },
      },
    },
    rows: {
      label: t("rows"),
      actions: [{ type: "action", id: "add", label: t("addRow"), icon: "Add", display: "inline" }],
      children,
    },
  };
}

export function moveRow(rows: readonly WatchRow[], fromId: string, toId: string): WatchRow[] {
  const from = rows.findIndex((row) => row.id === fromId);
  const to = rows.findIndex((row) => row.id === toId);
  if (from === -1 || to === -1 || from === to) {
    return [...rows];
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function duplicateRow(
  rows: readonly WatchRow[],
  id: string,
  newId: string = newRow("").id,
): WatchRow[] {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) {
    return [...rows];
  }
  const next = [...rows];
  next.splice(index + 1, 0, { ...rows[index]!, id: newId });
  return next;
}

/** Put `paths` in place of a row: the first keeps the row's settings, the rest follow as new rows. */
export function replaceRowPaths(
  rows: readonly WatchRow[],
  id: string,
  paths: readonly string[],
): WatchRow[] {
  return rows.flatMap((row) => {
    if (row.id !== id || paths.length === 0) {
      return [row];
    }
    const [first, ...rest] = paths;
    // A label named the old path, so it goes when the path changes
    const label = first === row.path ? row.label : undefined;
    return [{ ...row, path: first!, label }, ...rest.map(newRow)];
  });
}

export function settingsReducer(config: WatchConfig, action: SettingsTreeAction): WatchConfig {
  const { path } = action.payload;
  if (action.action === "reorder-node") {
    return { ...config, rows: moveRow(config.rows, path[1]!, action.payload.targetPath[1]!) };
  }
  if (action.action === "perform-node-action") {
    switch (action.payload.id) {
      case "add":
        return { ...config, rows: [...config.rows, newRow("")] };
      case "duplicate":
        return { ...config, rows: duplicateRow(config.rows, path[1]!) };
      case "remove":
        return { ...config, rows: config.rows.filter((row) => row.id !== path[1]) };
    }
    return config;
  }

  const { value } = action.payload;
  if (path[0] === "general") {
    switch (path[1]) {
      case "sparklines":
        return { ...config, sparklines: value === true };
      case "flashChanges":
        return { ...config, flashChanges: value === true };
      case "showAge":
        return { ...config, showAge: value === true };
      case "staleAfterSec":
        return { ...config, staleAfterSec: validStaleAfter(value) ?? config.staleAfterSec };
    }
    return config;
  }
  if (path[0] !== "rows") {
    return config;
  }
  const rows = config.rows.map((row): WatchRow => {
    if (row.id !== path[1]) {
      return row;
    }
    switch (path[2]) {
      case "path":
        return { ...row, path: typeof value === "string" ? value : "" };
      case "label":
      case "unit":
        return { ...row, [path[2]]: typeof value === "string" && value !== "" ? value : undefined };
      case "precision":
        return {
          ...row,
          precision:
            typeof value === "number" && value >= 0 ? Math.min(Math.round(value), 15) : undefined,
        };
      case "staleAfterSec":
        return { ...row, staleAfterSec: validStaleAfter(value) };
    }
    return row;
  });
  return { ...config, rows };
}
