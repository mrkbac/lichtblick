// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { normalizeTime } from "./normalizeMessages";

describe("normalizeTime", () => {
  it("reads ROS 1 / Foxglove and ROS 2 stamps", () => {
    expect(normalizeTime({ sec: 1, nsec: 2 })).toEqual({ sec: 1, nsec: 2 });
    expect(normalizeTime({ sec: 1, nanosec: 2 })).toEqual({ sec: 1, nsec: 2 });
  });

  it("keeps the nanoseconds of a duration without seconds, e.g. a marker lifetime", () => {
    expect(normalizeTime({ nsec: 5e8 })).toEqual({ sec: 0, nsec: 5e8 });
    expect(normalizeTime({ nanosec: 5e8 })).toEqual({ sec: 0, nsec: 5e8 });
  });

  it("fills missing parts with 0", () => {
    expect(normalizeTime(undefined)).toEqual({ sec: 0, nsec: 0 });
    expect(normalizeTime({ sec: 3 })).toEqual({ sec: 3, nsec: 0 });
  });
});
