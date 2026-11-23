// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import PieChartBuilder from "@lichtblick/suite-base/testing/builders/PieChartBuilder";

import { SUPPORTED_DATA_TYPES } from "./constants";
import { buildSettingsTree } from "./settings";
import type { PieChartConfig } from "./types";

describe("buildSettingsTree", () => {
  function setup(
    configOverride: Partial<PieChartConfig> = {},
    legendCount = 3,
    error?: string,
    pathParseError?: string,
  ) {
    const config = PieChartBuilder.pieChartConfig(configOverride);
    return buildSettingsTree(config, legendCount, pathParseError, error);
  }

  it("should return general settings node with legends", () => {
    const { general } = setup(
      { path: "/foo", title: "My Pie Chart", legend1: "1", legend2: "2" },
      2,
    );

    expect(general?.fields?.path).toMatchObject({
      label: "Message path",
      input: "messagepath",
      supportsMathModifiers: true,
      value: "/foo",
      error: undefined,
      validTypes: SUPPORTED_DATA_TYPES,
    });

    expect(general?.fields?.title).toMatchObject({
      label: "Title",
      input: "string",
      value: "My Pie Chart",
    });

    expect(general?.fields?.legend1).toMatchObject({
      label: "Legend 1",
      input: "string",
      value: "1",
    });

    expect(general?.fields?.legend2).toMatchObject({
      label: "Legend 2",
      input: "string",
      value: "2",
    });

    expect(general?.fields?.legendControls).toMatchObject({
      label: "Legend controls",
      input: "legendcontrols",
    });
  });

  it("should set pathParseError if provided", () => {
    expect(setup({}, 1, undefined, "invalid path").general?.fields!.path!.error).toBe(
      "invalid path",
    );
  });

  it("should set error if provided", () => {
    expect(setup({}, 1, "config error").general?.error).toBe("config error");
  });
});
