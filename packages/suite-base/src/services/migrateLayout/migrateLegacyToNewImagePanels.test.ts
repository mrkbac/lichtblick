// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { migrateLegacyToNewImagePanels } from "./migrateLegacyToNewImagePanels";

let MOCK_ID = 0;
vi.mock("@lichtblick/suite-base/util/layout", async () => ({
  ...(await vi.importActual("@lichtblick/suite-base/util/layout")),
  getPanelIdForType(type: string) {
    return `${type}!${++MOCK_ID}`;
  },
}));

describe("migrateLegacyToNewImagePanels", () => {
  beforeEach(() => {
    MOCK_ID = 0;
  });
  it("migrates legacy Image panel config at root", () => {
    expect(
      migrateLegacyToNewImagePanels({
        layout: { panels: ["ImageViewPanel!a"] },
        configById: {
          "ImageViewPanel!a": {
            cameraTopic: "/cam/image_rect_compressed",
            enabledMarkerTopics: ["/cam/annotations", "/cam/lidar"],
            transformMarkers: false,
            synchronize: true,
            mode: "fit",
            pan: {
              x: 0,
              y: 0,
            },
            rotation: 90,
            zoom: 1,
            flipHorizontal: true,
            flipVertical: true,
            minValue: 2,
            maxValue: 6,
          },
        },
        globalVariables: {},
        userNodes: {},
        playbackConfig: { speed: 1 },
      }),
    ).toMatchInlineSnapshot(`
      {
        "configById": {
          "Image!1": {
            "cameraState": {
              "distance": 20,
              "far": 5000,
              "fovy": 45,
              "near": 0.5,
              "perspective": true,
              "phi": 60,
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
              "thetaOffset": 45,
            },
            "followMode": "follow-pose",
            "followTf": undefined,
            "imageMode": {
              "annotations": {
                "/cam/annotations": {
                  "visible": true,
                },
                "/cam/lidar": {
                  "visible": true,
                },
              },
              "calibrationTopic": undefined,
              "flipHorizontal": true,
              "flipVertical": true,
              "imageTopic": "/cam/image_rect_compressed",
              "maxValue": 6,
              "minValue": 2,
              "rotation": 90,
              "synchronize": true,
            },
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
            "Image!1",
          ],
        },
        "playbackConfig": {
          "speed": 1,
        },
        "userNodes": {},
      }
    `);
  });

  it("migrates legacy Image panel config inside layout", () => {
    expect(
      migrateLegacyToNewImagePanels({
        layout: {
          direction: "row",
          children: [
            { panels: ["XXX!a"] },
            { panels: ["ImageViewPanel!a"] },
            { panels: ["XXX!b"] },
          ],
        },
        configById: { "ImageViewPanel!a": {}, "XXX!a": { foo: "bar" }, "XXX!b": { foo: "baz" } },
        globalVariables: {},
        userNodes: {},
        playbackConfig: { speed: 1 },
      }),
    ).toMatchInlineSnapshot(`
      {
        "configById": {
          "Image!1": {
            "cameraState": {
              "distance": 20,
              "far": 5000,
              "fovy": 45,
              "near": 0.5,
              "perspective": true,
              "phi": 60,
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
              "thetaOffset": 45,
            },
            "followMode": "follow-pose",
            "followTf": undefined,
            "imageMode": {
              "annotations": {},
              "calibrationTopic": undefined,
              "flipHorizontal": undefined,
              "flipVertical": undefined,
              "imageTopic": undefined,
              "maxValue": undefined,
              "minValue": undefined,
              "rotation": 0,
              "synchronize": undefined,
            },
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
                "Image!1",
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
