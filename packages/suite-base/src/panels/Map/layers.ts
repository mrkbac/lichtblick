// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";

import type { LngLat } from "./geo";

export type SourceKind = "raster" | "vector" | "dem" | "geotiff";

/** Everything needed to fetch one map source. */
export type SourceParams = {
  kind: SourceKind;
  /**
   * raster/dem: XYZ template ({z}/{x}/{y}, {quadkey}, {bbox-epsg-3857}), a TileJSON URL, or
   * `pmtiles://…`. vector: a MapLibre style JSON URL. geotiff: URL of a GeoTIFF file.
   */
  url: string;
  attribution?: string;
  /** Highest zoom the server provides; the map overzooms beyond it. */
  maxZoom?: number;
  tileSize?: number;
  scheme?: "xyz" | "tms";
  encoding?: "terrarium" | "mapbox";
};

export type Preset = SourceParams & {
  label: string;
  /** One style of a provider: the source picker lists the provider once, the layer picks a style. */
  variant?: { provider: string; style: string };
};

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTRIBUTION = "&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const OFM = "OpenFreeMap (vector)";
const ESRI_PROVIDER = "Esri (raster)";

/** Free public services that need no API key. */
export const PRESETS: Record<string, Preset> = {
  "ofm-liberty": {
    label: "OpenFreeMap Liberty",
    variant: { provider: OFM, style: "Liberty" },
    kind: "vector",
    url: "https://tiles.openfreemap.org/styles/liberty",
  },
  "ofm-bright": {
    label: "OpenFreeMap Bright",
    variant: { provider: OFM, style: "Bright" },
    kind: "vector",
    url: "https://tiles.openfreemap.org/styles/bright",
  },
  "ofm-positron": {
    label: "OpenFreeMap Positron (light)",
    variant: { provider: OFM, style: "Positron (light)" },
    kind: "vector",
    url: "https://tiles.openfreemap.org/styles/positron",
  },
  "ofm-dark": {
    label: "OpenFreeMap Dark",
    variant: { provider: OFM, style: "Dark" },
    kind: "vector",
    url: "https://tiles.openfreemap.org/styles/dark",
  },
  "ofm-fiord": {
    label: "OpenFreeMap Fiord",
    variant: { provider: OFM, style: "Fiord" },
    kind: "vector",
    url: "https://tiles.openfreemap.org/styles/fiord",
  },
  osm: {
    label: "OpenStreetMap",
    kind: "raster",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
  },
  "esri-imagery": {
    label: "Esri satellite imagery",
    variant: { provider: ESRI_PROVIDER, style: "Satellite imagery" },
    kind: "raster",
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    maxZoom: 19,
    attribution: ESRI_ATTRIBUTION,
  },
  "esri-labels": {
    label: "Esri labels overlay",
    variant: { provider: ESRI_PROVIDER, style: "Labels overlay" },
    kind: "raster",
    url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    maxZoom: 19,
    attribution: ESRI_ATTRIBUTION,
  },
  "esri-transportation": {
    label: "Esri roads overlay",
    variant: { provider: ESRI_PROVIDER, style: "Roads overlay" },
    kind: "raster",
    url: `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`,
    maxZoom: 19,
    attribution: ESRI_ATTRIBUTION,
  },
  mapterhorn: {
    label: "Mapterhorn elevation",
    kind: "dem",
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    tileSize: 512,
    maxZoom: 12,
    encoding: "terrarium",
    attribution: '<a href="https://mapterhorn.com/attribution">&copy; Mapterhorn</a>',
  },
  "aws-terrain": {
    label: "AWS elevation (Terrain Tiles)",
    kind: "dem",
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    tileSize: 256,
    maxZoom: 15,
    encoding: "terrarium",
    attribution:
      '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a>',
  },
};

export type MapLayer = {
  /** Stable id, used to namespace sources and style layers. */
  id: string;
  /** A PRESETS key, or "custom" for `custom`. */
  source: string;
  custom?: SourceParams;
  label?: string;
  visible: boolean;
  /** Opacity for imagery and vector styles, intensity for hillshade. */
  opacity: number;
  /** Vector styles only: feature groups to leave out, e.g. all but roads and labels over imagery. */
  hiddenGroups?: VectorGroup[];
  /** Legacy (before `hiddenGroups`): "lines-labels" hid areas, buildings, and borders. */
  vectorContent?: "all" | "lines-labels";
  /** Vector styles only: extrude buildings by their height when tilted. Default on. */
  buildings3d?: boolean;
  /** Elevation only. */
  hillshade?: boolean;
  terrain?: boolean;
  exaggeration?: number;
};

export function resolveSource(layer: MapLayer): SourceParams | undefined {
  if (layer.source === "custom") {
    return layer.custom?.url ? layer.custom : undefined;
  }
  return PRESETS[layer.source];
}

export function layerLabel(layer: MapLayer): string {
  if (layer.label) {
    return layer.label;
  }
  if (layer.source === "custom") {
    return `Custom ${layer.custom?.kind ?? "raster"}`;
  }
  return PRESETS[layer.source]?.label ?? layer.source;
}

/** Placeholders MapLibre substitutes in tile URL templates. */
const TILE_PLACEHOLDERS = [
  "{x}",
  "{y}",
  "{z}",
  "{quadkey}",
  "{bbox-epsg-3857}",
  "{ratio}",
  "{prefix}",
];

export function validateSourceUrl(params: SourceParams): string | undefined {
  const url = params.url.trim();
  if (url.length === 0) {
    return undefined;
  }
  if (!/^(https?|pmtiles|blob|data|file|package):/i.test(url)) {
    return "URL must start with http(s)://, pmtiles://, or another supported scheme";
  }
  if (params.kind === "raster" || params.kind === "dem") {
    for (const placeholder of url.match(/\{.+?\}/g) ?? []) {
      if (!TILE_PLACEHOLDERS.includes(placeholder)) {
        return `Unsupported placeholder ${placeholder}`;
      }
    }
  }
  return undefined;
}

/** Style validation rejects keys that are present but undefined. */
function defined<T extends object>(spec: T): T {
  return _.omitBy(spec, _.isUndefined) as T;
}

/** Template URLs go in `tiles`; TileJSON and PMTiles archives go in `url`. */
function tileEndpoint(url: string): { tiles: string[] } | { url: string } {
  return url.includes("{") ? { tiles: [url] } : { url };
}

const OPACITY_PROPERTIES: Partial<Record<LayerSpecification["type"], string[]>> = {
  background: ["background-opacity"],
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
  circle: ["circle-opacity", "circle-stroke-opacity"],
  "fill-extrusion": ["fill-extrusion-opacity"],
  raster: ["raster-opacity"],
  heatmap: ["heatmap-opacity"],
};

type Expr = unknown;

function scaleOpacity(value: Expr, opacity: number): Expr {
  if (value == undefined) {
    return opacity;
  }
  if (typeof value === "number") {
    return value * opacity;
  }
  const scaleStop = (stop: unknown): unknown => (typeof stop === "number" ? stop * opacity : stop);
  if (Array.isArray(value)) {
    // Zoom expressions must stay top level, so scale their numeric outputs in place.
    if (value[0] === "interpolate" && JSON.stringify(value[2]) === '["zoom"]') {
      return value.map((v, i) => (i >= 4 && i % 2 === 0 ? scaleStop(v) : v));
    }
    if (value[0] === "step" && JSON.stringify(value[1]) === '["zoom"]') {
      return value.map((v, i) => (i >= 2 && i % 2 === 0 ? scaleStop(v) : v));
    }
    return (JSON.stringify(value) ?? "").includes('"zoom"') ? value : ["*", value, opacity];
  }
  if (typeof value === "object" && "stops" in value && Array.isArray(value.stops)) {
    // Legacy function syntax.
    const stops = value.stops as [unknown, unknown][];
    return { ...value, stops: stops.map(([z, v]) => [z, scaleStop(v)]) };
  }
  return value;
}

function withOpacity(layer: LayerSpecification, opacity: number): LayerSpecification {
  const keys = OPACITY_PROPERTIES[layer.type];
  if (opacity >= 1 || !keys || layer.type === "hillshade" || layer.type === "color-relief") {
    return layer;
  }
  const paint: Record<string, unknown> = {
    ...(layer as { paint?: object }).paint,
  };
  for (const key of keys) {
    paint[key] = scaleOpacity(paint[key], opacity);
  }
  return { ...layer, paint };
}

/**
 * Transport lines by source layer or layer id. Covers OpenMapTiles ("transportation", "aeroway")
 * and other common schemas (Shortbread "streets", Protomaps "roads", ...).
 */
const ROAD_LINE = /transport|road|street|highway|motorway|rail|path|bridge|tunnel|aeroway|ferry/i;

/** Feature groups of a vector style, top to bottom, with their settings labels. */
export const VECTOR_GROUPS = {
  labels: "Labels",
  pois: "Points of interest",
  roads: "Roads",
  buildings: "Buildings",
  boundaries: "Borders",
  areas: "Land & water",
} as const;

export type VectorGroup = keyof typeof VECTOR_GROUPS;

/** Group a style layer by its source layer (or id): OpenMapTiles names, plus common others. */
export function vectorGroup(layer: LayerSpecification): VectorGroup {
  const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
  const name = sourceLayer != undefined && sourceLayer !== "" ? sourceLayer : layer.id;
  if (layer.type === "symbol") {
    if (/poi|aerodrome/i.test(name)) {
      return "pois";
    }
    // Road markings such as one-way arrows; road names and shields are labels.
    return ROAD_LINE.test(name) && !/name|label|shield/i.test(name) ? "roads" : "labels";
  }
  if (/building/i.test(name)) {
    return "buildings";
  }
  if (/boundar|admin/i.test(name)) {
    return "boundaries";
  }
  return ROAD_LINE.test(name) && (layer.type === "line" || layer.type === "fill")
    ? "roads"
    : "areas";
}

export function hiddenVectorGroups(layer: MapLayer): readonly VectorGroup[] {
  return (
    layer.hiddenGroups ??
    (layer.vectorContent === "lines-labels" ? ["areas", "buildings", "boundaries"] : [])
  );
}

/**
 * Add or remove 3D buildings. Styles with an OpenMapTiles "building" layer but no extrusion (all
 * OpenFreeMap styles except Liberty) get one modeled on Liberty's, in the style's building color.
 */
export function withBuildings3d(
  layers: readonly LayerSpecification[],
  { enabled }: { enabled: boolean },
): readonly LayerSpecification[] {
  if (!enabled) {
    return layers.filter((layer) => layer.type !== "fill-extrusion");
  }
  if (layers.some((layer) => layer.type === "fill-extrusion")) {
    return layers;
  }
  const index = _.findLastIndex(
    layers,
    (layer) => layer.type === "fill" && layer["source-layer"] === "building",
  );
  const fill = layers[index];
  if (fill?.type !== "fill") {
    return layers;
  }
  const extrusion: LayerSpecification = {
    id: "building-3d",
    type: "fill-extrusion",
    source: fill.source,
    "source-layer": "building",
    minzoom: 14,
    filter: ["!", ["has", "hide_3d"]],
    paint: {
      "fill-extrusion-color": fill.paint?.["fill-color"] ?? "hsl(35,8%,85%)",
      "fill-extrusion-base": ["get", "render_min_height"],
      "fill-extrusion-height": ["get", "render_height"],
      "fill-extrusion-opacity": 0.8,
    },
  };
  return [...layers.slice(0, index + 1), extrusion, ...layers.slice(index + 1)];
}

export type ImageOverlay = {
  url: string;
  /** Corners: top-left, top-right, bottom-right, bottom-left. */
  coordinates: [LngLat, LngLat, LngLat, LngLat];
};

export type ComposeStyleInput = {
  /** Top-most layer first, as shown in the settings. */
  layers: readonly MapLayer[];
  /** Fetched vector styles by URL. */
  vectorStyles: ReadonlyMap<string, StyleSpecification>;
  /** Decoded GeoTIFFs by URL. */
  images: ReadonlyMap<string, ImageOverlay>;
  projection: "mercator" | "globe";
  overlay: {
    sources: Record<string, SourceSpecification>;
    layers: LayerSpecification[];
  };
};

/**
 * Merge the user's layer stack and the panel's data overlay into one MapLibre style. MapLibre
 * diffs successive styles, so unchanged layers are not reloaded.
 */
export function composeStyle(input: ComposeStyleInput): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    projection: { type: input.projection },
    sources: {},
    layers: [],
  };

  for (const layer of [...input.layers].reverse()) {
    const params = resolveSource(layer);
    if (!layer.visible || !params) {
      continue;
    }
    const id = layer.id;
    switch (params.kind) {
      case "raster":
        style.sources[id] = defined({
          type: "raster",
          ...tileEndpoint(params.url),
          tileSize: params.tileSize ?? 256,
          maxzoom: params.maxZoom ?? 22,
          scheme: params.scheme ?? "xyz",
          attribution: params.attribution,
        });
        style.layers.push({
          id,
          type: "raster",
          source: id,
          paint: { "raster-opacity": layer.opacity },
        });
        break;
      case "geotiff": {
        const image = input.images.get(params.url);
        if (image) {
          style.sources[id] = {
            type: "image",
            url: image.url,
            coordinates: image.coordinates,
          };
          style.layers.push({
            id,
            type: "raster",
            source: id,
            paint: { "raster-opacity": layer.opacity },
          });
        }
        break;
      }
      case "dem": {
        const source = defined({
          type: "raster-dem" as const,
          ...tileEndpoint(params.url),
          tileSize: params.tileSize ?? 256,
          maxzoom: params.maxZoom ?? 22,
          encoding: params.encoding ?? "terrarium",
          attribution: params.attribution,
        });
        if (layer.hillshade !== false) {
          style.sources[id] = source;
          style.layers.push({
            id,
            type: "hillshade",
            source: id,
            paint: { "hillshade-exaggeration": layer.opacity },
          });
        }
        // MapLibre renders better with a separate source for terrain than for hillshade.
        if (layer.terrain === true && style.terrain == undefined) {
          style.sources[`${id}:terrain`] = _.omit(source, "attribution");
          style.terrain = {
            source: `${id}:terrain`,
            exaggeration: layer.exaggeration ?? 1,
          };
        }
        break;
      }
      case "vector": {
        const vector = input.vectorStyles.get(params.url);
        if (!vector) {
          break;
        }
        // ponytail: one glyph/sprite set per map; the first vector style wins. All OpenFreeMap
        // styles share theirs. Supporting mixed sprites needs rewriting icon-image expressions.
        style.glyphs ??= vector.glyphs;
        style.sprite ??= vector.sprite;
        for (const [name, source] of Object.entries(vector.sources)) {
          style.sources[`${id}:${name}`] = source;
        }
        const hidden = hiddenVectorGroups(layer);
        for (const vectorLayer of withBuildings3d(vector.layers, {
          enabled: layer.buildings3d !== false,
        })) {
          if (hidden.includes(vectorGroup(vectorLayer))) {
            continue;
          }
          const namespaced = { ...vectorLayer, id: `${id}:${vectorLayer.id}` };
          if ("source" in vectorLayer && typeof vectorLayer.source === "string") {
            (namespaced as { source: string }).source = `${id}:${vectorLayer.source}`;
          }
          style.layers.push(withOpacity(namespaced, layer.opacity));
        }
        break;
      }
    }
  }

  Object.assign(style.sources, input.overlay.sources);
  style.layers.push(...input.overlay.layers);
  return style;
}

/** Resolve a possibly relative URL against the style URL, keeping {placeholders} intact. */
function resolveUrl(url: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return url;
  }
  return new URL(url, base).href.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
}

/**
 * Fetch a MapLibre style. Since the style gets inlined into the composed style, relative URLs
 * are made absolute against the style's own URL.
 */
export async function fetchVectorStyle(
  url: string,
  signal: AbortSignal,
): Promise<StyleSpecification> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load style (HTTP ${response.status})`);
  }
  const style = (await response.json()) as Partial<StyleSpecification>;
  if (style.version !== 8 || !Array.isArray(style.layers) || style.sources == undefined) {
    throw new Error("Not a MapLibre style JSON (expected version 8 with sources and layers)");
  }
  const base = response.url || url;
  if (typeof style.glyphs === "string") {
    style.glyphs = resolveUrl(style.glyphs, base);
  }
  if (typeof style.sprite === "string") {
    style.sprite = resolveUrl(style.sprite, base);
  } else if (Array.isArray(style.sprite)) {
    style.sprite = style.sprite.map((s) => ({
      ...s,
      url: resolveUrl(s.url, base),
    }));
  }
  for (const source of Object.values(style.sources)) {
    if ("url" in source && typeof source.url === "string") {
      source.url = resolveUrl(source.url, base);
    }
    if ("tiles" in source && Array.isArray(source.tiles)) {
      source.tiles = source.tiles.map((tile) => resolveUrl(tile, base));
    }
    if (source.type === "geojson" && typeof source.data === "string") {
      source.data = resolveUrl(source.data, base);
    }
  }
  return style as StyleSpecification;
}
