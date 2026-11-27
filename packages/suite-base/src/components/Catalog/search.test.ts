// SPDX-License-Identifier: MPL-2.0

import { filterRecordings, parsePeriod } from "./search";
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
  it("filters live recordings by the machine they came from", () => {
    const live: CatalogRecording = {
      id: "e",
      name: "robot.local:8765",
      source: {
        type: "local-file",
        path: "live-2026-11-07T10-30-00-000-ab12@robot.local_8765.mcap",
      },
      machine: "robot.local:8765",
    };
    const liveIds = (query: string) =>
      filterRecordings([...recordings, live], query).map((r) => r.id);
    expect(liveIds("machine:robot.local:8765")).toEqual(["e"]);
    expect(liveIds("machine:ROBOT")).toEqual(["e"]);
    expect(liveIds("robot.local")).toEqual(["e"]);
    expect(liveIds("machine:other")).toEqual([]);
    expect(liveIds("machine=robot.local:8765")).toEqual(["e"]);
    expect(liveIds("machine=robot.local")).toEqual([]);
  });

  it("reads since/until dates as whole periods in the app time zone", () => {
    const recording = (id: string, iso: string): CatalogRecording => ({
      id,
      name: id,
      source: { type: "remote-file", url: `https://example.com/${id}.mcap` },
      start: day(iso),
      end: day(iso),
    });
    // 23:30 on Nov 27 in Los Angeles, already Nov 28 in UTC
    const lateEvening = recording("late", "2026-11-28T07:30:00Z");
    const lateIds = (query: string, timezone?: string) =>
      filterRecordings([lateEvening], query, timezone).map((r) => r.id);

    expect(lateIds("until:2026-11-27", "America/Los_Angeles")).toEqual(["late"]);
    expect(lateIds("since:2026-11-28", "America/Los_Angeles")).toEqual([]);
    expect(lateIds("since:2026-11-28", "UTC")).toEqual(["late"]);
    expect(lateIds("until:2026-11", "America/Los_Angeles")).toEqual(["late"]);
    expect(lateIds("since:2026", "America/Los_Angeles")).toEqual(["late"]);
    expect(lateIds("until:2026-11-27T23:00", "America/Los_Angeles")).toEqual([]);
    expect(lateIds("until:2026-11-28T07:30:00Z")).toEqual(["late"]);
    // An explicit instant is inclusive, and nothing after it is
    const atInstant = {
      ...lateEvening,
      id: "at",
      start: { sec: Date.UTC(2026, 10, 27) / 1000, nsec: 0 },
    };
    const justAfter = {
      ...atInstant,
      id: "after",
      start: { sec: Date.UTC(2026, 10, 27) / 1000, nsec: 500_000 },
    };
    expect(
      filterRecordings([atInstant, justAfter], "until:2026-11-27T00:00:00Z").map((r) => r.id),
    ).toEqual(["at"]);
    // The last fraction of a day still belongs to it
    const lastMoment = {
      ...lateEvening,
      id: "last",
      start: { sec: Date.UTC(2026, 10, 27, 23, 59, 59) / 1000, nsec: 999_500_000 },
    };
    expect(filterRecordings([lastMoment], "until:2026-11-27", "UTC")).toEqual([lastMoment]);
  });

  it("finds the whole span a date names", () => {
    expect(parsePeriod("2026-12", "UTC")).toEqual({
      start: Date.UTC(2026, 11, 1),
      end: Date.UTC(2027, 0, 1),
      endInclusive: false,
    });
    // Single-digit minutes and seconds keep their value
    expect(parsePeriod("2026-11-27T08:05", "UTC")).toEqual({
      start: Date.UTC(2026, 10, 27, 8, 5),
      end: Date.UTC(2026, 10, 27, 8, 6),
      endInclusive: false,
    });
    // 02:00 doesn't exist on this day in Los Angeles: the minute ends where the clock resumes
    expect(parsePeriod("2026-03-08T01:59", "America/Los_Angeles")?.end).toBe(
      Date.parse("2026-03-08T10:00:00Z"),
    );
    // 02:30 doesn't exist either: the clock resumes at 03:00 local, not 03:30
    expect(parsePeriod("2026-03-08T02:29", "America/Los_Angeles")?.end).toBe(
      Date.parse("2026-03-08T10:00:00Z"),
    );
    // 01:30 happens twice: the first one
    expect(parsePeriod("2026-11-01T01:30", "America/Los_Angeles")?.start).toBe(
      Date.parse("2026-11-01T08:30:00Z"),
    );
    expect(parsePeriod("2026-02-30", "UTC")).toBeUndefined();
    expect(parsePeriod("1970-01-01", "UTC")).toEqual({
      start: 0,
      end: Date.UTC(1970, 0, 2),
      endInclusive: false,
    });
    expect(parsePeriod("yesterday")).toBeUndefined();
  });

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
