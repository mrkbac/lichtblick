// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { filterRecordings } from "./search";
import { CatalogRecording } from "./types";

const day = (iso: string) => ({ sec: Date.parse(iso) / 1000, nsec: 0 });

const recordings: CatalogRecording[] = [
  {
    id: "a",
    name: "drive.mcap",
    source: { type: "local-file", path: "2026/10/drive.mcap" },
    start: day("2026-10-01T10:00:00Z"),
    end: day("2026-10-01T10:30:00Z"),
    size: 3 * 1024 ** 3,
    topics: [{ name: "/camera/front", schema: "sensor_msgs/msg/Image" }],
  },
  {
    id: "b",
    name: "park.mcap",
    source: { type: "remote-file", url: "https://example.com/park.mcap" },
    start: day("2026-10-20T10:00:00Z"),
    end: day("2026-10-20T10:01:00Z"),
    size: 100 * 1024 ** 2,
    topics: [{ name: "/lidar", schema: "sensor_msgs/msg/PointCloud2" }],
    tracks: [{ topic: "/fix", points: [[11, 48]] }],
  },
  {
    id: "c",
    name: "broken.mcap",
    source: { type: "local-file", path: "broken.mcap" },
    error: "bad",
  },
  { id: "d", name: "old.mcap", source: { type: "local-file", path: "old.mcap" }, noSummary: true },
];

const ids = (query: string) => filterRecordings(recordings, query).map((r) => r.id);

describe("filterRecordings", () => {
  it.each([
    ["", ["a", "b", "c", "d"]],
    ["DRIVE", ["a"]],
    ["example.com", ["b"]],
    ["topic:camera", ["a"]],
    ["schema:pointcloud", ["b"]],
    ["path:2026/10", ["a"]],
    ["since:2026-10-10", ["b"]],
    ["until:2026-10-10", ["a"]],
    ["duration>5m", ["a"]],
    ["duration<5m", ["b"]],
    ["size>1gb", ["a"]],
    ["size<1GB", ["b"]],
    ["status:error", ["c"]],
    ["status:nosummary", ["d"]],
    ["status:ok", ["a", "b"]],
    ["status:error|nosummary", ["c", "d"]],
    ["has:image", ["a"]],
    ["has:pointcloud", ["b"]],
    ["has:gps", ["b"]],
    ["has:image|gps", ["a", "b"]],
    ["has:tf", []],
    ["topic:camera duration<5m", []],
    ["foo:bar", []],
  ])("%j matches %j", (query, expected) => {
    expect(ids(query)).toEqual(expected);
  });
});
