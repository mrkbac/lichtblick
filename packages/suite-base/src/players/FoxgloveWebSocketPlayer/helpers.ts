// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { StatusLevel } from "@foxglove/ws-protocol";

import { PlayerAlert } from "@lichtblick/suite-base/players/types";

export function dataTypeToFullName(dataType: string): string {
  const parts = dataType.split("/");
  if (parts.length === 2) {
    return `${parts[0]}/msg/${parts[1]}`;
  }
  return dataType;
}

export function statusLevelToAlertSeverity(level: StatusLevel): PlayerAlert["severity"] {
  if (level === StatusLevel.INFO) {
    return "info";
  } else if (level === StatusLevel.WARNING) {
    return "warn";
  } else {
    return "error";
  }
}

/** Base64-encodes raw bytes (unlike `btoa(textDecoder.decode(bytes))`, which corrupts non-UTF-8 data). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked to stay below the argument count limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
