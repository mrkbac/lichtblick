// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";
import { fixLabel, hasFix } from "@lichtblick/suite-base/panels/Map/support";
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
