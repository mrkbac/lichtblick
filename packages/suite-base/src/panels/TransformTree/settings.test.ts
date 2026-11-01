// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { resolveTopics, settingsActionReducer } from "./settings";

describe("resolveTopics", () => {
  it("defaults to every topic visible, static only for *tf_static", () => {
    expect(resolveTopics({}, ["/tf_static", "/tf", "/robot/tf_static"])).toEqual([
      { name: "/robot/tf_static", visible: true, isStatic: true, available: true },
      { name: "/tf", visible: true, isStatic: false, available: true },
      { name: "/tf_static", visible: true, isStatic: true, available: true },
    ]);
  });

  it("applies per-topic settings and keeps configured topics that are missing", () => {
    const config = {
      topics: {
        "/calibration": { static: true },
        "/tf": { visible: false },
        "/tf_static": { static: false },
      },
    };
    expect(resolveTopics(config, ["/tf", "/tf_static"])).toEqual([
      { name: "/calibration", visible: true, isStatic: true, available: false },
      { name: "/tf", visible: false, isStatic: false, available: true },
      { name: "/tf_static", visible: true, isStatic: false, available: true },
    ]);
  });
});

describe("settingsActionReducer", () => {
  it("updates a topic setting without splitting the topic name on dots", () => {
    const config = settingsActionReducer(
      {},
      {
        action: "update",
        payload: { path: ["topics", "/robot.1/tf", "static"], input: "boolean", value: true },
      },
    );
    expect(config).toEqual({ topics: { "/robot.1/tf": { static: true } } });
  });

  it("ignores unrelated actions", () => {
    const config = { collapsed: ["map"] };
    expect(
      settingsActionReducer(config, {
        action: "perform-node-action",
        payload: { id: "x", path: ["topics"] },
      }),
    ).toBe(config);
  });
});
