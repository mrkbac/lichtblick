// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { resolveTopics, settingsActionReducer } from "./settings";

describe("resolveTopics", () => {
  it("should show every topic and mark only *tf_static as static when there is no config", () => {
    // Given
    const available = ["/tf_static", "/tf", "/robot/tf_static"];

    // When
    const topics = resolveTopics({}, available);

    // Then
    expect(topics).toEqual([
      { name: "/robot/tf_static", visible: true, isStatic: true, available: true },
      { name: "/tf", visible: true, isStatic: false, available: true },
      { name: "/tf_static", visible: true, isStatic: true, available: true },
    ]);
  });

  it("should apply per-topic settings and keep missing topics when they are configured", () => {
    // Given
    const config = {
      topics: {
        "/calibration": { static: true },
        "/tf": { visible: false },
        "/tf_static": { static: false },
      },
    };

    // When
    const topics = resolveTopics(config, ["/tf", "/tf_static"]);

    // Then
    expect(topics).toEqual([
      { name: "/calibration", visible: true, isStatic: true, available: false },
      { name: "/tf", visible: false, isStatic: false, available: true },
      { name: "/tf_static", visible: true, isStatic: false, available: true },
    ]);
  });
});

describe("settingsActionReducer", () => {
  it("should not split the topic name on dots when updating a topic setting", () => {
    // Given
    const initial = {};

    // When
    const config = settingsActionReducer(
      initial,
      {
        action: "update",
        payload: { path: ["topics", "/robot.1/tf", "static"], input: "boolean", value: true },
      },
    );

    // Then
    expect(config).toEqual({ topics: { "/robot.1/tf": { static: true } } });
  });

  it("should return the config unchanged when given an unrelated action", () => {
    // Given
    const config = { collapsed: ["map"] };

    // When
    const result = settingsActionReducer(config, {
      action: "perform-node-action",
      payload: { id: "x", path: ["topics"] },
    });

    // Then
    expect(result).toBe(config);
  });
});
