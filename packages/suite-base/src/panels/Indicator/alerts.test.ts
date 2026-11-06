// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  AlertSnapshot,
  describeNotificationPermission,
  getAlertRule,
  getNotificationPermission,
  hasAlert,
  requestNotificationPermission,
  sendTestAlert,
} from "./alerts";
import { notificationSettings } from "./settings";
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

/** A fake `Notification` global with the given permission; records shown notifications. */
function stubNotification(permission: NotificationPermission, afterRequest = permission) {
  const shown: { title: string; options?: NotificationOptions }[] = [];
  const FakeNotification = Object.assign(
    function (title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    },
    {
      permission,
      requestPermission: vi.fn(async () => {
        FakeNotification.permission = afterRequest;
        return afterRequest;
      }),
    },
  );
  vi.stubGlobal("Notification", FakeNotification);
  return { shown, requestPermission: FakeNotification.requestPermission };
}

// alerts.ts keeps the first AudioContext it creates, so all fakes share one spy
const played = vi.fn();

/** A fake `AudioContext` global; `played` counts the notes. */
function stubAudio() {
  played.mockClear();
  const node = () => ({
    connect: (next: unknown) => next,
    frequency: {},
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    start: played,
    stop: vi.fn(),
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      public currentTime = 0;
      public destination = {};
      public resume = async () => {};
      public createOscillator = node;
      public createGain = node;
    },
  );
}

describe("notification permission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the browser permission, or unsupported without notifications", () => {
    stubNotification("denied");
    expect(getNotificationPermission()).toBe("denied");
    vi.stubGlobal("Notification", undefined);
    expect(getNotificationPermission()).toBe("unsupported");
  });

  it("maps every state to a label and whether it can be requested", () => {
    expect(describeNotificationPermission("granted")).toMatchObject({
      label: "Granted",
      canRequest: false,
    });
    expect(describeNotificationPermission("default")).toMatchObject({
      label: "Not asked yet",
      canRequest: true,
    });
    const denied = describeNotificationPermission("denied");
    expect(denied).toMatchObject({ label: "Denied", canRequest: false });
    expect(denied.help).toMatch(/site settings/);
    expect(describeNotificationPermission("unsupported")).toMatchObject({
      label: "Unsupported",
      canRequest: false,
    });
  });

  it("only asks when not asked yet", async () => {
    const asked = stubNotification("default", "granted");
    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(asked.requestPermission).toHaveBeenCalledTimes(1);

    const denied = stubNotification("denied");
    await expect(requestNotificationPermission()).resolves.toBe("denied");
    expect(denied.requestPermission).not.toHaveBeenCalled();
  });

  it("shows the status and request action only while a rule notifies", () => {
    expect(notificationSettings([rules[0]!], "default")).toEqual({});
    const settings = notificationSettings(rules, "default");
    expect(settings.fields?.notificationPermission).toMatchObject({
      value: "Not asked yet",
      readonly: true,
    });
    expect(settings.actions).toEqual([
      expect.objectContaining({ id: "request-notification-permission" }),
    ]);
    expect(notificationSettings(rules, "denied").actions).toEqual([]);
    expect(
      notificationSettings(rules, "denied").fields?.notificationPermission?.error,
    ).toBeDefined();
  });
});

describe("sendTestAlert", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays the rule's sound and shows its notification", async () => {
    stubAudio();
    const { shown } = stubNotification("granted");
    await sendTestAlert({ ...rules[0]!, alertNotify: true }, "/a.data", "tag");
    expect(played).toHaveBeenCalledTimes(3); // the alarm's three notes
    expect(shown).toEqual([
      { title: "/a.data", options: { body: "Test alert: Error", tag: "tag" } },
    ]);
  });

  it("asks for permission first when not asked yet", async () => {
    stubAudio();
    const { shown, requestPermission } = stubNotification("default", "granted");
    await sendTestAlert(rules[1]!, "/a.data", "tag");
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(shown).toHaveLength(1);
  });

  it("skips the notification when it is denied or not enabled for the rule", async () => {
    stubAudio();
    const { shown } = stubNotification("denied");
    await sendTestAlert(rules[1]!, "/a.data", "tag");
    stubNotification("granted");
    await sendTestAlert(rules[0]!, "/a.data", "tag");
    expect(shown).toEqual([]);
    expect(played).toHaveBeenCalledTimes(3);
  });
});
