// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";
import { expandLocationFixes, fixLabel, hasFix } from "@lichtblick/suite-base/panels/Map/support";
import { NavSatFixMsg, NavSatFixStatus } from "@lichtblick/suite-base/panels/Map/types";

function navSat(status?: NavSatFixStatus): MessageEvent<NavSatFixMsg> {
  return {
    topic: "/fix",
    schemaName: "sensor_msgs/msg/NavSatFix",
    receiveTime: { sec: 0, nsec: 0 },
    sizeInBytes: 0,
    message: {
      latitude: 0,
      longitude: 0,
      altitude: 0,
      ...(status != undefined && { status: { status, service: 1 } }),
    },
  };
}

describe("hasFix / fixLabel", () => {
  it.each([
    [undefined, true, "unknown"],
    [NavSatFixStatus.STATUS_UNKNOWN, true, "unknown"],
    [NavSatFixStatus.STATUS_NO_FIX, false, "no fix"],
    [NavSatFixStatus.STATUS_FIX, true, "fix"],
    [NavSatFixStatus.STATUS_SBAS_FIX, true, "fix"],
    [NavSatFixStatus.STATUS_GBAS_FIX, true, "fix"],
  ])("status %s", (status, fix, label) => {
    expect(hasFix(navSat(status))).toBe(fix);
    expect(fixLabel(navSat(status))).toBe(label);
  });
});

describe("expandLocationFixes", () => {
  const event = (schemaName: string, message: unknown) =>
    ({
      topic: "/gps",
      schemaName,
      receiveTime: { sec: 1, nsec: 0 },
      message,
      sizeInBytes: 0,
    }) as MessageEvent;

  it("splits foxglove.LocationFixes into LocationFix messages and keeps other messages", () => {
    const fix = { latitude: 1, longitude: 2 };
    const other = event("foxglove.LocationFix", fix);
    const expanded = expandLocationFixes([
      other,
      event("foxglove_msgs/msg/LocationFixes", { fixes: [fix, { latitude: 3, longitude: 4 }] }),
      event("foxglove.LocationFixes", {}),
    ]);
    expect(expanded.map((e) => [e.schemaName, e.message])).toEqual([
      ["foxglove.LocationFix", fix],
      ["foxglove.LocationFix", fix],
      ["foxglove.LocationFix", { latitude: 3, longitude: 4 }],
    ]);
    expect(expanded[0]).toBe(other);
  });

  it("returns the input when there is nothing to expand", () => {
    const events = [event("sensor_msgs/NavSatFix", {})];
    expect(expandLocationFixes(events)).toBe(events);
  });
});
