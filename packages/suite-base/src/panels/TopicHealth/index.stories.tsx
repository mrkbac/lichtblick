// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { StoryObj } from "storybook-react-rsbuild";

import TopicHealthPanel from "@lichtblick/suite-base/panels/TopicHealth";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { Topic, TopicStats } from "@lichtblick/suite-base/players/types";
import PanelSetup from "@lichtblick/suite-base/stories/PanelSetup";

export default {
  title: "panels/TopicHealth",
  component: TopicHealthPanel,
};

const TOPICS: Topic[] = [
  { schemaName: "sensor_msgs/Imu", name: "/imu" },
  { schemaName: "sensor_msgs/NavSatFix", name: "/gps" },
  { schemaName: "tf2_msgs/TFMessage", name: "/tf" },
  { schemaName: "sensor_msgs/PointCloud2", name: "/lidar/front/points" },
  { schemaName: "sensor_msgs/PointCloud2", name: "/lidar/rear/points" },
  { schemaName: "sensor_msgs/CompressedImage", name: "/camera/front/image" },
  { schemaName: "sensor_msgs/CameraInfo", name: "/camera/front/camera_info" },
  { schemaName: "diagnostic_msgs/DiagnosticArray", name: "/diagnostics" },
];

const at = (sec: number) => ({ sec, nsec: 0 });
const STATS = new Map<string, TopicStats>([
  ["/imu", { numMessages: 2001, firstMessageTime: at(0), lastMessageTime: at(20) }],
  ["/gps", { numMessages: 101, firstMessageTime: at(0), lastMessageTime: at(10) }],
  ["/tf", { numMessages: 1001, firstMessageTime: at(0), lastMessageTime: at(20) }],
  ["/lidar/front/points", { numMessages: 201, firstMessageTime: at(0), lastMessageTime: at(20) }],
  ["/lidar/rear/points", { numMessages: 121, firstMessageTime: at(0), lastMessageTime: at(20) }],
  ["/camera/front/image", { numMessages: 601, firstMessageTime: at(0), lastMessageTime: at(20) }],
  [
    "/camera/front/camera_info",
    { numMessages: 601, firstMessageTime: at(0), lastMessageTime: at(20) },
  ],
  ["/diagnostics", { numMessages: 21, firstMessageTime: at(0), lastMessageTime: at(20) }],
]);

export const Recording: StoryObj = {
  render: () => (
    <PanelSetup
      fixture={{
        topics: TOPICS,
        capabilities: [PLAYER_CAPABILITIES.playbackControl],
        activeData: {
          startTime: at(0),
          endTime: at(20),
          currentTime: at(15),
          topicStats: STATS,
        },
      }}
    >
      <TopicHealthPanel
        overrideConfig={{
          tolerancePercent: 20,
          topics: {
            "/lidar/rear/points": { expectedHz: 10 },
            "/lidar/front/points": { expectedHz: 10 },
          },
        }}
      />
    </PanelSetup>
  ),
};

/** Indexed MCAP sources report only message counts, without first/last times. */
export const CountsOnly: StoryObj = {
  render: () => (
    <PanelSetup
      fixture={{
        topics: TOPICS,
        capabilities: [PLAYER_CAPABILITIES.playbackControl],
        activeData: {
          startTime: at(0),
          endTime: at(20),
          currentTime: at(15),
          topicStats: new Map(
            [...STATS].map(([name, stat]) => [name, { numMessages: stat.numMessages }]),
          ),
        },
      }}
    >
      <TopicHealthPanel overrideConfig={{ topics: { "/lidar/rear/points": { expectedHz: 10 } } }} />
    </PanelSetup>
  ),
};
