// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import nodePath from "node:path";

import { basename, extname } from "./path";

const PATHS = [
  "example.mcap",
  "/data/example.mcap",
  "/data/example.bag/",
  "archive.tar.gz",
  ".bashrc",
  "/data/.hidden.mcap",
  "noext",
  "trailing.",
  "..",
  "...",
  "....",
  ".",
  "",
  "/",
  "a//b//c.json",
];

describe("path helpers match node:path (posix)", () => {
  it.each(PATHS)("%j", (p) => {
    expect(basename(p)).toBe(nodePath.posix.basename(p));
    expect(extname(p)).toBe(nodePath.posix.extname(p));
    expect(basename(p, p)).toBe(nodePath.posix.basename(p, p));
    expect(basename(p, "example.mcap")).toBe(nodePath.posix.basename(p, "example.mcap"));
    expect(basename(p, ".mcap")).toBe(nodePath.posix.basename(p, ".mcap"));
    expect(basename(p, extname(p))).toBe(nodePath.posix.basename(p, nodePath.posix.extname(p)));
  });
});
