// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * ROS 2 time and duration message types, for definitions that keep them as messages instead of
 * the `time` / `duration` primitives.
 */
export const ROS2_TIME_TYPES = [
  "builtin_interfaces/Time",
  "builtin_interfaces/msg/Time",
  "builtin_interfaces/Duration",
  "builtin_interfaces/msg/Duration",
];

export const PLOTABLE_ROS_TYPES = [
  ...ROS2_TIME_TYPES,
  "bool",
  "duration",
  "float32",
  "float64",
  "int16",
  "int32",
  "int64",
  "int8",
  "string",
  "time",
  "uint16",
  "uint32",
  "uint64",
  "uint8",
];

export const MISSING_VALUE_PLACEHOLDER = "—";
