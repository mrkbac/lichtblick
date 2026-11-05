// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { migrateLegacyToNew3DPanels } from "./migrateLegacyToNew3DPanels";

let MOCK_ID = 0;
vi.mock("@lichtblick/suite-base/util/layout", async () => ({
  ...(await vi.importActual("@lichtblick/suite-base/util/layout")),
  getPanelIdForType(type: string) {
    return `${type}!${++MOCK_ID}`;
  },
}));

describe("migrateLegacyToNew3DPanels", () => {
  beforeEach(() => {
    MOCK_ID = 0;
  });
  it("migrates legacy 3D panel config at root", () => {
    expect(
      migrateLegacyToNew3DPanels({
        layout: { panels: ["3D Panel!a"] },
        configById: { "3D Panel!a": {} },
        globalVariables: {},
        userNodes: {},
        playbackConfig: { speed: 1 },
      }),
    ).toMatchInlineSnapshot(`
      {
        "configById": {
          "3D!1": {
            "cameraState": {
              "distance": 20,
              "far": 5000,
              "fovy": 45,
              "near": 0.5,
              "perspective": true,
              "phi": 59.99999999999999,
              "target": [
                0,
                0,
                0,
              ],
              "targetOffset": [
                0,
                0,
                0,
              ],
              "targetOrientation": [
                0,
                0,
                0,
                1,
              ],
              "thetaOffset": 0,
            },
            "followMode": "follow-none",
            "followTf": undefined,
            "imageMode": {},
            "layers": {},
            "publish": {
              "pointTopic": "/clicked_point",
              "poseEstimateThetaDeviation": 0.26179939,
              "poseEstimateTopic": "/initialpose",
              "poseEstimateXDeviation": 0.5,
              "poseEstimateYDeviation": 0.5,
              "poseTopic": "/move_base_simple/goal",
              "type": "point",
            },
            "scene": {},
            "topics": {},
            "transforms": {},
          },
        },
        "globalVariables": {},
        "layout": {
          "panels": [
            "3D!1",
          ],
        },
        "playbackConfig": {
          "speed": 1,
        },
        "userNodes": {},
      }
    `);
  });

  it("migrates legacy 3D panel config inside layout", () => {
    expect(
      migrateLegacyToNew3DPanels({
        layout: {
          direction: "row",
          children: [{ panels: ["XXX!a"] }, { panels: ["3D Panel!a"] }, { panels: ["XXX!b"] }],
        },
        configById: { "3D Panel!a": {}, "XXX!a": { foo: "bar" }, "XXX!b": { foo: "baz" } },
        globalVariables: {},
        userNodes: {},
        playbackConfig: { speed: 1 },
      }),
    ).toMatchInlineSnapshot(`
      {
        "configById": {
          "3D!1": {
            "cameraState": {
              "distance": 20,
              "far": 5000,
              "fovy": 45,
              "near": 0.5,
              "perspective": true,
              "phi": 59.99999999999999,
              "target": [
                0,
                0,
                0,
              ],
              "targetOffset": [
                0,
                0,
                0,
              ],
              "targetOrientation": [
                0,
                0,
                0,
                1,
              ],
              "thetaOffset": 0,
            },
            "followMode": "follow-none",
            "followTf": undefined,
            "imageMode": {},
            "layers": {},
            "publish": {
              "pointTopic": "/clicked_point",
              "poseEstimateThetaDeviation": 0.26179939,
              "poseEstimateTopic": "/initialpose",
              "poseEstimateXDeviation": 0.5,
              "poseEstimateYDeviation": 0.5,
              "poseTopic": "/move_base_simple/goal",
              "type": "point",
            },
            "scene": {},
            "topics": {},
            "transforms": {},
          },
          "XXX!a": {
            "foo": "bar",
          },
          "XXX!b": {
            "foo": "baz",
          },
        },
        "globalVariables": {},
        "layout": {
          "children": [
            {
              "panels": [
                "XXX!a",
              ],
            },
            {
              "panels": [
                "3D!1",
              ],
            },
            {
              "panels": [
                "XXX!b",
              ],
            },
          ],
          "direction": "row",
          "sizes": [
            33.33,
            33.33,
            33.33,
          ],
        },
        "playbackConfig": {
          "speed": 1,
        },
        "userNodes": {},
      }
    `);
  });
});
