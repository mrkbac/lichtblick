// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button, Typography, useTheme } from "@mui/material";
import type { FeatureCollection, LineString, Point } from "geojson";
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLatest } from "react-use";
import { makeStyles } from "tss-react/mui";

import { PRESETS } from "@lichtblick/suite-base/panels/Map/layers";

import { Bounds, pickTrack } from "./track";
import { CatalogRecording } from "./types";

import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre locates its worker relative to its own module URL, which a bundle doesn't preserve.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

const STYLE_URLS = {
  light: PRESETS["ofm-positron"]!.url,
  dark: PRESETS["ofm-dark"]!.url,
};

type Props = {
  recordings: readonly CatalogRecording[];
  gpsTopic: string | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onSearchArea: (bounds: Bounds) => void;
};

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    borderRadius: theme.shape.borderRadius,
    overflow: "hidden",
    border: `1px solid ${theme.palette.divider}`,
  },
  // MapLibre adds `.maplibregl-map { position: relative }`, so size explicitly.
  map: {
    width: "100%",
    height: "100%",
  },
  overlay: {
    position: "absolute",
    top: theme.spacing(1.5),
    left: theme.spacing(1.5),
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
  },
  hint: {
    backgroundColor: theme.palette.background.paper,
    padding: theme.spacing(0.5, 1),
    borderRadius: theme.shape.borderRadius,
  },
}));

type Properties = { id: string; name: string };

export default function CatalogMap({
  recordings,
  gpsTopic,
  selectedId,
  onSelect,
  onSearchArea,
}: Props): React.JSX.Element {
  const { classes } = useStyles();
  const theme = useTheme();
  const { t } = useTranslation("catalog");
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap>();
  const fittedRef = useRef(false);
  const onSelectRef = useLatest(onSelect);

  const data = useMemo(() => {
    const lines: FeatureCollection<LineString, Properties> = {
      type: "FeatureCollection",
      features: [],
    };
    const starts: FeatureCollection<Point, Properties> = {
      type: "FeatureCollection",
      features: [],
    };
    const bounds = new LngLatBounds();
    for (const r of recordings) {
      const points = pickTrack(r.tracks, gpsTopic)?.points;
      if (!points || points.length === 0) {
        continue;
      }
      const properties = { id: r.id, name: r.name };
      lines.features.push({
        type: "Feature",
        properties,
        geometry: { type: "LineString", coordinates: points },
      });
      starts.features.push({
        type: "Feature",
        properties,
        geometry: { type: "Point", coordinates: points[0]! },
      });
      points.forEach((p) => bounds.extend(p));
    }
    return { lines, starts, bounds: bounds.isEmpty() ? undefined : bounds };
  }, [recordings, gpsTopic]);

  const { primary, info, common } = theme.palette;
  useEffect(() => {
    const instance = new MapLibreMap({
      container: containerRef.current!,
      style: STYLE_URLS[theme.palette.mode],
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false,
    });
    instance.addControl(new AttributionControl({ compact: true }), "bottom-right");
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });

    instance.on("load", () => {
      instance.addSource("tracks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      instance.addSource("starts", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 12,
      });
      const lineLayout = { "line-join": "round", "line-cap": "round" } as const;
      instance.addLayer({
        id: "tracks",
        type: "line",
        source: "tracks",
        layout: lineLayout,
        paint: { "line-color": primary.main, "line-width": 3, "line-opacity": 0.75 },
      });
      instance.addLayer({
        id: "track-selected",
        type: "line",
        source: "tracks",
        layout: lineLayout,
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": info.main, "line-width": 5 },
      });
      // Thin lines are hard to hit; this invisible wide copy takes the clicks.
      instance.addLayer({
        id: "tracks-hit",
        type: "line",
        source: "tracks",
        layout: lineLayout,
        paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 },
      });
      instance.addLayer({
        id: "clusters",
        type: "circle",
        source: "starts",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": primary.main,
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
          "circle-stroke-color": common.white,
          "circle-stroke-width": 2,
        },
      });
      instance.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "starts",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: { "text-color": primary.contrastText },
      });
      instance.addLayer({
        id: "starts",
        type: "circle",
        source: "starts",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": primary.main,
          "circle-radius": 6,
          "circle-stroke-color": common.white,
          "circle-stroke-width": 2,
        },
      });
      setMap(instance);
    });

    // One handler, so a cluster drawn over a track takes the click instead of both reacting.
    instance.on("click", (event) => {
      const [feature] = instance.queryRenderedFeatures(event.point, {
        layers: ["clusters", "starts", "tracks-hit"],
      });
      if (!feature) {
        return;
      }
      const clusterId = feature.properties.cluster_id as number | undefined;
      if (clusterId != undefined && feature.geometry.type === "Point") {
        const center = feature.geometry.coordinates as [number, number];
        void instance
          .getSource<GeoJSONSource>("starts")
          ?.getClusterExpansionZoom(clusterId)
          .then((zoom) => instance.easeTo({ center, zoom }));
        return;
      }
      const id = feature.properties.id as string | undefined;
      if (id != undefined) {
        onSelectRef.current(id);
      }
    });
    for (const layer of ["starts", "tracks-hit"]) {
      instance.on("mousemove", layer, (event: MapLayerMouseEvent) => {
        instance.getCanvas().style.cursor = "pointer";
        const name = event.features?.[0]?.properties.name as string | undefined;
        popup
          .setLngLat(event.lngLat)
          .setText(name ?? "")
          .addTo(instance);
      });
      instance.on("mouseleave", layer, () => {
        instance.getCanvas().style.cursor = "";
        popup.remove();
      });
    }
    instance.on("mouseenter", "clusters", () => {
      instance.getCanvas().style.cursor = "pointer";
    });
    instance.on("mouseleave", "clusters", () => {
      instance.getCanvas().style.cursor = "";
    });

    return () => {
      setMap(undefined);
      fittedRef.current = false;
      instance.remove();
    };
  }, [theme.palette.mode, primary, info, common, onSelectRef]);

  useEffect(() => {
    if (!map) {
      return;
    }
    void map.getSource<GeoJSONSource>("tracks")?.setData(data.lines);
    void map.getSource<GeoJSONSource>("starts")?.setData(data.starts);
    // Frame the recordings once; after that the view is the user's.
    if (!fittedRef.current && data.bounds) {
      fittedRef.current = true;
      map.fitBounds(data.bounds, { padding: 48, maxZoom: 15, duration: 0 });
    }
  }, [map, data]);

  useEffect(() => {
    if (!map) {
      return;
    }
    map.setFilter("track-selected", ["==", ["get", "id"], selectedId ?? ""]);
    // A recording picked in the list may be off screen; bring it into view.
    const points = pickTrack(recordings.find((r) => r.id === selectedId)?.tracks, gpsTopic)?.points;
    if (points && points.length > 0) {
      const bounds = points.reduce((b, p) => b.extend(p), new LngLatBounds());
      const view = map.getBounds();
      if (!view.contains(bounds.getSouthWest()) || !view.contains(bounds.getNorthEast())) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 16 });
      }
    }
    // Only when the selection changes, not when the recordings or topic change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedId]);

  return (
    <div className={classes.root}>
      <div ref={containerRef} className={classes.map} />
      <div className={classes.overlay}>
        <Button
          variant="contained"
          size="small"
          disabled={!map}
          onClick={() => {
            const b = map?.getBounds();
            if (b) {
              onSearchArea([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
            }
          }}
        >
          {t("searchThisArea")}
        </Button>
        <Typography variant="caption" className={classes.hint}>
          {t("withGps", { count: data.lines.features.length, total: recordings.length })}
        </Typography>
      </div>
    </div>
  );
}
