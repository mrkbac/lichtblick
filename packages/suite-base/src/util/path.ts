// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Browser stand-ins for the POSIX `path` helpers we use, so the bundle needs no `path` polyfill.

/** Last segment of a `/`-separated path, minus `ext` if it ends with it. Same as Node's `path.basename`. */
export function basename(filePath: string, ext?: string): string {
  if (ext != undefined && ext !== "" && ext === filePath) {
    return "";
  }
  const base = filePath.replace(/\/+$/, "").split("/").pop() ?? "";
  return ext != undefined && ext !== "" && ext !== base && base.endsWith(ext)
    ? base.slice(0, -ext.length)
    : base;
}

/** Extension of the last segment including the dot, or "" (also for dotfiles). Same as Node's `path.extname`. */
export function extname(filePath: string): string {
  const base = basename(filePath);
  const dot = base.lastIndexOf(".");
  return dot <= 0 || base === ".." ? "" : base.slice(dot);
}
