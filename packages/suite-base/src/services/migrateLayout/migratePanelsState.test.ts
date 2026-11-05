// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";

import { LAYOUT_VERSION, migratePanelsState } from "./migratePanelsState";

describe("migratePanelsState", () => {
  it("migrates older layouts and stamps the current version", () => {
    const result = migratePanelsState({
      layout: "3D!1" as unknown as LayoutData["layout"],
      globalVariables: {},
      playbackConfig: { speed: 1 },
    });
    expect(result.layout).toEqual({ panels: ["3D!1"] });
    expect(result.configById).toEqual({});
    expect(result.version).toBe(LAYOUT_VERSION);
  });

  it("leaves layouts from a newer version untouched", () => {
    const layout = { future: "shape", first: "3D!1" } as unknown as LayoutData["layout"];
    const configById = { "3D!1": { anything: true } };
    const result = migratePanelsState({
      layout,
      configById,
      globalVariables: {},
      playbackConfig: { speed: 1 },
      version: LAYOUT_VERSION + 1,
    });
    expect(result.layout).toBe(layout);
    expect(result.configById).toBe(configById);
    expect(result.version).toBe(LAYOUT_VERSION + 1);
  });

  it("defaults configById for a newer version", () => {
    const result = migratePanelsState({
      layout: undefined,
      globalVariables: {},
      playbackConfig: { speed: 1 },
      version: LAYOUT_VERSION + 1,
    });
    expect(result.configById).toEqual({});
  });
});
