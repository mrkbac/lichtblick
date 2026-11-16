// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { conflictingPolicies, differingPolicies, parseQosProfiles } from "./qos";

// Numeric enums and infinite sentinels, as older rosbag2 versions write them.
const NUMERIC = `- history: 3
  depth: 0
  reliability: 1
  durability: 2
  deadline:
    sec: 9223372036
    nsec: 854775807
  lifespan:
    sec: 9223372036
    nsec: 854775807
  liveliness: 1
  liveliness_lease_duration:
    sec: 9223372036
    nsec: 854775807
  avoid_ros_namespace_conventions: false
- history: 1
  depth: 5
  reliability: 2
  durability: 1
  deadline:
    sec: 0
    nsec: 100000000
  lifespan:
    sec: 0
    nsec: 0
  liveliness: 3
  liveliness_lease_duration:
    sec: 2147483647
    nsec: 4294967295
  avoid_ros_namespace_conventions: false`;

// Policy names, as newer rosbag2 versions write them.
const NAMED = `- history: keep_last
  depth: 10
  reliability: best_effort
  durability: transient_local
  deadline:
    sec: 1
    nsec: 500000000
  lifespan:
    sec: 0
    nsec: 0
  liveliness: automatic
  liveliness_lease_duration:
    sec: 0
    nsec: 0
  avoid_ros_namespace_conventions: false`;

describe("parseQosProfiles", () => {
  it("parses numeric enums and infinite durations", () => {
    expect(parseQosProfiles(NUMERIC)).toEqual([
      {
        reliability: "reliable",
        durability: "volatile",
        history: "unknown",
        deadline: "∞",
        lifespan: "∞",
        liveliness: "automatic",
        lease: "∞",
      },
      {
        reliability: "best effort",
        durability: "transient local",
        history: "keep last 5",
        deadline: "0.1 s",
        lifespan: "∞",
        liveliness: "manual by topic",
        lease: "∞",
      },
    ]);
  });

  it("parses policy names", () => {
    expect(parseQosProfiles(NAMED)).toEqual([
      {
        reliability: "best effort",
        durability: "transient local",
        history: "keep last 10",
        deadline: "1.5 s",
        lifespan: "∞",
        liveliness: "automatic",
        lease: "∞",
      },
    ]);
  });

  it("ignores missing or malformed input", () => {
    expect(parseQosProfiles(undefined)).toEqual([]);
    expect(parseQosProfiles("")).toEqual([]);
    expect(parseQosProfiles("{ not: [valid")).toEqual([]);
    expect(parseQosProfiles("reliability: 1")).toEqual([]);
  });

  it("reports differing and conflicting policies", () => {
    const profiles = parseQosProfiles(NUMERIC);
    expect(differingPolicies(profiles)).toEqual([
      "reliability",
      "durability",
      "history",
      "deadline",
      "liveliness",
    ]);
    expect(conflictingPolicies(profiles)).toEqual([
      "reliability",
      "durability",
      "deadline",
      "liveliness",
    ]);
    expect(conflictingPolicies([profiles[0]!, profiles[0]!])).toEqual([]);
  });
});
