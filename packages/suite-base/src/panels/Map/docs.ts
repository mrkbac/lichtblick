// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { MAP_BUTTONS } from "./buttons";
import { buildSettingsTree, normalizeConfig } from "./config";
import { MAP_SCHEMAS } from "./support";

// A topic and layers chosen so the guide lists the per-topic, custom-source, and elevation fields.
const topic = { name: "Each topic", schemaName: "sensor_msgs/NavSatFix" };
const layer = { visible: true, opacity: 1 };

const docs: PanelDocs = {
  intro:
    "Shows GPS tracks and GeoJSON on a map, with terrain, custom tile layers, and measuring tools.",
  schemas: MAP_SCHEMAS,
  buttons: Object.values(MAP_BUTTONS),
  settings: () =>
    buildSettingsTree(
      {
        ...normalizeConfig(undefined),
        followTopic: topic.name,
        topicColors: { [topic.name]: "#4e98e2" },
        topicStyles: { [topic.name]: { colorBy: "path" } },
        layers: [
          { ...layer, id: "map", source: "ofm-liberty", label: "Built-in map" },
          {
            ...layer,
            id: "tiles",
            source: "custom",
            custom: { kind: "raster", url: "https://example.com/{z}/{x}/{y}.png" },
            label: "Custom tiles",
          },
          {
            ...layer,
            id: "elevation",
            source: "custom",
            custom: { kind: "dem", url: "https://example.com/{z}/{x}/{y}.png" },
            terrain: true,
            label: "Elevation",
          },
        ],
      },
      [topic],
      [],
      new Map(),
    ),
  sections: [
    {
      title: "Measuring",
      items: [
        [
          "Measurements",
          "Earlier measurements stay on the map until cleared; they aren't saved with the layout.",
        ],
      ],
    },
  ],
};

export default docs;
