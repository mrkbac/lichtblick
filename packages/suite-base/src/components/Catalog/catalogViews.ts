// SPDX-License-Identifier: MPL-2.0

import { subtract, toSec, type Time } from "@foxglove/rostime";

import { isAbsoluteTime } from "@lichtblick/suite-base/util/time";

import { CatalogRecording } from "./types";

export const GROUP_SECTIONS = ["devices", "datasets", "sessions", "episodes"] as const;
export type GroupSection = (typeof GROUP_SECTIONS)[number];
export type TimelineClock = "wall" | "relative";
export type CatalogSection = "recordings" | "timeline" | "events" | GroupSection;

export function groupName(recording: CatalogRecording, section: GroupSection): string | undefined {
  switch (section) {
    case "devices":
      return recording.machine;
    case "datasets":
      return recording.dataset;
    case "sessions":
      return recording.session;
    case "episodes":
      return recording.episode;
  }
}

export function timelineRange(
  recordings: readonly CatalogRecording[],
  clock: TimelineClock,
): { start: Time; end: Time } | undefined {
  const absolute = clock === "wall";
  let range: { start: Time; end: Time } | undefined;
  for (const recording of recordings) {
    const { start, end = start } = recording;
    if (start == undefined || isAbsoluteTime(start) !== absolute) {
      continue;
    }
    const validEnd =
      end != undefined && toSec(subtract(end, start)) >= 0 && isAbsoluteTime(end) === absolute
        ? end
        : start;
    range = {
      start: range == undefined || toSec(subtract(start, range.start)) < 0 ? start : range.start,
      end: range == undefined || toSec(subtract(validEnd, range.end)) > 0 ? validEnd : range.end,
    };
  }
  return range;
}

export function timelineBar(
  recording: CatalogRecording,
  range: { start: Time; end: Time } | undefined,
): { left: string; width: string } | undefined {
  if (
    recording.start == undefined ||
    range == undefined ||
    isAbsoluteTime(recording.start) !== isAbsoluteTime(range.start)
  ) {
    return undefined;
  }
  const span = toSec(subtract(range.end, range.start));
  const position = (time: Time) =>
    span === 0 ? 0 : Math.max(0, Math.min(100, (100 * toSec(subtract(time, range.start))) / span));
  const left = position(recording.start);
  const { end } = recording;
  const right = end && isAbsoluteTime(end) === isAbsoluteTime(range.start) ? position(end) : left;
  return { left: `${left}%`, width: `${Math.max(0, right - left)}%` };
}
