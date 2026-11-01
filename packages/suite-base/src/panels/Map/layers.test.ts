// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "maplibre-gl";

import { emptyOverlayData, overlayStyle } from "./features";
import { composeStyle, MapLayer, validateSourceUrl } from "./layers";

const VECTOR_URL = "https://example.com/style.json";
const vectorStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://example.com/fonts/{fontstack}/{range}.pbf",
  sources: { tiles: { type: "vector", url: "https://example.com/tiles.json" } },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#fff" },
    },
    {
      id: "water",
      type: "fill",
      source: "tiles",
      "source-layer": "water",
      paint: {
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1],
      },
    },
    {
      id: "roads",
      type: "line",
      source: "tiles",
      "source-layer": "transportation",
    },
    { id: "district-border", type: "line", source: "tiles", "source-layer": "boundary" },
    { id: "river", type: "line", source: "tiles", "source-layer": "waterway" },
    {
      id: "labels",
      type: "symbol",
      source: "tiles",
      "source-layer": "place",
      layout: { "text-field": "{name}" },
    },
  ],
};

const layer = (props: Partial<MapLayer> & Pick<MapLayer, "id" | "source">): MapLayer => ({
  visible: true,
  opacity: 1,
  ...props,
});

function compose(layers: MapLayer[]) {
  return composeStyle({
    layers,
    vectorStyles: new Map([[VECTOR_URL, vectorStyle]]),
    images: new Map([
      [
        "https://example.com/ortho.tif",
        {
          url: "blob:ortho",
          coordinates: [
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        },
      ],
    ]),
    projection: "mercator",
    overlay: overlayStyle(emptyOverlayData()),
  });
}

describe("composeStyle", () => {
  it("produces a valid style for every kind of layer", () => {
    const style = compose([
      layer({
        id: "labels",
        source: "custom",
        custom: { kind: "vector", url: VECTOR_URL },
      }),
      layer({ id: "dem", source: "mapterhorn", terrain: true, opacity: 0.5 }),
      layer({
        id: "ortho",
        source: "custom",
        custom: { kind: "geotiff", url: "https://example.com/ortho.tif" },
      }),
      layer({
        id: "custom",
        source: "custom",
        custom: { kind: "raster", url: "pmtiles://x.pmtiles" },
      }),
      layer({ id: "base", source: "esri-imagery" }),
    ]);
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.terrain).toEqual({ source: "dem:terrain", exaggeration: 1 });
    expect(style.sources.custom).toMatchObject({ url: "pmtiles://x.pmtiles" });
    expect(style.glyphs).toBe(vectorStyle.glyphs);
  });

  it("stacks the first layer on top, below the panel's data overlay", () => {
    const ids = compose([
      layer({ id: "top", source: "esri-labels" }),
      layer({ id: "bottom", source: "esri-imagery" }),
      layer({ id: "hidden", source: "osm", visible: false }),
    ]).layers.map((l) => l.id);
    expect(ids.indexOf("bottom")).toBeLessThan(ids.indexOf("top"));
    expect(ids).not.toContain("hidden");
    expect(ids.indexOf("top")).toBeLessThan(ids.indexOf("lb:track"));
  });

  it("namespaces vector styles and can keep only roads and labels", () => {
    const style = compose([
      layer({
        id: "v",
        source: "custom",
        custom: { kind: "vector", url: VECTOR_URL },
        vectorContent: "lines-labels",
        opacity: 0.5,
      }),
    ]);
    const ids = style.layers.map((l) => l.id).filter((id) => id.startsWith("v:"));
    expect(ids).toEqual(["v:roads", "v:labels"]);
    expect(style.sources["v:tiles"]).toBeDefined();
    expect(style.layers.find((l) => l.id === "v:roads")).toMatchObject({
      source: "v:tiles",
      paint: { "line-opacity": 0.5 },
    });
    expect(validateStyleMin(style)).toEqual([]);
  });

  it("scales zoom-dependent opacity without breaking the expression", () => {
    const style = compose([
      layer({
        id: "v",
        source: "custom",
        custom: { kind: "vector", url: VECTOR_URL },
        opacity: 0.5,
      }),
    ]);
    expect(style.layers.find((l) => l.id === "v:water")).toMatchObject({
      paint: {
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.25, 10, 0.5],
      },
    });
    expect(validateStyleMin(style)).toEqual([]);
  });

  it("skips sources that aren't usable yet", () => {
    const style = compose([
      layer({
        id: "empty",
        source: "custom",
        custom: { kind: "raster", url: "" },
      }),
      layer({
        id: "loading",
        source: "custom",
        custom: { kind: "vector", url: "https://x/other.json" },
      }),
    ]);
    expect(style.layers.every((l) => l.id.startsWith("lb:"))).toBe(true);
  });
});

describe("validateSourceUrl", () => {
  it("accepts MapLibre placeholders and rejects others", () => {
    expect(validateSourceUrl({ kind: "raster", url: "https://t/{z}/{x}/{y}.png" })).toBeUndefined();
    expect(validateSourceUrl({ kind: "raster", url: "https://t/{quadkey}" })).toBeUndefined();
    expect(validateSourceUrl({ kind: "raster", url: "https://{s}.t/{z}/{x}/{y}" })).toMatch(
      /\{s\}/,
    );
    expect(validateSourceUrl({ kind: "vector", url: "tiles.example.com" })).toMatch(/http/);
  });
});
