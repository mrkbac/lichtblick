// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { IndicatorAlertSound, IndicatorRule } from "./types";

/** What the panel showed on one render, used to detect transitions between renders. */
export type AlertSnapshot = {
  /** Index of the matching rule, `-1` for the fallback, `undefined` when there is no data. */
  ruleIndex: number | undefined;
  rules: readonly IndicatorRule[];
  path: string;
  /** Incremented on every seek so the first render after a seek only sets a new baseline. */
  seekCount: number;
};

export function hasAlert(rule: IndicatorRule | undefined): boolean {
  return (rule?.alertSound ?? "none") !== "none" || rule?.alertNotify === true;
}

/**
 * Returns the rule to alert for when the panel transitioned into it, otherwise undefined.
 * Never alerts on the first render, after a seek, after a rule edit, or when the previous
 * render had no data (e.g. right after connecting or loading a recording).
 */
export function getAlertRule(
  prev: AlertSnapshot | undefined,
  next: AlertSnapshot,
): IndicatorRule | undefined {
  if (
    prev?.rules !== next.rules ||
    prev.path !== next.path ||
    prev.seekCount !== next.seekCount ||
    prev.ruleIndex == undefined ||
    next.ruleIndex == undefined ||
    prev.ruleIndex === next.ruleIndex
  ) {
    return undefined;
  }
  const rule = next.rules[next.ruleIndex];
  return hasAlert(rule) ? rule : undefined;
}

// [frequency Hz, start s, duration s] per note
const TONES: Record<
  Exclude<IndicatorAlertSound, "none">,
  [OscillatorType, [number, number, number][]]
> = {
  beep: ["sine", [[880, 0, 0.15]]],
  chime: [
    "sine",
    [
      [660, 0, 0.2],
      [990, 0.15, 0.35],
    ],
  ],
  alarm: [
    "square",
    [
      [1000, 0, 0.1],
      [1000, 0.18, 0.1],
      [1000, 0.36, 0.1],
    ],
  ],
};

let audioContext: AudioContext | undefined;

export function playAlertSound(sound: IndicatorAlertSound | undefined): void {
  if (sound == undefined || sound === "none" || typeof AudioContext === "undefined") {
    return;
  }
  audioContext ??= new AudioContext();
  const ctx = audioContext;
  void ctx.resume();
  const [type, notes] = TONES[sound];
  for (const [frequency, start, duration] of notes) {
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    // short attack/release to avoid clicks
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }
}

/** Browser notification permission, or "unsupported" where the browser has no notifications. */
export type NotificationPermissionState = NotificationPermission | "unsupported";

export function getNotificationPermission(): NotificationPermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** How the settings show a permission state, and what the user can do about it. */
export function describeNotificationPermission(state: NotificationPermissionState): {
  label: string;
  help: string;
  canRequest: boolean;
} {
  switch (state) {
    case "granted":
      return {
        label: "Granted",
        help: "Rules with Notify show browser notifications",
        canRequest: false,
      };
    case "denied":
      return {
        label: "Denied",
        help: "Blocked for this site. Allow notifications in the browser's site settings (the icon left of the address), then reload",
        canRequest: false,
      };
    case "default":
      return {
        label: "Not asked yet",
        help: "Use Request permission so Notify can show browser notifications",
        canRequest: true,
      };
    case "unsupported":
      return {
        label: "Unsupported",
        help: "This browser can't show notifications; sounds still play",
        canRequest: false,
      };
  }
}

/** Asks for notification permission if it wasn't asked yet; resolves to the resulting state. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (getNotificationPermission() === "default") {
    return await Notification.requestPermission();
  }
  return getNotificationPermission();
}

/** `tag` should identify the panel so its notifications replace each other instead of stacking. */
export function showAlertNotification(title: string, body: string, tag: string): void {
  // oxlint-disable-next-line typescript/prefer-optional-chain -- `Notification?.x` throws where the global is missing
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag });
    } catch (error: unknown) {
      // e.g. Chrome on Android only allows notifications from a service worker
      console.warn("Indicator notification failed", error);
    }
  }
}

/** Fire a rule's sound and notification right away, so users can check alerts work. */
export async function sendTestAlert(
  rule: IndicatorRule,
  title: string,
  tag: string,
): Promise<void> {
  playAlertSound(rule.alertSound);
  if (rule.alertNotify === true && (await requestNotificationPermission()) === "granted") {
    showAlertNotification(title, `Test alert: ${rule.label}`, tag);
  }
}
