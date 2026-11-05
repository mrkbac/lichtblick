// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { AlertSnapshot, getAlertRule, hasAlert } from "./alerts";
import { IndicatorRule } from "./types";

const rules: IndicatorRule[] = [
  { operator: "=", rawValue: "1", color: "red", label: "Error", alertSound: "alarm" },
  { operator: "=", rawValue: "2", color: "yellow", label: "Warn", alertNotify: true },
  { operator: "=", rawValue: "0", color: "green", label: "Ok" },
];

function snap(ruleIndex: number | undefined, overrides: Partial<AlertSnapshot> = {}) {
  return { ruleIndex, rules, path: "/a.data", seekCount: 0, ...overrides };
}

describe("getAlertRule", () => {
  it("alerts when transitioning into a rule with an alert", () => {
    expect(getAlertRule(snap(2), snap(0))).toBe(rules[0]);
    expect(getAlertRule(snap(-1), snap(1))).toBe(rules[1]);
  });

  it("does not alert while the same rule keeps matching", () => {
    expect(getAlertRule(snap(0), snap(0))).toBeUndefined();
  });

  it("does not alert for rules without an alert or for the fallback", () => {
    expect(getAlertRule(snap(0), snap(2))).toBeUndefined();
    expect(getAlertRule(snap(0), snap(-1))).toBeUndefined();
  });

  it("does not alert on the first render or when coming from no data", () => {
    expect(getAlertRule(undefined, snap(0))).toBeUndefined();
    expect(getAlertRule(snap(undefined), snap(0))).toBeUndefined();
  });

  it("does not alert on the first render after a seek", () => {
    expect(getAlertRule(snap(2), snap(0, { seekCount: 1 }))).toBeUndefined();
    expect(getAlertRule(snap(0, { seekCount: 1 }), snap(2, { seekCount: 1 }))).toBeUndefined();
    expect(getAlertRule(snap(2, { seekCount: 1 }), snap(0, { seekCount: 1 }))).toBe(rules[0]);
  });

  it("does not alert when the rules or the path were edited", () => {
    expect(getAlertRule(snap(2), snap(0, { rules: [...rules] }))).toBeUndefined();
    expect(getAlertRule(snap(2), snap(0, { path: "/b.data" }))).toBeUndefined();
  });
});

describe("hasAlert", () => {
  it("detects configured alerts", () => {
    expect(rules.map(hasAlert)).toEqual([true, true, false]);
    expect(hasAlert({ ...rules[0]!, alertSound: "none" })).toBe(false);
    expect(hasAlert(undefined)).toBe(false);
  });
});
