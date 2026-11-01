// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import type { SourceParams } from "./layers";

// Custom sources are remembered per browser so every Map panel (and every layout) can pick them
// again. The extension API has no app-wide storage, so this uses localStorage.
const STORAGE_KEY = "lichtblick.map.savedSources";
const MAX_SAVED = 30;

export function loadSavedSources(): SourceParams[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? (parsed as SourceParams[]).filter(
          (s) => typeof s.url === "string" && typeof s.kind === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function store(sources: SourceParams[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sources) ?? "[]");
  } catch {
    // Storage unavailable (private mode, quota): saved sources are a convenience only.
  }
}

/** Remember a source, most recent first; the same kind+url replaces the older entry. */
export function rememberSource(source: SourceParams): SourceParams[] {
  const saved = loadSavedSources().filter((s) => !(s.kind === source.kind && s.url === source.url));
  const next = [_.omitBy(source, _.isUndefined) as SourceParams, ...saved].slice(0, MAX_SAVED);
  store(next);
  return next;
}

export function forgetSavedSources(): void {
  store([]);
}
