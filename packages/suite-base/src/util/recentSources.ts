// SPDX-License-Identifier: MPL-2.0

import type { DataSourceArgs } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import type { RecentRecord } from "@lichtblick/suite-base/hooks/useIndexedDbRecents";

type FileRecent = Extract<RecentRecord, { type: "file" }>;

type ConnectionRecent = Pick<
  Extract<RecentRecord, { type: "connection" }>,
  "sourceId" | "extra" | "urls"
>;

export function connectionRecentArgs(
  recent: ConnectionRecent,
): Extract<DataSourceArgs, { type: "connection" }> {
  if (!["remote-file", "mcap-remote-file", "ros1-remote-bagfile"].includes(recent.sourceId)) {
    return { type: "connection", params: recent.extra, urls: recent.urls };
  }
  const { url, ...params } = recent.extra ?? {};
  // Only older recents saved a comma-joined list. New inputs and stored lists stay untouched.
  const urls = recent.urls ?? url?.split(/,(?=[a-z][a-z\d+.-]*:\/\/)/i);
  return { type: "connection", params, urls };
}

/** Reopens a file recent as it was opened: compared side by side when it was */
export function recentArgs(recent: FileRecent): Extract<DataSourceArgs, { type: "file" }> {
  return { type: "file", handles: recent.handles, compare: recent.compare };
}

/**
 * Title of a file recent: its file names, each once. A comparison leads with its side names, e.g.
 * `A vs B (base.mcap, a.mcap, b.mcap)`, or just `a.mcap vs b.mcap` when each side is one file
 * named like the side.
 */
export function recentFileTitle(names: readonly string[], compare?: readonly string[]): string {
  const files = [...new Set(names)].join(", ");
  if (!compare) {
    return files;
  }
  const sides = [...new Set(compare)];
  const plain = sides.length === names.length && names.every((name, i) => name === compare[i]);
  return plain ? sides.join(" vs ") : `${sides.join(" vs ")} (${files})`;
}

const REMOTE_FILE_EXTENSIONS = [".mcap", ".bag"];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Split a recent source title into the part that identifies it (file name or host) and the
 * surrounding location, so lists of similar URLs stay distinguishable.
 */
export function splitRecentTitle(title: string): { primary: string; location?: string } {
  let url: URL;
  try {
    url = new URL(title);
  } catch {
    return { primary: title };
  }
  if (url.host === "") {
    return { primary: title };
  }

  const segments = url.pathname.split("/").filter(Boolean).map(safeDecode);
  const last = segments.at(-1);
  if (last?.includes(".") === true) {
    return {
      primary: last,
      location: [url.host, ...segments.slice(0, -1)].join("/"),
    };
  }
  return { primary: [url.host, ...segments].join("/") };
}

// [unit, seconds, how many units it takes before the unit is used]. Long units wait for two, so
// 17 months reads "17 months ago" rather than rounding to "last year".
const RELATIVE_TIME_UNITS: [Intl.RelativeTimeFormatUnit, number, number][] = [
  ["year", 365 * 24 * 60 * 60, 2],
  ["month", 30 * 24 * 60 * 60, 2],
  ["week", 7 * 24 * 60 * 60, 2],
  ["day", 24 * 60 * 60, 1],
  ["hour", 60 * 60, 1],
  ["minute", 60, 1],
];

/**
 * Format a past timestamp as e.g. "2 minutes ago" or "yesterday". Under 45 seconds is "now";
 * seconds aren't shown, so 117 seconds reads "2 minutes ago".
 */
export function formatTimeAgo(timestamp: number, now: number, locale?: string): string {
  const seconds = (timestamp - now) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, unitSeconds, minUnits] of RELATIVE_TIME_UNITS) {
    if (Math.abs(seconds) >= minUnits * unitSeconds - (unit === "minute" ? 15 : 0)) {
      return format.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return format.format(0, "second");
}

/** Ports sources listen on by default, for connecting to a bare host. */
const DEFAULT_PORTS: Record<string, number> = {
  "foxglove-websocket": 8765,
  "rosbridge-websocket": 9090,
  "ros1-socket": 11311,
};

const RECORDING_NAME = /\.(mcap|bag|db3|ulg|ulog|foxe)$/i;

/**
 * A bare host name or address that could be a robot, like `robot-1`, `robot.local` or
 * `192.168.1.5`. File names such as `drive.mcap` are not hosts. Single words qualify too, so
 * callers should prefer search results when there are any.
 */
export function looksLikeHost(input: string): boolean {
  const s = input.trim();
  return (
    !RECORDING_NAME.test(s) &&
    /^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-z\d]([a-z\d-]*[a-z\d])?(\.[a-z\d]([a-z\d-]*[a-z\d])?)*)$/i.test(
      s,
    )
  );
}

/** URL for connecting to a bare host with a source, on that source's default port. */
export function hostUrl(host: string, sourceId: string): string {
  const port = DEFAULT_PORTS[sourceId] ?? DEFAULT_PORTS["foxglove-websocket"]!;
  return `${sourceId === "ros1-socket" ? "http" : "ws"}://${host.trim()}:${port}`;
}

/**
 * Guess which connection data source handles a user-entered URL. A bare `host:port` is treated
 * as a websocket; other bare words (e.g. search text) are not URLs. Returns undefined when the input is not a URL we recognize.
 */
export function detectConnection(input: string): { sourceId: string; url: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed.includes("://") && !/^[\w.-]+:\d+/.test(trimmed)) {
    return undefined;
  }
  const url = trimmed.includes("://") ? trimmed : `ws://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.host === "") {
    return undefined;
  }

  switch (parsed.protocol) {
    case "ws:":
    case "wss:":
      // 9090 is the rosbridge default port
      return {
        sourceId: parsed.port === "9090" ? "rosbridge-websocket" : "foxglove-websocket",
        url,
      };
    case "http:":
    case "https:": {
      const pathname = parsed.pathname.toLowerCase();
      if (REMOTE_FILE_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
        return { sourceId: "remote-file", url };
      }
      // 11311 is the ROS 1 master default port
      if (parsed.port === "11311") {
        return { sourceId: "ros1-socket", url };
      }
      return undefined;
    }
  }
  return undefined;
}
