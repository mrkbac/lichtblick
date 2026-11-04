// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import filterMessages, { compileSearch, LogFilter } from "./filterMessages";
import { LogLevel, NormalizedLogMessage } from "./types";

function item(level: LogLevel, message: string, name?: string): NormalizedLogMessage {
  return {
    topic: "/log",
    receiveTime: { sec: 0, nsec: 0 },
    stamp: { sec: 0, nsec: 0 },
    level,
    message,
    name,
  };
}

const items = [
  item(LogLevel.DEBUG, "Couldn't find int 83757.", "/some_topic"),
  item(LogLevel.INFO, "Couldn't find int 2121.", "/other_node"),
  item(LogLevel.WARN, "Lost connection", "/some_topic"),
  item(LogLevel.ERROR, "Planner FAILED", "/planner"),
  item(LogLevel.UNKNOWN, "no level"),
];

function run(
  terms: string[],
  options: Partial<LogFilter> & Parameters<typeof compileSearch>[1] = {},
) {
  return filterMessages(items, {
    minLogLevel: options.minLogLevel ?? LogLevel.DEBUG,
    nameFilter: options.nameFilter ?? {},
    search: compileSearch(terms, options),
  }).map((i) => i.message);
}

describe("filterMessages", () => {
  it("returns the same array when nothing is filtered", () => {
    expect(
      filterMessages(items, {
        minLogLevel: 1,
        nameFilter: {},
        search: compileSearch([], {}),
      }),
    ).toBe(items);
  });

  it("filters by minimum level", () => {
    expect(run([], { minLogLevel: LogLevel.WARN })).toEqual(["Lost connection", "Planner FAILED"]);
  });

  it("hides node names that are not visible", () => {
    expect(run([], { nameFilter: { "/some_topic": { visible: false } } })).toEqual([
      "Couldn't find int 2121.",
      "Planner FAILED",
      "no level",
    ]);
  });

  it("matches any include term in message or name, case-insensitively by default", () => {
    expect(run(["failed", "OTHER"])).toEqual(["Couldn't find int 2121.", "Planner FAILED"]);
  });

  it("supports case-sensitive search", () => {
    expect(run(["failed"], { caseSensitive: true })).toEqual([]);
    expect(run(["FAILED"], { caseSensitive: true })).toEqual(["Planner FAILED"]);
  });

  it("excludes -terms", () => {
    expect(run(["-couldn't"])).toEqual(["Lost connection", "Planner FAILED", "no level"]);
    expect(run(["find", "-2121"])).toEqual(["Couldn't find int 83757."]);
  });

  it("treats a lone '-' as a literal term", () => {
    expect(run(["-"])).toEqual([]);
  });

  it("supports regular expressions", () => {
    expect(run(["int \\d{4}\\.$"], { regex: true })).toEqual(["Couldn't find int 2121."]);
    expect(run(["^/p"], { regex: true })).toEqual(["Planner FAILED"]);
    expect(run(["-^couldn"], { regex: true })).toEqual([
      "Lost connection",
      "Planner FAILED",
      "no level",
    ]);
  });

  it("reports and ignores invalid regular expressions", () => {
    const search = compileSearch(["(", "lost"], { regex: true });
    expect(search.invalidTerms).toEqual(["("]);
    expect(search.include).toHaveLength(1);
  });
});
