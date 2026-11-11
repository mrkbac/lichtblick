// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";

import {
  SettingsTreeAction,
  SettingsTreeFields,
  SettingsTreeNode,
  SettingsTreeNodeAction,
} from "@lichtblick/suite";
import { moveItem, moveUpDownActions } from "@lichtblick/suite-base/panels/utils";

import {
  hiddenVectorGroups,
  layerLabel,
  MapLayer,
  PRESETS,
  resolveSource,
  SourceKind,
  SourceParams,
  VECTOR_GROUPS,
  validateSourceUrl,
  VectorGroup,
} from "./layers";

// The map layer stack's settings, shared by the Map panel and the 3D panel's Map layer.

export function newLayerId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Source kinds MapLibre renders; the 3D panel adds "3dtiles". */
export const MAP_SOURCE_KINDS: readonly SourceKind[] = ["raster", "vector", "dem", "geotiff"];

const CUSTOM_KIND_LABELS: Record<SourceKind, string> = {
  raster: "Custom raster tiles / PMTiles",
  vector: "Custom vector style (style.json)",
  dem: "Custom elevation tiles (DEM)",
  geotiff: "GeoTIFF file (URL)",
  "3dtiles": "Custom 3D Tiles (tileset.json)",
};

const SAVED_PREFIX = "saved:";
const savedKey = (source: SourceParams) => `${source.kind}|${source.url}`;

function shortUrl(url: string): string {
  const stripped = url.replace(/^[a-z]+:\/\//i, "");
  return stripped.length > 48 ? `${stripped.slice(0, 22)}…${stripped.slice(-22)}` : stripped;
}

/** The first preset of a provider stands for the whole provider in the source picker. */
function providerKey(source: string): string {
  const provider = PRESETS[source]?.variant?.provider;
  return (provider && _.findKey(PRESETS, (p) => p.variant?.provider === provider)) ?? source;
}

function sourceOptions(saved: readonly SourceParams[], kinds: readonly SourceKind[]) {
  return [
    ..._.map(
      _.pickBy(PRESETS, (preset) => kinds.includes(preset.kind)),
      (preset, value) => ({
        value,
        label: preset.variant?.provider ?? preset.label,
      }),
    ).filter(({ value }) => providerKey(value) === value),
    ...kinds.map((kind) => ({ value: `custom:${kind}`, label: CUSTOM_KIND_LABELS[kind] })),
    // Keyed by identity, not position: the saved list can change while the tree is open.
    ...saved
      .filter((source) => kinds.includes(source.kind))
      .map((source) => ({
        value: `${SAVED_PREFIX}${savedKey(source)}`,
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
    "3dtiles":
      "A 3D Tiles tileset.json with georeferenced (Earth-centered) content, e.g. a photogrammetry export.",
    geotiff:
      "GeoTIFF in WGS84 (EPSG:4326), Web Mercator (EPSG:3857), or UTM (EPSG:326xx/327xx). Large files are downsampled to 4096 px.",
  };
  const fields: SettingsTreeFields = {
    url: {
      label:
        kind === "vector"
          ? "Style URL"
          : kind === "geotiff" || kind === "3dtiles"
            ? "File URL"
            : "Tile URL",
      input: "string",
      value: custom.url,
      placeholder:
        kind === "vector"
          ? "https://example.com/style.json"
          : kind === "geotiff"
            ? "https://example.com/orthophoto.tif"
            : kind === "3dtiles"
              ? "https://example.com/tileset.json"
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
  kinds: readonly SourceKind[],
  error: string | undefined,
): SettingsTreeNode {
  const kind =
    layer.source === "custom" ? (layer.custom?.kind ?? "raster") : PRESETS[layer.source]?.kind;
  const variant = PRESETS[layer.source]?.variant;
  const fields: SettingsTreeFields = {
    source: {
      label: "Source",
      input: "select",
      value: layer.source === "custom" ? `custom:${kind}` : providerKey(layer.source),
      options: sourceOptions(saved, kinds),
    },
    style: variant
      ? {
          label: "Style",
          input: "select",
          value: layer.source,
          options: _.flatMap(PRESETS, (preset, value) =>
            preset.variant?.provider === variant.provider
              ? [{ label: preset.variant.style, value }]
              : [],
          ),
        }
      : undefined,
    ...(layer.source === "custom" && kind
      ? customSourceFields(kind, layer.custom ?? { kind, url: "" })
      : {}),
  };

  if (kind === "vector") {
    const hidden = hiddenVectorGroups(layer);
    for (const [group, label] of Object.entries(VECTOR_GROUPS)) {
      fields[`show:${group}`] =
        group === "buildings"
          ? {
              label,
              input: "toggle",
              value: hidden.includes("buildings")
                ? "off"
                : layer.buildings3d === false
                  ? "flat"
                  : "3d",
              options: [
                { label: "Off", value: "off" },
                { label: "Flat", value: "flat" },
                { label: "3D", value: "3d" },
              ],
              help: "3D extrudes buildings by height from zoom 14. Tilt the map (right-drag or ctrl+drag) to see them.",
            }
          : {
              label,
              input: "boolean",
              value: !hidden.includes(group as VectorGroup),
              help:
                group === "areas"
                  ? "Turn off land and water to use the map as an overlay, e.g. roads and labels on satellite imagery."
                  : undefined,
            };
    }
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
  } else if (kind === "3dtiles") {
    fields.heightOffset = {
      label: "Height offset",
      input: "number",
      value: layer.heightOffset ?? 0,
      step: 0.5,
      precision: 2,
      help: "Meters added to the location fix's altitude (WGS 84 ellipsoid height) to line the tiles up with the scene.",
    };
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
      ...moveUpDownActions(index, count),
      { type: "action", id: "delete-layer", label: "Delete layer" },
    ],
  };
}

function updateLayerSource(layer: MapLayer, choice: string, saved: readonly SourceParams[]) {
  if (choice.startsWith(SAVED_PREFIX)) {
    const key = choice.slice(SAVED_PREFIX.length);
    const source = saved.find((s) => savedKey(s) === key);
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
  } else if (providerKey(layer.source) !== choice) {
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
  layer: MapLayer,
  field: string,
  value: unknown,
  saved: readonly SourceParams[],
) {
  if (field.startsWith("show:")) {
    const group = field.slice("show:".length) as VectorGroup;
    const show = group === "buildings" ? value !== "off" : value === true;
    if (group === "buildings" && show) {
      layer.buildings3d = value === "3d";
    }
    layer.hiddenGroups = _.uniq(
      hiddenVectorGroups(layer)
        .filter((g) => g !== group)
        .concat(show ? [] : [group]),
    );
    layer.vectorContent = undefined;
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
    case "heightOffset":
      if (typeof value === "number") {
        layer[field] = value;
      }
      break;
    case "hillshade":
    case "terrain":
      layer[field] = value === true;
      break;
    case "style":
      if (typeof value === "string" && PRESETS[value]) {
        layer.source = value;
        layer.label = undefined;
      }
      break;
  }
}

/** Actions for the node that holds the layer stack. */
export function layerStackActions(saved: readonly SourceParams[]): SettingsTreeNodeAction[] {
  return [
    { type: "action", id: "add-layer", label: "Add layer", icon: "Add", display: "inline" },
    ...(saved.length > 0
      ? [{ type: "action" as const, id: "forget-saved", label: "Forget saved custom sources" }]
      : []),
  ];
}

/** One child node per layer, keyed by index, top-most first. */
export function layerStackChildren(
  layers: readonly MapLayer[],
  saved: readonly SourceParams[],
  kinds: readonly SourceKind[],
  errorFor: (layer: MapLayer) => string | undefined,
): Record<string, SettingsTreeNode> {
  return Object.fromEntries(
    layers.map((layer, i) => [
      String(i),
      layerNode(layer, i, layers.length, saved, kinds, errorFor(layer)),
    ]),
  );
}

/**
 * Apply a settings action to a layer stack in place (e.g. an immer draft). `depth` is the index
 * of the layer index in the action's path. "forget-saved" is a side effect left to the caller.
 */
export function applyLayerStackAction(
  layers: MapLayer[],
  action: SettingsTreeAction,
  depth: number,
  saved: readonly SourceParams[],
): void {
  switch (action.action) {
    case "update": {
      const { path, value } = action.payload;
      const layer = layers[Number(path[depth])];
      const field = path[depth + 1];
      if (layer && field != undefined) {
        updateLayer(layer, field, value, saved);
      }
      break;
    }
    case "reorder-node":
      moveItem(
        layers,
        Number(action.payload.path[depth]),
        Number(action.payload.targetPath[depth]),
      );
      break;
    case "perform-node-action": {
      const index = Number(action.payload.path[depth]);
      switch (action.payload.id) {
        case "add-layer":
          // New layers go on top; a transparent overlay is the most common addition.
          layers.unshift({
            id: newLayerId(),
            source: "esri-transportation",
            visible: true,
            opacity: 1,
          });
          break;
        case "delete-layer":
          layers.splice(index, 1);
          break;
        case "move-up":
          moveItem(layers, index, index - 1);
          break;
        case "move-down":
          moveItem(layers, index, index + 1);
          break;
      }
      break;
    }
  }
}
