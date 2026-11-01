---
name: "panel-map"
description: "Deep Map panel knowledge: MapLibre GL lifecycle, the layer stack and style composition, NavSatFix/LocationFix/GeoJSON handling, measurement tools, and GeoTIFF overlays."
---

# Panel Map Skill

A geographic visualization panel built on MapLibre GL (WebGL) for GPS (NavSatFix / LocationFix) and GeoJSON data.

## Structure

```
panels/Map/
├── MapPanel.tsx      # panel: subscriptions, MapLibre lifecycle, camera, hover/click
├── MapToolbar.tsx    # measure tools, map-anchored labels, zoom to data, cursor coordinates
├── measure.ts        # measure tool rules, angle/height math, measure overlay geometry
├── config.ts         # persisted Config, legacy migration, settings tree, pure action reducer
├── layers.ts         # free-service presets, MapLayer model, composeStyle(), vector style fetch
├── features.ts       # messages → GeoJSON, the panel's overlay sources and style layers
├── geotiff.ts        # GeoTIFF → georeferenced image (EPSG:4326, 3857, UTM)
├── geo.ts            # geodesy: distance, bearing, area, ellipses, UTM/Mercator inverse
├── savedSources.ts   # custom sources remembered in localStorage across panels/layouts
├── getAccuracy.ts    # covariance → accuracy ellipse
└── support.ts        # schema detection, GeoJSON parsing
```

## Rendering model

- One MapLibre style is composed from the user's **layer stack** (top-most first in config) plus the
  panel's **overlay** (track, accuracy, GeoJSON, current position, hover marker, measurement).
  `map.setStyle(style, { diff: true })` applies only what changed.
- Layer kinds: `raster` (XYZ / TileJSON / `pmtiles://`), `vector` (style.json, inlined and
  namespaced as `<layerId>:<id>`; "roads and labels only" keeps line + symbol layers), `dem`
  (hillshade and/or 3D terrain), `geotiff` (decoded once into an image source).
- Overlay data lives in a ref and is pushed with `GeoJSONSource.setData`; the composed style embeds
  the same objects, and `style.load` re-pushes them after a full reload.
- Everything is GPU-rendered, so the whole track is drawn (no point deduplication).
- Style validation rejects `undefined` values: build sources with `defined()`. `layers.test.ts`
  runs composed styles through `validateStyleMin`.

## Data flow

- Track: `unstable_subscribeMessageRange` for position topics. GeoJSON is not ranged: each message
  replaces the previous scene (latest per topic from `currentFrame`).
- Live sources have no range; their current-frame fixes build a capped live trail instead.
- Heading: bearing from the most recent fix at least 1 m back (ignores GNSS jitter when stationary).
- Custom URL fields are debounced before use so half-typed URLs are never fetched; a custom source
  is remembered only after it loads successfully.

## Measurement

Tools: distance/area (click the first point to close an area, double-click to end a line), height
(needs 3D terrain), angle (three points; every triangle corner is labeled, 3D with terrain, plus
leg inclines from the middle point — e.g. cliff foot), and pinned points (with terrain slope and
facing). Measurements accumulate; clicking a point selects its measurement for editing, Delete
removes it, the trash button clears all. Points can be dragged, inserted via midpoint handles, and
deleted with right-click/Alt-click. Hits are picked against the rendered handle layers
(`MEASURE_HANDLE_LAYERS`, feature property `m` = measurement id) so they match what is drawn on
terrain. Labels are MapLibre `Marker`s (DOM, no glyphs needed) and follow the terrain. Elevations
come from `queryTerrainElevation` divided by the terrain exaggeration; slope accuracy is bounded
by the DEM resolution.

## Settings

General (follow topic and heading-up mode, projection, units, rotation, scale, coordinates), a
reorderable and renamable **Map layers** list, and per-topic color, track style, point size, and
accuracy ellipse. Leaflet-era configs (`layer`, `customTileUrl`, `maxNativeZoom`) are migrated in
`normalizeConfig`.

## Supported Message Types

| Message Type                      | Fields Used                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `sensor_msgs/NavSatFix` (ROS 1/2) | latitude, longitude, altitude, status, position_covariance                                         |
| `foxglove.LocationFix`            | latitude, longitude, altitude, position_covariance                                                 |
| `foxglove.GeoJSON`                | geojson; Leaflet-style `properties.style` (color, weight, opacity, fillColor, fillOpacity, radius) |

## Build notes

- MapLibre 6 is ESM-only. Its worker is emitted as an asset and set with `setWorkerUrl`
  (`initPanel.tsx`); webpack URL parsing is disabled for `maplibre-gl.mjs` (`webpack.ts`).
- The `pmtiles://` protocol is registered once in `initPanel.tsx`.

## Key Files

- `packages/suite-base/src/panels/Map/MapPanel.tsx`
- `packages/suite-base/src/panels/Map/layers.ts`
- `packages/suite-base/src/panels/Map/config.ts`
- `packages/suite-base/src/panels/Map/features.ts`
