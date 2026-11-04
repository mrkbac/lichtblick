// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { StatusLevel } from "@foxglove/ws-protocol";

import {
  bytesToBase64,
  dataTypeToFullName,
  statusLevelToAlertSeverity,
} from "@lichtblick/suite-base/players/FoxgloveWebSocketPlayer/helpers";
import { BasicBuilder } from "@lichtblick/test-builders";

describe("dataTypeToFullName", () => {
  it("should convert dataType to include /msg/ on it", () => {
    const message = "unit/test";

    const result = dataTypeToFullName(message);

    expect(result).toBe("unit/msg/test");
  });

  it("should return the message unaltered if it differs from the 'text/text' format", () => {
    const message = BasicBuilder.string();

    const result = dataTypeToFullName(message);

    expect(result).toBe(message);
  });
});

describe("statusLevelToProblemSeverity", () => {
  type StatusLevelToProblemTest = [level: StatusLevel, result: string];

  it.each<StatusLevelToProblemTest>([
    [StatusLevel.INFO, "info"],
    [StatusLevel.WARNING, "warn"],
    [StatusLevel.ERROR, "error"],
  ])("should map StatusLevel %s to result %s", (level, result) => {
    expect(statusLevelToAlertSeverity(level)).toBe(result);
  });
});

describe("bytesToBase64", () => {
  it("round-trips non-UTF-8 bytes", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);

    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));

    expect(decoded).toEqual(bytes);
  });

  it("encodes large arrays", () => {
    const bytes = new Uint8Array(100_000).fill(0xff);

    expect(atob(bytesToBase64(bytes))).toHaveLength(100_000);
  });
});
