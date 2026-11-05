// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinition } from "@foxglove/message-definition";
import CommonRosTypes from "@foxglove/rosmsg-msgs-common";

const BY_DISTRO: Record<string, Record<string, MessageDefinition>> = {
  foxy: CommonRosTypes.ros2galactic,
  galactic: CommonRosTypes.ros2galactic,
  humble: CommonRosTypes.ros2humble,
  iron: CommonRosTypes.ros2iron,
  jazzy: CommonRosTypes.ros2jazzy,
  kilted: CommonRosTypes.ros2kilted,
  lyrical: CommonRosTypes.ros2lyrical,
  // Rolling tracks the newest release
  rolling: CommonRosTypes.ros2lyrical,
};

/**
 * Common ROS 2 message definitions for a distro (the `ROS_DISTRO` value). Message definitions
 * differ between distros (e.g. Jazzy added `STATUS_UNKNOWN` to `sensor_msgs/NavSatStatus`).
 * Unknown or missing distros fall back to Humble.
 */
export function ros2CommonDatatypes(rosDistro?: string): Record<string, MessageDefinition> {
  return BY_DISTRO[rosDistro ?? ""] ?? CommonRosTypes.ros2humble;
}
