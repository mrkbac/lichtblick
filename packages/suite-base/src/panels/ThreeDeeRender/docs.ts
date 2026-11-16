// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ArrowRouting20Regular,
  Cursor20Regular,
  PointScan20Regular,
  ZoomFit20Regular,
} from "@fluentui/react-icons";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import PublishPointIcon from "@lichtblick/suite-base/components/PublishPointIcon";
import { COMPRESSED_VIDEO_DATATYPES } from "@lichtblick/suite-base/util/foxgloveSchemas";

import PerspectiveButtonLabel from "./PerspectiveButtonLabel";
import * as foxglove from "./foxglove";
import * as ros from "./ros";

const docs: PanelDocs = {
  intro: "Renders robots, point clouds, markers, maps, images, and transforms in one 3D scene.",
  schemas: [
    ros.TF_DATATYPES,
    ros.TRANSFORM_STAMPED_DATATYPES,
    ros.MARKER_DATATYPES,
    ros.MARKER_ARRAY_DATATYPES,
    ros.OCCUPANCY_GRID_DATATYPES,
    ros.POINTCLOUD_DATATYPES,
    ros.LASERSCAN_DATATYPES,
    ros.VELODYNE_SCAN_DATATYPES,
    ros.POSE_STAMPED_DATATYPES,
    ros.POSE_WITH_COVARIANCE_STAMPED_DATATYPES,
    ros.POSE_ARRAY_DATATYPES,
    ros.NAV_PATH_DATATYPES,
    ros.POLYGON_STAMPED_DATATYPES,
    ros.CAMERA_INFO_DATATYPES,
    ros.IMAGE_DATATYPES,
    ros.COMPRESSED_IMAGE_DATATYPES,
    ros.JOINTSTATE_DATATYPES,
    ros.URDF_TOPIC_SCHEMAS,
    ros.LOCATION_SCHEMAS,
    foxglove.FRAME_TRANSFORM_DATATYPES,
    foxglove.FRAME_TRANSFORMS_DATATYPES,
    foxglove.POINTCLOUD_DATATYPES,
    foxglove.LASERSCAN_DATATYPES,
    foxglove.RAW_IMAGE_DATATYPES,
    foxglove.COMPRESSED_IMAGE_DATATYPES,
    foxglove.CAMERA_CALIBRATION_DATATYPES,
    foxglove.SCENE_UPDATE_DATATYPES,
    foxglove.POSE_IN_FRAME_DATATYPES,
    foxglove.POSES_IN_FRAME_DATATYPES,
    foxglove.GRID_DATATYPES,
    COMPRESSED_VIDEO_DATATYPES,
  ].flatMap((set) => [...set]),
  sections: [
    {
      title: "Mouse",
      items: [
        ["Left-drag", "Pans. Hold Alt to pan in screen space."],
        ["Right-drag", "Rotates around the target. Scroll zooms."],
        ["Hover", "Shows the object under the cursor with its topic and fields."],
        ["Click", "Pins those details so you can scroll and copy them."],
        ["Drop a topic", "Drag a topic from the sidebar onto the scene to show it."],
      ],
    },
    {
      title: "Toolbar",
      items: [
        ["Inspect objects", "Shows details of the clicked object.", Cursor20Regular],
        [
          "2D / 3D",
          "Switches between a top-down and a perspective camera.",
          PerspectiveButtonLabel,
        ],
        [
          "Publish",
          "Click the scene to publish a point, pose, or pose estimate; long-press to pick which.",
          PublishPointIcon,
        ],
        [
          "Measure",
          "Point, distance, polyline, angle, area, height, and height profile.",
          PointScan20Regular,
        ],
        [
          "Measure between frames",
          "Click two frames' axes for their distance and rotation.",
          ArrowRouting20Regular,
        ],
        ["Zoom to data", "Fits the camera to everything shown.", ZoomFit20Regular],
      ],
    },
    {
      title: "Measuring",
      items: [
        ["Place", "Click to place points; right-click or Esc finishes."],
        ["Edit", "Drag points to move them. Backspace undoes the last point."],
        ["Delete", "Delete removes the selected measurement."],
        ["Results in", "Report values in the display frame or any other frame."],
      ],
    },
    {
      title: "Settings",
      items: [
        ["Frame", "Display frame, and whether the camera follows its pose, position, or nothing."],
        [
          "Transforms",
          "Show frame axes and labels, and add a translation or rotation offset per frame.",
        ],
        ["Topics", "Per topic: colors, point size, decay time, color by field."],
        ["Custom layers", "Add grids, URDF robots, and map tiles under the scene."],
        ["Scene", "Background, label scale, lighting, mesh up axis."],
      ],
    },
  ],
};

export default docs;
