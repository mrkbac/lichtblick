// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { IndicatorAlertSound, IndicatorRule } from "./types";

/** What the panel showed on one render, used to detect transitions between renders. */
export type AlertSnapshot = {
  /** Index of the matching rule, `-1` for the fallback, `undefined` when there is no data. */
  ruleIndex: number | undefined;
  rules: readonly IndicatorRule[];
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

export function requestNotificationPermission(): void {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

export function showAlertNotification(title: string, body: string): void {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    // `tag` replaces the previous notification of the same panel instead of stacking them
    new Notification(title, { body, tag: `indicator:${title}` });
  }
}
