// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { NavMessage, trackFlushDelayMs, trackPoint } from "./features";

describe("trackPoint", () => {
  it("keeps only what the track draws", () => {
    const fix: NavMessage = {
      topic: "/fix",
      schemaName: "sensor_msgs/NavSatFix",
      receiveTime: { sec: 1, nsec: 0 },
      sizeInBytes: 200,
      message: {
        latitude: 1,
        longitude: 2,
        altitude: 3,
        status: { status: 0, service: 1 },
        position_covariance: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        position_covariance_type: 2,
      },
    };
    expect(trackPoint(fix)).toEqual({
      topic: "/fix",
      schemaName: "sensor_msgs/NavSatFix",
      receiveTime: { sec: 1, nsec: 0 },
      sizeInBytes: 0,
      message: { latitude: 1, longitude: 2, altitude: 3, status: { status: 0, service: 1 } },
    });
  });
});

describe("trackFlushDelayMs", () => {
  it("waits longer as the track grows", () => {
    expect(trackFlushDelayMs(0)).toBe(50);
    expect(trackFlushDelayMs(0, 100)).toBe(500);
    expect(trackFlushDelayMs(2_000_000)).toBe(1000);
  });
});
