// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RecordingFileInfo, TopicStats } from "@lichtblick/suite-base/players/types";

import { compareRecordings } from "./compareRecordings";
import { TopicInspection } from "./inspection";

function file(prefix: string, channels: [string, string][], seconds = 0): RecordingFileInfo {
  return {
    topicPrefix: prefix,
    start: { sec: 0, nsec: 0 },
    end: { sec: seconds, nsec: 0 },
    library: "",
    channels: channels.map(([topic, schemaName], id) => ({
      id,
      topic: `${prefix}${topic}`,
      schemaName,
      messageEncoding: "cdr",
      metadata: {},
    })),
    schemaCount: 0,
    compression: [],
    attachments: [],
  };
}

function stats(count: number, seconds: number): TopicStats {
  return {
    numMessages: count,
    firstMessageTime: { sec: 0, nsec: 0 },
    lastMessageTime: { sec: seconds, nsec: 0 },
  };
}

describe("compareRecordings", () => {
  it("flags missing topics, schema changes and rate changes, differences first", () => {
    const files = [
      file("/a", [
        ["/imu", "Imu"],
        ["/odom", "Odometry"],
        ["/scan", "LaserScan"],
        ["/gps", "Fix"],
      ]),
      file("/b", [
        ["/imu", "Imu"],
        ["/odom", "OdometryV2"],
        ["/scan", "LaserScan"],
      ]),
    ];
    const topicStats = new Map([
      ["/a/imu", stats(101, 1)],
      ["/b/imu", stats(105, 1)], // within 10%
      ["/a/scan", stats(11, 1)],
      ["/b/scan", stats(6, 1)],
    ]);

    const rows = compareRecordings(files, topicStats);
    expect(rows.map((row) => [row.topic, row.differences])).toEqual([
      ["/gps", ["missing"]],
      ["/odom", ["schema"]],
      ["/scan", ["rate"]],
      ["/imu", []],
    ]);
    expect(rows[3]!.cells.map((cell) => cell?.hz)).toEqual([100, 104]);
    expect(rows[0]!.cells[1]).toBeUndefined();
  });

  it("falls back to count over recording duration when stats carry only counts", () => {
    const files = [file("/a", [["/imu", "Imu"]], 10), file("/b", [["/imu", "Imu"]], 10)];
    const topicStats = new Map([
      ["/a/imu", { numMessages: 1000 }],
      ["/b/imu", { numMessages: 500 }],
    ]);
    const rows = compareRecordings(files, topicStats);
    expect(rows[0]!.cells.map((cell) => cell?.hz)).toEqual([100, 50]);
    expect(rows[0]!.differences).toEqual(["rate"]);
  });

  it("prefers the scanned median rate and count", () => {
    const files = [file("/a", [["/imu", "Imu"]], 10), file("/b", [["/imu", "Imu"]], 10)];
    const scanned = (count: number, medianHz: number) =>
      ({ count, timing: { medianHz } }) as TopicInspection;
    const rows = compareRecordings(
      files,
      undefined,
      new Map([
        ["/a/imu", scanned(7, 20)],
        ["/b/imu", scanned(8, 21)],
      ]),
    );
    expect(rows[0]!.cells.map((cell) => [cell?.count, cell?.hz])).toEqual([
      [7, 20],
      [8, 21],
    ]);
    expect(rows[0]!.differences).toEqual([]);
  });

  it("compares every schema a recording uses for a topic", () => {
    const files = [
      file("/a", [
        ["/imu", "ImuV2"],
        ["/imu", "Imu"],
      ]),
      file("/b", [["/imu", "Imu"]]),
    ];
    const rows = compareRecordings(files, undefined);
    expect(rows[0]!.cells.map((cell) => cell?.schemaName)).toEqual(["Imu, ImuV2", "Imu"]);
    expect(rows[0]!.differences).toEqual(["schema"]);
  });

  it("compares a row on one rate basis even when only one recording was scanned", () => {
    const files = [file("/a", [["/imu", "Imu"]], 100), file("/b", [["/imu", "Imu"]], 100)];
    const topicStats = new Map([
      ["/a/imu", { numMessages: 100 }],
      ["/b/imu", { numMessages: 100 }],
    ]);
    const scanned = { count: 100, timing: { medianHz: 100 } } as TopicInspection;
    const rows = compareRecordings(files, topicStats, new Map([["/a/imu", scanned]]));
    expect(rows[0]!.cells.map((cell) => cell?.hz)).toEqual([1, 1]);
    expect(rows[0]!.differences).toEqual([]);
  });

  it("gives topics with zero or one message a rate over the recording", () => {
    const files = [file("/a", [["/imu", "Imu"]], 10), file("/b", [["/imu", "Imu"]], 10)];
    const topicStats = new Map([
      ["/a/imu", { numMessages: 0 }],
      ["/b/imu", { numMessages: 10 }],
    ]);
    const rows = compareRecordings(files, topicStats);
    expect(rows[0]!.cells.map((cell) => cell?.hz)).toEqual([0, 1]);
    expect(rows[0]!.differences).toEqual(["rate"]);
  });
});
