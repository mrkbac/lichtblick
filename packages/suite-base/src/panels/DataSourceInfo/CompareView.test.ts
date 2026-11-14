// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RecordingFileInfo, TopicStats } from "@lichtblick/suite-base/players/types";

import { compareRecordings } from "./CompareView";

function file(prefix: string, channels: [string, string][]): RecordingFileInfo {
  return {
    topicPrefix: prefix,
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
});
