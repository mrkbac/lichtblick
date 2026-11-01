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

import { Time, toDate, fromDate } from "@foxglove/rostime";

import { TimeDisplayMethod } from "@lichtblick/suite-base/types/panels";

import parseFuzzyRosTime from "./parseFuzzyRosTime";

export function guessTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function dateParts(date: Date, timezone: string): Record<Intl.DateTimeFormatPartTypes, string> {
  let formatter = partsFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h12",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      timeZoneName: "short",
    });
    partsFormatters.set(timezone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value])) as Record<
    Intl.DateTimeFormatPartTypes,
    string
  >;
}

/** Abbreviation such as "PST", or "GMT+7" where CLDR has no short name. */
export function timezoneAbbreviation(timezone: string, date = new Date()): string {
  return dateParts(date, timezone).timeZoneName;
}

/** Offset of `timezone` from UTC in minutes at `date`. */
export function timezoneOffsetMinutes(timezone: string, date = new Date()): number {
  const p = dateParts(date, timezone);
  const hour = (Number(p.hour) % 12) + (p.dayPeriod === "PM" ? 12 : 0);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** h:mm:ss with unpadded hours, plus .SSS when `withMillis` is set. */
export function formatHms(
  totalMs: number,
  { withMillis = true }: { withMillis?: boolean } = {},
): string {
  const sign = totalMs < 0 ? "-" : "";
  const ms = Math.abs(totalMs);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const hms = `${Math.floor(ms / 3_600_000)}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}`;
  return `${sign}${hms}${withMillis ? `.${pad(ms % 1000, 3)}` : ""}`;
}

export function format(stamp: Time, timezone?: string): string {
  return `${formatDate(stamp, timezone)} ${formatTime(stamp, timezone)}`;
}

export function formatDate(stamp: Time, timezone?: string): string {
  if (stamp.sec < 0 || stamp.nsec < 0) {
    console.error("Times are not allowed to be negative");
    return "(invalid negative time)";
  }
  const p = dateParts(toDate(stamp), timezone ?? guessTimezone());
  return `${p.year}-${p.month}-${p.day}`;
}

export function formatTime(stamp: Time, timezone?: string): string {
  if (stamp.sec < 0 || stamp.nsec < 0) {
    console.error("Times are not allowed to be negative");
    return "(invalid negative time)";
  }
  const p = dateParts(toDate(stamp), timezone ?? guessTimezone());
  return `${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond} ${p.dayPeriod} ${p.timeZoneName}`;
}

export function formatDuration(stamp: Time): string {
  return formatHms(Math.round(stamp.sec * 1000 + stamp.nsec / 1e6));
}

const timeStrRegex =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(?:\s*([AaPp][Mm]))?/;

/**
 * Parses "YYYY-MM-DD[ h:mm[:ss[.SSS]]][ A][ zone]" as wall time in `timezone`. Without AM/PM the
 * hour is 24-hour; extra fraction digits and the zone name are ignored.
 */
export function parseTimeStr(str: string, timezone?: string): Time | undefined {
  const m = timeStrRegex.exec(str);
  if (!m) {
    return undefined;
  }
  const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0", ampm] = m;
  const hour24 =
    ampm == undefined ? Number(hour) : (Number(hour) % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
  const millis = Number(fraction.slice(0, 3).padEnd(3, "0"));
  const wallMs = Date.UTC(+year!, +month! - 1, +day!, hour24, +minute, +second, millis);
  if (isNaN(wallMs)) {
    return undefined;
  }
  const tz = timezone ?? guessTimezone();
  // Resolve the offset at the guessed instant, then again in case it crossed a DST change.
  let ms = wallMs - timezoneOffsetMinutes(tz, new Date(wallMs)) * 60_000;
  ms = wallMs - timezoneOffsetMinutes(tz, new Date(ms)) * 60_000;
  const result = fromDate(new Date(ms));
  if (result.sec <= 0 || result.nsec < 0) {
    return undefined;
  }
  return result;
}

const todDateTimeRegex = /^\d+-\d+-\d+\s+\d+:\d+:\d+.\d+\s[PpAa][Mm]\s[A-Za-z$]+/;
export const getValidatedTimeAndMethodFromString = ({
  text,
  timezone,
}: {
  text?: string;
  timezone?: string;
}): { time?: Time; method: TimeDisplayMethod } | undefined => {
  if (text == undefined || text === "") {
    return;
  }
  const isInvalidRawTime = isNaN(+text);
  const isInvalidTodTime = !(todDateTimeRegex.test(text) && parseTimeStr(text, timezone));

  if (isInvalidRawTime && isInvalidTodTime) {
    return;
  }

  return {
    time: !isInvalidRawTime ? parseFuzzyRosTime(text) : parseTimeStr(text, timezone),
    method: isInvalidRawTime ? "TOD" : "SEC",
  };
};
