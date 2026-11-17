// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { COMPRESSED_VIDEO_DATATYPES } from "@lichtblick/suite-base/util/foxgloveSchemas";

import { THREE_DEE_BUTTONS } from "./buttons";
import * as foxglove from "./foxglove";
import * as ros from "./ros";
import { threeDeeGuideSettings } from "./settingsNodes/guide";

const docs: PanelDocs = {
  intro: "Renders robots, point clouds, markers, maps, images, and transforms in one 3D scene.",
  schemas: [
    ros.TF_DATATYPES,
    ros.TRANSFORM_STAMPED_DATATYPES,
    ros.MARKER_DATATYPES,
    ros.MARKER_ARRAY_DATATYPES,
    ros.OCCUPANCY_GRID_DATATYPES,
    ros.VOXEL_GRID_DATATYPES,
    ros.GRID_MAP_DATATYPES,
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
    foxglove.VOXEL_GRID_DATATYPES,
    COMPRESSED_VIDEO_DATATYPES,
  ].flatMap((set) => [...set]),
  buttons: Object.values(THREE_DEE_BUTTONS),
  settings: threeDeeGuideSettings,
  sections: [
    {
      title: "Measuring",
      items: [["Results in", "Report values in the display frame or any other frame."]],
    },
  ],
};

export default docs;
