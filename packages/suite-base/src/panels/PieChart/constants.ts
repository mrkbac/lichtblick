// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

/** Primitive types the panel can turn into slice values */
export const NUMERIC_TYPES = [
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "int64",
  "uint64",
  "float32",
  "float64",
];

export const SUPPORTED_DATA_TYPES = [...NUMERIC_TYPES, "string"];

export const DEFAULT_CONFIG = {
  path: "",
  title: "Pie Chart",
  legend1: "Legend 1",
  legend2: "Legend 2",
  legend3: "Legend 3",
  legend4: "Legend 4",
  legend5: "Legend 5",
  legend6: "Legend 6",
  legend7: "Legend 7",
  legend8: "Legend 8",
  legend9: "Legend 9",
  legend10: "Legend 10",
};
