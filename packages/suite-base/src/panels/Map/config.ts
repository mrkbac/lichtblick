// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { produce } from "immer";
import * as _ from "lodash-es";

import { parseMessagePath } from "@lichtblick/message-path";
import {
  SettingsTreeAction,
  SettingsTreeFields,
  SettingsTreeNode,
  SettingsTreeNodes,
  Topic,
} from "@lichtblick/suite";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";
import { lineColors } from "@lichtblick/suite-base/util/plotColors";

import type { Units } from "./geo";
import {
  layerLabel,
  MapLayer,
  PRESETS,
  resolveSource,
  SourceKind,
  SourceParams,
  validateSourceUrl,
} from "./layers";
import { isGeoJSONSchema } from "./support";

export type HistoryStyle = "points" | "line" | "both" | "none";
export type ColorBy = "topic" | "speed" | "path";
export type TopicStyle = {
  history?: HistoryStyle;
  pointSize?: number;
  accuracy?: boolean;
  /** Color the track by the topic color, ground speed, or a numeric message path. */
  colorBy?: ColorBy;
  colorPath?: string;
  /** Color scale bounds; undefined = automatic. */
  colorMin?: number;
  colorMax?: number;
  colorReverse?: boolean;
};

// Persisted panel state
export type Config = {
  center?: { lat: number; lon: number };
  zoomLevel?: number;
  bearing?: number;
  pitch?: number;
  /** Top-most layer first. */
  layers: MapLayer[];
  projection: "mercator" | "globe";
  units: Units;
  followTopic: string;
  followMode: "center" | "heading";
  allowRotation: boolean;
  showScale: boolean;
  showCoordinates: boolean;
  disabledTopics: string[];
  topicColors: Record<string, string>;
  topicStyles: Record<string, TopicStyle>;
};

/** Fields written by the Leaflet version of this panel. */
type LegacyConfig = {
  layer?: string;
  customTileUrl?: string;
  maxNativeZoom?: number;
};

export const DEFAULT_POINT_SIZE = 3;

export function newLayerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function migrateLayers(legacy: LegacyConfig): MapLayer[] {
  const base = { id: "base", visible: true, opacity: 1 };
  switch (legacy.layer) {
    case "map":
      return [{ ...base, source: "osm" }];
    case "satellite":
      return [{ ...base, source: "esri-imagery" }];
    case "custom":
      return [
        {
          ...base,
          source: "custom",
          custom: {
            kind: "raster",
            url: legacy.customTileUrl ?? "",
            maxZoom: legacy.maxNativeZoom,
          },
        },
      ];
    default:
      // New panel.
      return [{ ...base, source: "ofm-liberty" }];
  }
}

export function normalizeConfig(initial: unknown): Config {
  const config = (initial ?? {}) as Partial<Config> & LegacyConfig;
  return {
    center: config.center,
    zoomLevel: config.zoomLevel,
    bearing: config.bearing,
    pitch: config.pitch,
    layers: config.layers ?? migrateLayers(config),
    projection: config.projection ?? "mercator",
    units: config.units ?? "metric",
    followTopic: config.followTopic ?? "",
    followMode: config.followMode ?? "center",
    allowRotation: config.allowRotation ?? true,
    showScale: config.showScale ?? true,
    showCoordinates: config.showCoordinates ?? true,
    disabledTopics: config.disabledTopics ?? [],
    topicColors: config.topicColors ?? {},
    topicStyles: config.topicStyles ?? {},
  };
}

const CUSTOM_KIND_LABELS: Record<SourceKind, string> = {
  raster: "Custom raster tiles / PMTiles",
  vector: "Custom vector style (style.json)",
  dem: "Custom elevation tiles (DEM)",
  geotiff: "GeoTIFF file (URL)",
};

const SAVED_PREFIX = "saved:";

function shortUrl(url: string): string {
  const stripped = url.replace(/^[a-z]+:\/\//i, "");
  return stripped.length > 48 ? `${stripped.slice(0, 22)}…${stripped.slice(-22)}` : stripped;
}

function sourceOptions(saved: readonly SourceParams[]) {
  return [
    ..._.map(PRESETS, (preset, value) => ({
      value,
      label: `${preset.group}: ${preset.label}`,
    })),
    ..._.map(CUSTOM_KIND_LABELS, (label, kind) => ({
      value: `custom:${kind}`,
      label,
    })),
    ...saved.map((source, i) => ({
      value: `${SAVED_PREFIX}${i}`,
      label: `Saved ${source.kind}: ${shortUrl(source.url)}`,
    })),
  ];
}

function customSourceFields(kind: SourceKind, custom: SourceParams): SettingsTreeFields {
  const tiled = kind === "raster" || kind === "dem";
  const urlHelp: Record<SourceKind, string> = {
    raster:
      "XYZ template with {z} {x} {y} (also {quadkey}, {bbox-epsg-3857}), a TileJSON URL, or pmtiles://https://… for a PMTiles archive.",
    dem: "Terrarium or Terrain-RGB tiles: XYZ template, TileJSON URL, or pmtiles://https://…",
    vector:
      "A MapLibre / Mapbox GL style JSON. Styles that need an API key must include it in the URL.",
    geotiff:
      "GeoTIFF in WGS84 (EPSG:4326), Web Mercator (EPSG:3857), or UTM (EPSG:326xx/327xx). Large files are downsampled to 4096 px.",
  };
  const fields: SettingsTreeFields = {
    url: {
      label: kind === "vector" ? "Style URL" : kind === "geotiff" ? "File URL" : "Tile URL",
      input: "string",
      value: custom.url,
      placeholder:
        kind === "vector"
          ? "https://example.com/style.json"
          : kind === "geotiff"
            ? "https://example.com/orthophoto.tif"
            : "https://example.com/{z}/{x}/{y}.png",
      error: validateSourceUrl(custom),
      help: urlHelp[kind],
    },
  };
  if (tiled) {
    fields.maxZoom = {
      label: "Max tile zoom",
      input: "number",
      value: custom.maxZoom,
      min: 0,
      max: 24,
      step: 1,
      placeholder: "22",
      help: "Highest zoom the server provides. Zooming further scales up those tiles instead of requesting missing ones.",
    };
    fields.tileSize = {
      label: "Tile size",
      input: "select",
      value: custom.tileSize ?? 256,
      options: [256, 512].map((size) => ({ label: `${size} px`, value: size })),
    };
  }
  if (kind === "raster") {
    fields.scheme = {
      label: "Y axis",
      input: "select",
      value: custom.scheme ?? "xyz",
      options: [
        { label: "XYZ (y down)", value: "xyz" },
        { label: "TMS (y up)", value: "tms" },
      ],
    };
  }
  if (kind === "dem") {
    fields.encoding = {
      label: "Encoding",
      input: "select",
      value: custom.encoding ?? "terrarium",
      options: [
        { label: "Terrarium", value: "terrarium" },
        { label: "Mapbox Terrain-RGB", value: "mapbox" },
      ],
    };
  }
  if (kind !== "vector") {
    fields.attribution = {
      label: "Attribution",
      input: "string",
      value: custom.attribution,
      placeholder: "© Data provider",
    };
  }
  return fields;
}

function layerNode(
  layer: MapLayer,
  index: number,
  count: number,
  saved: readonly SourceParams[],
  error: string | undefined,
): SettingsTreeNode {
  const kind =
    layer.source === "custom" ? (layer.custom?.kind ?? "raster") : PRESETS[layer.source]?.kind;
  const fields: SettingsTreeFields = {
    source: {
      label: "Source",
      input: "select",
      value: layer.source === "custom" ? `custom:${kind}` : layer.source,
      options: sourceOptions(saved),
    },
    ...(layer.source === "custom" && kind
      ? customSourceFields(kind, layer.custom ?? { kind, url: "" })
      : {}),
  };

  if (kind === "vector") {
    fields.vectorContent = {
      label: "Show",
      input: "select",
      value: layer.vectorContent ?? "all",
      options: [
        { label: "Everything", value: "all" },
        { label: "Roads and labels only", value: "lines-labels" },
      ],
      help: "Roads and labels only turns a vector map into a transparent overlay, e.g. on top of satellite imagery.",
    };
  }

  if (kind === "dem") {
    fields.hillshade = {
      label: "Hillshade",
      input: "boolean",
      value: layer.hillshade !== false,
    };
    if (layer.hillshade !== false) {
      fields.opacity = {
        label: "Shading",
        input: "slider",
        value: layer.opacity,
        min: 0,
        max: 1,
        step: 0.05,
      };
    }
    fields.terrain = {
      label: "3D terrain",
      input: "boolean",
      value: layer.terrain === true,
      help: "Raise the map by elevation. Tilt the map (right-drag or ctrl+drag) to see it.",
    };
    if (layer.terrain === true) {
      fields.exaggeration = {
        label: "Exaggeration",
        input: "slider",
        value: layer.exaggeration ?? 1,
        min: 0.1,
        max: 5,
        step: 0.1,
      };
    }
  } else {
    fields.opacity = {
      label: "Opacity",
      input: "slider",
      value: layer.opacity,
      min: 0,
      max: 1,
      step: 0.05,
    };
  }

  return {
    label: layerLabel(layer),
    renamable: true,
    visible: layer.visible,
    reorderable: true,
    order: index,
    error,
    fields,
    actions: [
      ...(index > 0 ? [{ type: "action" as const, id: "move-up", label: "Move up" }] : []),
      ...(index < count - 1
        ? [{ type: "action" as const, id: "move-down", label: "Move down" }]
        : []),
      { type: "action", id: "delete-layer", label: "Delete layer" },
    ],
  };
}

function colorScaleFields(style: TopicStyle): SettingsTreeFields {
  const pathError =
    style.colorBy === "path" && style.colorPath
      ? parseMessagePath(style.colorPath) == undefined
        ? "Invalid message path"
        : undefined
      : undefined;
  return {
    colorPath:
      style.colorBy === "path"
        ? {
            label: "Value path",
            input: "messagepath",
            value: style.colorPath ?? "",
            validTypes: PLOTABLE_ROS_TYPES,
            error: pathError,
          }
        : undefined,
    colorMin: {
      label: "Scale min",
      input: "number",
      value: style.colorMin,
      placeholder: "auto",
    },
    colorMax: {
      label: "Scale max",
      input: "number",
      value: style.colorMax,
      placeholder: "auto",
    },
    colorReverse: { label: "Reverse colors", input: "boolean", value: style.colorReverse === true },
  };
}

function topicNode(config: Config, topic: Omit<Topic, "datatype">): SettingsTreeNode {
  const color = config.topicColors[topic.name];
  const style = config.topicStyles[topic.name] ?? {};
  const isNav = !isGeoJSONSchema(topic.schemaName);
  return {
    label: topic.name,
    visible: !config.disabledTopics.includes(topic.name),
    fields: {
      colorBy: isNav
        ? {
            label: "Color by",
            input: "select",
            value: style.colorBy ?? "topic",
            options: [
              { label: "Topic color", value: "topic" },
              { label: "Speed", value: "speed" },
              { label: "Message path value", value: "path" },
            ],
            help: "Color the track by ground speed (from the fixes) or by a numeric value from any topic, matched by time.",
          }
        : undefined,
      ...(isNav && (style.colorBy ?? "topic") !== "topic" ? colorScaleFields(style) : {}),
      coloring: {
        label: (style.colorBy ?? "topic") === "topic" ? "Coloring" : "Current position",
        input: "select",
        value: color ? "Custom" : "Automatic",
        options: [
          { label: "Automatic", value: "Automatic" },
          { label: "Custom", value: "Custom" },
        ],
      },
      color: color ? { label: "Color", input: "rgb", value: color } : undefined,
      history: isNav
        ? {
            label: "Track",
            input: "select",
            value: style.history ?? "points",
            options: [
              { label: "Points", value: "points" },
              { label: "Line", value: "line" },
              { label: "Points and line", value: "both" },
              { label: "Hidden", value: "none" },
            ],
            help: "How the full recorded track is drawn. The current position is always shown.",
          }
        : undefined,
      pointSize: isNav
        ? {
            label: "Point size",
            input: "number",
            value: style.pointSize ?? DEFAULT_POINT_SIZE,
            min: 1,
            max: 20,
            step: 1,
          }
        : undefined,
      accuracy: isNav
        ? {
            label: "Accuracy ellipse",
            input: "boolean",
            value: style.accuracy ?? true,
            help: "Draw the position covariance around the current fix.",
          }
        : undefined,
    },
  };
}

export function buildSettingsTree(
  config: Config,
  eligibleTopics: Omit<Topic, "datatype">[],
  saved: readonly SourceParams[],
  layerErrors: ReadonlyMap<string, string>,
): SettingsTreeNodes {
  const followOptions = eligibleTopics
    .filter((t) => !isGeoJSONSchema(t.schemaName) && !config.disabledTopics.includes(t.name))
    .map((t) => ({ label: t.name, value: t.name }));

  const general: SettingsTreeFields = {
    followTopic: {
      label: "Follow topic",
      input: "select",
      value: config.followTopic,
      options: [{ label: "Off", value: "" }, ...followOptions],
    },
    followMode: config.followTopic
      ? {
          label: "Follow mode",
          input: "select",
          value: config.followMode,
          options: [
            { label: "Keep centered", value: "center" },
            { label: "Centered, heading up", value: "heading" },
          ],
          help: "Heading up rotates the map so the direction of travel points up.",
        }
      : undefined,
    projection: {
      label: "Projection",
      input: "select",
      value: config.projection,
      options: [
        { label: "Flat (Web Mercator)", value: "mercator" },
        { label: "Globe", value: "globe" },
      ],
    },
    units: {
      label: "Units",
      input: "select",
      value: config.units,
      options: [
        { label: "Metric", value: "metric" },
        { label: "Imperial", value: "imperial" },
        { label: "Nautical", value: "nautical" },
      ],
    },
    allowRotation: {
      label: "Rotate and tilt",
      input: "boolean",
      value: config.allowRotation,
      help: "Right-drag or ctrl+drag to rotate and tilt the map.",
    },
    showScale: {
      label: "Scale bar",
      input: "boolean",
      value: config.showScale,
    },
    showCoordinates: {
      label: "Cursor coordinates",
      input: "boolean",
      value: config.showCoordinates,
    },
  };

  const layers: SettingsTreeNode = {
    label: "Map layers",
    actions: [
      {
        type: "action",
        id: "add-layer",
        label: "Add layer",
        icon: "Add",
        display: "inline",
      },
      ...(saved.length > 0
        ? [
            {
              type: "action" as const,
              id: "forget-saved",
              label: "Forget saved custom sources",
            },
          ]
        : []),
    ],
    children: Object.fromEntries(
      config.layers.map((layer, i) => [
        String(i),
        layerNode(layer, i, config.layers.length, saved, layerErrors.get(layer.id)),
      ]),
    ),
  };

  return {
    general: { label: "General", fields: general },
    layers,
    topics: {
      label: "Topics",
      children: Object.fromEntries(eligibleTopics.map((t) => [t.name, topicNode(config, t)])),
    },
  };
}

function updateLayerSource(layer: MapLayer, choice: string, saved: readonly SourceParams[]) {
  if (choice.startsWith(SAVED_PREFIX)) {
    const source = saved[Number(choice.slice(SAVED_PREFIX.length))];
    if (!source) {
      return;
    }
    layer.source = "custom";
    layer.custom = { ...source };
  } else if (choice.startsWith("custom:")) {
    const kind = choice.slice("custom:".length) as SourceKind;
    layer.source = "custom";
    layer.custom = {
      kind,
      url: layer.custom?.kind === kind ? layer.custom.url : "",
    };
  } else {
    layer.source = choice;
    layer.custom = undefined;
  }
  layer.label = undefined;
  // Full-strength hillshade is very dark; start elevation layers subtle.
  if (resolveSource(layer)?.kind === "dem" || layer.custom?.kind === "dem") {
    layer.opacity = Math.min(layer.opacity, 0.5);
  }
}

function updateLayer(
  draft: Config,
  path: readonly string[],
  value: unknown,
  saved: readonly SourceParams[],
) {
  const layer = draft.layers[Number(path[1])];
  const field = path[2];
  if (!layer || field == undefined) {
    return;
  }
  const custom = layer.custom;
  switch (field) {
    case "visible":
      layer.visible = value === true;
      break;
    case "label":
      layer.label = typeof value === "string" && value.length > 0 ? value : undefined;
      break;
    case "source":
      updateLayerSource(layer, String(value), saved);
      break;
    case "url":
      if (custom) {
        custom.url = typeof value === "string" ? value.trim() : "";
      }
      break;
    case "attribution":
      if (custom) {
        custom.attribution = typeof value === "string" && value.length > 0 ? value : undefined;
      }
      break;
    case "maxZoom":
    case "tileSize":
      if (custom) {
        custom[field] = typeof value === "number" && isFinite(value) ? value : undefined;
      }
      break;
    case "scheme":
      if (custom) {
        custom.scheme = value === "tms" ? "tms" : "xyz";
      }
      break;
    case "encoding":
      if (custom) {
        custom.encoding = value === "mapbox" ? "mapbox" : "terrarium";
      }
      break;
    case "opacity":
    case "exaggeration":
      if (typeof value === "number") {
        layer[field] = value;
      }
      break;
    case "hillshade":
    case "terrain":
      layer[field] = value === true;
      break;
    case "vectorContent":
      layer.vectorContent = value === "lines-labels" ? "lines-labels" : "all";
      break;
  }
}

function updateTopic(draft: Config, path: readonly string[], value: unknown) {
  const topic = path[1];
  if (topic == undefined) {
    return;
  }
  const style = (draft.topicStyles[topic] ??= {});
  switch (path[2]) {
    case "visible":
      draft.disabledTopics =
        value === true
          ? _.difference(draft.disabledTopics, [topic])
          : _.union(draft.disabledTopics, [topic]);
      if (value !== true && draft.followTopic === topic) {
        draft.followTopic = "";
      }
      break;
    case "coloring":
      if (value === "Custom") {
        draft.topicColors[topic] = lineColors[0]!;
      } else {
        delete draft.topicColors[topic];
      }
      break;
    case "color":
      if (typeof value === "string") {
        draft.topicColors[topic] = value;
      }
      break;
    case "history":
      style.history = value as HistoryStyle;
      break;
    case "pointSize":
      style.pointSize = typeof value === "number" ? value : undefined;
      break;
    case "accuracy":
      style.accuracy = value === true;
      break;
    case "colorBy":
      style.colorBy = value === "speed" || value === "path" ? value : "topic";
      style.colorMin = style.colorMax = undefined;
      break;
    case "colorPath":
      style.colorPath = typeof value === "string" && value.length > 0 ? value : undefined;
      break;
    case "colorMin":
    case "colorMax":
      style[path[2]] = typeof value === "number" && isFinite(value) ? value : undefined;
      break;
    case "colorReverse":
      style.colorReverse = value === true;
      break;
  }
}

function moveLayer(draft: Config, from: number, to: number) {
  const [moved] = draft.layers.splice(from, 1);
  if (moved) {
    draft.layers.splice(Math.max(0, Math.min(to, draft.layers.length)), 0, moved);
  }
}

/** Pure reducer for settings tree actions. "forget-saved" is a side effect left to the caller. */
export function applySettingsAction(
  config: Config,
  action: SettingsTreeAction,
  saved: readonly SourceParams[],
): Config {
  return produce(config, (draft) => {
    switch (action.action) {
      case "update": {
        const { path, value } = action.payload;
        if (path[0] === "general" && path[1] != undefined) {
          (draft as Record<string, unknown>)[path[1]] = value;
          if (path[1] === "allowRotation" && value !== true) {
            draft.bearing = 0;
            draft.pitch = 0;
          }
        } else if (path[0] === "layers") {
          updateLayer(draft, path, value, saved);
        } else if (path[0] === "topics") {
          updateTopic(draft, path, value);
        }
        break;
      }
      case "reorder-node":
        moveLayer(draft, Number(action.payload.path[1]), Number(action.payload.targetPath[1]));
        break;
      case "perform-node-action": {
        const index = Number(action.payload.path[1]);
        switch (action.payload.id) {
          case "add-layer":
            // New layers go on top; a transparent overlay is the most common addition.
            draft.layers.unshift({
              id: newLayerId(),
              source: "esri-transportation",
              visible: true,
              opacity: 1,
            });
            break;
          case "delete-layer":
            draft.layers.splice(index, 1);
            break;
          case "move-up":
            moveLayer(draft, index, index - 1);
            break;
          case "move-down":
            moveLayer(draft, index, index + 1);
            break;
        }
        break;
      }
    }
  });
}
