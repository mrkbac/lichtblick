// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CommonRosTypes from "@foxglove/rosmsg-msgs-common";

import { ros2CommonDatatypes } from "@lichtblick/suite-base/util/ros2CommonDatatypes";

describe("ros2CommonDatatypes", () => {
  it.each([
    ["foxy", CommonRosTypes.ros2galactic],
    ["galactic", CommonRosTypes.ros2galactic],
    ["humble", CommonRosTypes.ros2humble],
    ["iron", CommonRosTypes.ros2iron],
    ["jazzy", CommonRosTypes.ros2jazzy],
    ["kilted", CommonRosTypes.ros2kilted],
    ["lyrical", CommonRosTypes.ros2lyrical],
    ["rolling", CommonRosTypes.ros2lyrical],
    ["some-future-distro", CommonRosTypes.ros2humble],
    ["constructor", CommonRosTypes.ros2humble],
    [undefined, CommonRosTypes.ros2humble],
  ])("picks the definitions for %s", (distro, expected) => {
    expect(ros2CommonDatatypes(distro)).toBe(expected);
  });

  it("has STATUS_UNKNOWN in Jazzy's NavSatStatus", () => {
    const names = (distro: string) =>
      ros2CommonDatatypes(distro)["sensor_msgs/NavSatStatus"]!.definitions.map((d) => d.name);
    expect(names("jazzy")).toContain("STATUS_UNKNOWN");
    expect(names("humble")).not.toContain("STATUS_UNKNOWN");
  });
});
