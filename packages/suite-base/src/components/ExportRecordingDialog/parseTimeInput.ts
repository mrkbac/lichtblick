// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const UNIT_NS: Record<string, bigint> = {
  ns: 1n,
  us: 1_000n,
  ms: 1_000_000n,
  s: 1_000_000_000n,
  m: 60_000_000_000n,
  h: 3_600_000_000_000n,
};

/** "1.5" with unit ns-per-unit -> exact ns, without floating point loss. */
function decimalToNs(decimal: string, unitNs: bigint): bigint {
  const [whole = "0", fraction = ""] = decimal.split(".");
  const digits = fraction.length;
  const scaled = BigInt((whole || "0") + fraction) * unitNs;
  return scaled / 10n ** BigInt(digits);
}

const DURATION_RE = /^(\d*\.?\d+)\s*(ns|us|ms|s|m|h)?$/;
const CLOCK_RE = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/;
// Below this a bare number is seconds into the recording; above it, seconds since the epoch.
const EPOCH_SECONDS_MIN = 100_000_000;

/** "1.5s", "500ms", "2m", "1:23.5", or bare seconds -> ns. */
function parseDuration(text: string): bigint | undefined {
  const clock = CLOCK_RE.exec(text);
  if (clock) {
    const [, hours = "0", minutes = "0", seconds = "0"] = clock;
    return (
      BigInt(hours) * UNIT_NS.h! + BigInt(minutes) * UNIT_NS.m! + decimalToNs(seconds, UNIT_NS.s!)
    );
  }
  const match = DURATION_RE.exec(text);
  if (!match) {
    return undefined;
  }
  return decimalToNs(match[1]!, UNIT_NS[match[2] ?? "s"]!);
}

/**
 * Parses a time typed or pasted into the export range fields, in the spirit of pymcap-cli's
 * `--start`/`--end`. Returns absolute ns, or undefined if the text isn't understood.
 *
 * - `12.5`, `1:23.5`, `500ms`, `2m`: offset from the recording start
 * - `+5s` / `start+5s` / `@5s`: offset from the start; `-30s` / `end-30s`: before the end
 * - `start`, `end`
 * - `1758901965.015`: seconds since the epoch; `1758901965015000000`: ns since the epoch
 * - `2025-09-26T15:52:45.5Z`: an RFC 3339 date
 */
export function parseTimeInput(
  input: string,
  recordingStart: bigint,
  recordingEnd: bigint,
): bigint | undefined {
  const text = input.trim().replace(",", ".");
  if (text === "") {
    return undefined;
  }

  const anchored = /^(start|end|@)?\s*([+-])?\s*(.*)$/.exec(text);
  const anchor = anchored?.[1];
  const sign = anchored?.[2];
  const rest = anchored?.[3] ?? "";
  if (anchor === "start" || anchor === "end") {
    const base = anchor === "start" ? recordingStart : recordingEnd;
    if (rest === "") {
      return base;
    }
    const offset = sign ? parseDuration(rest) : undefined;
    return offset == undefined ? undefined : sign === "-" ? base - offset : base + offset;
  }
  if (anchor === "@" || sign === "+") {
    const offset = parseDuration(rest);
    return offset == undefined ? undefined : recordingStart + offset;
  }
  if (sign === "-") {
    const offset = parseDuration(rest);
    return offset == undefined ? undefined : recordingEnd - offset;
  }

  if (/^\d+(\.\d+)?$/.test(text)) {
    // Integer nanoseconds since the epoch (pymcap-cli's default unit).
    if (/^\d{16,}$/.test(text)) {
      return BigInt(text);
    }
    if (Number(text) >= EPOCH_SECONDS_MIN) {
      return decimalToNs(text, UNIT_NS.s!);
    }
  }

  const offset = parseDuration(text);
  if (offset != undefined) {
    return recordingStart + offset;
  }

  // RFC 3339 / ISO 8601. Date only has ms precision, so keep the fraction ourselves.
  const iso = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (iso) {
    const ms = Date.parse(`${iso[1]}${iso[3] ?? "Z"}`);
    if (!Number.isNaN(ms)) {
      return BigInt(ms) * UNIT_NS.ms! + decimalToNs(`0.${iso[2] ?? "0"}`, UNIT_NS.s!);
    }
  }
  return undefined;
}
