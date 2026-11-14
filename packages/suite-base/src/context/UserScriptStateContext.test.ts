// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { UserScriptLog } from "@lichtblick/suite-base/players/UserScriptPlayer/types";

import { MAX_USER_SCRIPT_LOGS, appendLogs } from "./UserScriptStateContext";

const logs = (from: number, count: number): UserScriptLog[] =>
  Array.from({ length: count }, (_, i) => ({ source: "processMessage", value: from + i }));

describe("appendLogs", () => {
  it("appends while under the cap", () => {
    expect(appendLogs(logs(0, 2), logs(2, 1)).map((l) => l.value)).toEqual([0, 1, 2]);
  });

  it("keeps only the newest logs", () => {
    let all: readonly UserScriptLog[] = [];
    for (let i = 0; i < 3 * MAX_USER_SCRIPT_LOGS; i += 7) {
      all = appendLogs(all, logs(i, 7));
      expect(all.length).toBeLessThanOrEqual(MAX_USER_SCRIPT_LOGS);
    }
    const values = all.map((l) => l.value as number);
    expect(values).toHaveLength(MAX_USER_SCRIPT_LOGS);
    expect(values.at(-1)).toBe(values[0]! + MAX_USER_SCRIPT_LOGS - 1);
    expect(appendLogs(logs(0, 5), logs(5, MAX_USER_SCRIPT_LOGS + 3)).at(0)?.value).toBe(8);
  });
});
