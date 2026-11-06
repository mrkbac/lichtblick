// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { getPanelIds } from "@lichtblick/suite-base/util/layoutTree";

import { getPanelTypeFromId, validateLayoutData } from "./layout";
import { LAYOUT_TEMPLATES, LayoutTemplateId, TemplateTopic } from "./layoutTemplates";

function build(id: LayoutTemplateId, topics: TemplateTopic[], datatypes: RosDatatypes = new Map()) {
  const template = LAYOUT_TEMPLATES.find((tmpl) => tmpl.id === id)!;
  const result = template.build(topics, datatypes);
  validateLayoutData(result.data);
  const ids = getPanelIds(result.data.layout);
  // Every panel in the tree has a config and vice versa.
  expect(Object.keys(result.data.configById).sort()).toEqual([...ids].sort());
  const panels = ids.map((panelId) => ({
    type: getPanelTypeFromId(panelId),
    config: result.data.configById[panelId] as Record<string, unknown>,
  }));
  return { topics: result.topics, panels, types: panels.map((panel) => panel.type) };
}

const IMAGE = { name: "/camera/image", schemaName: "sensor_msgs/msg/CompressedImage" };
const IMAGE_2 = { name: "/camera2/image", schemaName: "foxglove.RawImage" };
const VIDEO = { name: "/camera3/video", schemaName: "foxglove.CompressedVideo" };
const POINTS = { name: "/points", schemaName: "sensor_msgs/msg/PointCloud2" };
const GRID = { name: "/grid", schemaName: "nav_msgs/msg/OccupancyGrid" };
const TF = { name: "/transforms", schemaName: "tf2_msgs/msg/TFMessage" };
const GPS = { name: "/gps", schemaName: "sensor_msgs/msg/NavSatFix" };
const DIAG = { name: "/diag", schemaName: "diagnostic_msgs/msg/DiagnosticArray" };
const LOG = { name: "/log", schemaName: "rcl_interfaces/msg/Log" };
const ODOM = { name: "/odom", schemaName: "pkg/Odom" };
const NO_SCHEMA = { name: "/raw" };

const DATATYPES: RosDatatypes = new Map([
  [
    "pkg/Odom",
    {
      definitions: [
        { name: "header", type: "std_msgs/Header", isComplex: true },
        { name: "speed", type: "float64" },
        { name: "MODE_AUTO", type: "uint8", isConstant: true, value: 1 },
        { name: "drive_mode", type: "uint8" },
        { name: "label", type: "string" },
        { name: "covariance", type: "float64", isArray: true },
        { name: "pose", type: "pkg/Pose", isComplex: true },
      ],
    },
  ],
  [
    "pkg/Pose",
    {
      definitions: [
        { name: "x", type: "float64" },
        { name: "y", type: "float64" },
      ],
    },
  ],
  [
    "std_msgs/Header",
    {
      definitions: [
        { name: "stamp", type: "time" },
        { name: "frame_id", type: "string" },
      ],
    },
  ],
]);

describe("camera template", () => {
  it("shows every image and video topic in a grid next to the first one", () => {
    const { topics, panels } = build("camera", [VIDEO, POINTS, IMAGE_2, IMAGE]);
    expect(topics).toEqual(["/camera/image", "/camera2/image", "/camera3/video"]);
    expect(panels).toEqual([
      {
        type: "CameraGrid",
        config: {
          tiles: [
            expect.objectContaining({ topic: "/camera/image", visible: true }),
            expect.objectContaining({ topic: "/camera2/image" }),
            expect.objectContaining({ topic: "/camera3/video" }),
          ],
        },
      },
      { type: "Image", config: { imageMode: { imageTopic: "/camera/image" } } },
    ]);
  });

  it("skips the grid for a single camera", () => {
    expect(build("camera", [IMAGE]).types).toEqual(["Image"]);
  });

  it("leaves an empty image panel when there are no images", () => {
    const { topics, panels } = build("camera", [POINTS]);
    expect(topics).toEqual([]);
    expect(panels).toEqual([{ type: "Image", config: {} }]);
  });
});

describe("navigation template", () => {
  it("shows scene topics in 3D and adds a map for GPS", () => {
    const { topics, panels } = build("navigation", [IMAGE, POINTS, GRID, TF, GPS]);
    expect(topics).toEqual(["/gps", "/grid", "/points", "/transforms"]);
    expect(panels).toEqual([
      {
        type: "3D",
        config: { topics: { "/grid": { visible: true }, "/points": { visible: true } } },
      },
      { type: "map", config: {} },
    ]);
  });

  it("keeps an empty 3D panel and no map when nothing matches", () => {
    const { topics, panels } = build("navigation", [IMAGE, NO_SCHEMA]);
    expect(topics).toEqual([]);
    expect(panels).toEqual([{ type: "3D", config: { topics: {} } }]);
  });
});

describe("diagnostics template", () => {
  it("adds diagnostics and log panels for matching topics", () => {
    const { topics, types } = build("diagnostics", [LOG, DIAG, IMAGE]);
    expect(topics).toEqual(["/diag", "/log"]);
    expect(types).toEqual(["DiagnosticSummary", "DiagnosticStatusPanel", "RosOut", "TopicHealth"]);
  });

  it("falls back to topic health alone", () => {
    const { topics, types } = build("diagnostics", [IMAGE]);
    expect(topics).toEqual([]);
    expect(types).toEqual(["TopicHealth"]);
  });
});

describe("signals template", () => {
  it("plots numeric fields and shows states, skipping headers, arrays and constants", () => {
    const { topics, panels } = build("signals", [ODOM, IMAGE, NO_SCHEMA], DATATYPES);
    expect(topics).toEqual(["/odom"]);
    expect(panels).toEqual([
      {
        type: "Plot",
        config: {
          paths: [
            { value: "/odom.speed", enabled: true, timestampMethod: "receiveTime" },
            { value: "/odom.pose.x", enabled: true, timestampMethod: "receiveTime" },
            { value: "/odom.pose.y", enabled: true, timestampMethod: "receiveTime" },
          ],
        },
      },
      {
        type: "Watch",
        config: {
          rows: [
            "/odom.drive_mode",
            "/odom.label",
            "/odom.speed",
            "/odom.pose.x",
            "/odom.pose.y",
          ].map((path) => expect.objectContaining({ path })),
        },
      },
      {
        type: "StateTransitions",
        config: {
          paths: [
            { value: "/odom.drive_mode", timestampMethod: "receiveTime" },
            { value: "/odom.label", timestampMethod: "receiveTime" },
          ],
        },
      },
    ]);
  });

  it("quotes topic names that need it", () => {
    const { panels } = build("signals", [{ ...ODOM, name: "/odom 2" }], DATATYPES);
    expect(panels[0]?.config.paths).toContainEqual(
      expect.objectContaining({ value: '"/odom 2".speed' }),
    );
  });

  it("leaves one empty plot when nothing matches", () => {
    const { topics, panels } = build("signals", [IMAGE, NO_SCHEMA], DATATYPES);
    expect(topics).toEqual([]);
    expect(panels).toEqual([{ type: "Plot", config: { paths: [] } }]);
  });
});
