// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ArrowAutofitHeight20Regular,
  Delete20Regular,
  LocationAdd20Regular,
  Ruler20Regular,
  Triangle20Regular,
  ZoomFit20Regular,
} from "@fluentui/react-icons";

import type { PanelDocs } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";

import { MAP_SCHEMAS } from "./support";

const docs: PanelDocs = {
  intro:
    "Shows GPS tracks and GeoJSON on a map, with terrain, custom tile layers, and measuring tools.",
  schemas: MAP_SCHEMAS,
  sections: [
    {
      title: "Toolbar",
      items: [
        [
          "Distance and area",
          "Measure a path, or close it on its first point for an area.",
          Ruler20Regular,
        ],
        [
          "Height difference",
          "Height, horizontal and slope distance, and grade; needs 3D terrain.",
          ArrowAutofitHeight20Regular,
        ],
        ["Angle", "Angle at the middle of three points.", Triangle20Regular],
        [
          "Pin points",
          "Label points with coordinates, plus elevation and slope on terrain.",
          LocationAdd20Regular,
        ],
        ["Clear all", "Removes every measurement.", Delete20Regular],
        ["Zoom to data", "Fits the map to all shown topics.", ZoomFit20Regular],
      ],
    },
    {
      title: "Mouse",
      items: [
        ["Hover", "A track point or GeoJSON feature shows its details and previews that time."],
        ["Click", "Seeks playback to the time of the clicked point or feature."],
        ["Drag", "Pans. Right-drag or Ctrl-drag rotates and tilts (when Rotate and tilt is on)."],
        ["Drop a topic", "Drag a topic from the sidebar onto the map to show it."],
        ["Coordinates", "Click the cursor coordinates in the corner to copy them."],
      ],
    },
    {
      title: "Measuring",
      items: [
        ["Place", "Click the map to start a measurement; earlier ones stay on the map."],
        ["End a line", "Double-click or press Enter."],
        ["Close an area", "Click the first point of a distance line."],
        ["Move a point", "Drag it."],
        ["Insert a point", "Click (or drag) a midpoint of a distance line or area."],
        [
          "Delete a point",
          "Right-click or Alt-click it. Backspace removes the last one while drawing.",
        ],
        ["Select", "Click a point to select its measurement; Delete removes it, Esc deselects."],
      ],
    },
    {
      title: "Settings",
      items: [
        [
          "Topics",
          "Per topic: color by topic, speed, or a message path value; points or line; accuracy ellipse.",
        ],
        ["Follow topic", "Keeps the latest position centered, optionally heading up."],
        ["Map layers", "Stack base maps, satellite, hillshade, 3D terrain, or your own tiles."],
        [
          "Custom sources",
          "Raster tiles or PMTiles, vector style.json, elevation (DEM), GeoTIFF, 3D Tiles.",
        ],
        ["Projection", "Flat Web Mercator or a globe."],
        ["Units", "Metric, imperial, or nautical for the scale bar and measurements."],
      ],
    },
  ],
};

export default docs;
