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
import { Divider, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import type { FeatureCollection } from "geojson";
import { Marker } from "maplibre-gl";
import type { Map as MapLibreMap, MapMouseEvent, PointLike } from "maplibre-gl";
import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { makeStyles } from "tss-react/mui";

import { customTypography } from "@lichtblick/theme";

import { MEASURE_HANDLE_LAYERS } from "./features";
import {
  bearingDegrees,
  distanceMeters,
  formatArea,
  formatDistance,
  formatElevation,
  LngLat,
  pathLengthMeters,
  polygonAreaSquareMeters,
  surfaceProfile,
  Units,
} from "./geo";
import {
  angleDegrees,
  compassDirection,
  heightStats,
  measureFeatures,
  MeasureTool,
  TerrainSlope,
  terrainSlope,
  TOOL_RULES,
} from "./measure";

/** Handles are picked within this many pixels of the pointer. */
const HANDLE_PICK_PX = 8;

const TOOLS: {
  tool: MeasureTool;
  title: string;
  icon: React.JSX.Element;
  needsTerrain?: boolean;
}[] = [
  { tool: "distance", title: "Measure distance and area", icon: <Ruler20Regular /> },
  {
    tool: "height",
    title: "Measure height difference",
    icon: <ArrowAutofitHeight20Regular />,
    needsTerrain: true,
  },
  { tool: "angle", title: "Measure angle", icon: <Triangle20Regular /> },
  { tool: "point", title: "Pin points", icon: <LocationAdd20Regular /> },
];

const useStyles = makeStyles()((theme) => ({
  topLeft: {
    position: "absolute",
    top: 10,
    left: 10,
    display: "flex",
    gap: theme.spacing(1),
    alignItems: "flex-start",
    pointerEvents: "none",
  },
  bottomLeft: {
    position: "absolute",
    bottom: 36,
    left: 10,
    pointerEvents: "none",
  },
  tools: { display: "flex", flexDirection: "column", pointerEvents: "auto" },
  result: {
    padding: theme.spacing(0.75, 1.25),
    pointerEvents: "auto",
    maxWidth: 280,
  },
  coordinates: {
    padding: theme.spacing(0.25, 1),
    pointerEvents: "auto",
    cursor: "copy",
    fontFamily: customTypography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    fontVariantNumeric: "tabular-nums",
  },
}));

/** Map-anchored labels are plain DOM (MapLibre markers), styled inline. */
function labelElement(text: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    font: "600 11px/1.3 system-ui, sans-serif",
    color: "#fff",
    background: "rgba(20, 20, 24, 0.82)",
    padding: "2px 6px",
    borderRadius: "4px",
    whiteSpace: "pre",
    textAlign: "center",
    pointerEvents: "none",
  });
  return el;
}

type Props = {
  map: MapLibreMap;
  units: Units;
  showCoordinates: boolean;
  setMeasureData: (data: FeatureCollection) => void;
  /** Set while a measure tool is active, so the panel ignores clicks on data. */
  measuringRef: RefObject<boolean>;
  onFitToData: (() => void) | undefined;
};

/** Elevation without the display exaggeration, or undefined without 3D terrain. */
function groundElevation(map: MapLibreMap, point: LngLat): number | undefined {
  const terrain = map.getTerrain();
  const elevation = terrain ? map.queryTerrainElevation(point) : undefined;
  return elevation == undefined ? undefined : elevation / (terrain?.exaggeration ?? 1);
}

function formatHeight(meters: number, units: Units): string {
  const sign = meters > 0 ? "+" : meters < 0 ? "−" : "±";
  return `${sign}${formatElevation(Math.abs(meters), units)}`;
}

function formatSlope(slope: TerrainSlope): string {
  return slope.slopeDegrees < 0.5
    ? "flat"
    : `slope ${slope.slopeDegrees.toFixed(0)}° facing ${compassDirection(slope.aspectDegrees)}`;
}

type Label = { at: LngLat; text: string };
type Summary = { title: string; lines: string[]; labels: Label[] };

function midpoint(a: LngLat, b: LngLat): LngLat {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Readouts for the panel and the labels drawn on the map. */
function summarize(
  tool: MeasureTool,
  points: readonly LngLat[],
  shape: "path" | "area",
  units: Units,
  elevationAt: (point: LngLat) => number | undefined,
): Summary {
  const closed = shape === "area";
  const elevations = points.map(elevationAt);
  const known = (values: (number | undefined)[]): values is number[] =>
    values.every((v) => v != undefined);

  switch (tool) {
    case "distance": {
      const path = closed ? [...points, points[0]!] : points;
      const labels: Label[] = [];
      for (let i = 1; i < path.length; i++) {
        const [a, b] = [path[i - 1]!, path[i]!];
        const ea = elevationAt(a);
        const eb = elevationAt(b);
        const flat = formatDistance(distanceMeters(a, b), units);
        labels.push({
          at: midpoint(a, b),
          text:
            ea != undefined && eb != undefined ? `${flat}\n${formatHeight(eb - ea, units)}` : flat,
        });
      }
      const lines: string[] = [];
      let title = "Measure distance or area";
      if (closed) {
        title = `Area ${formatArea(polygonAreaSquareMeters(points), units)}`;
        lines.push(`Perimeter ${formatDistance(pathLengthMeters(path), units)}`);
        labels.push({
          at: [
            points.reduce((sum, p) => sum + p[0], 0) / points.length,
            points.reduce((sum, p) => sum + p[1], 0) / points.length,
          ],
          text: formatArea(polygonAreaSquareMeters(points), units),
        });
      } else if (points.length >= 2) {
        const [from, to] = [points[points.length - 2]!, points[points.length - 1]!];
        title = `Length ${formatDistance(pathLengthMeters(points), units)}`;
        lines.push(
          `Segment ${formatDistance(distanceMeters(from, to), units)} at ${bearingDegrees(from, to).toFixed(1)}°`,
        );
      }
      const profile = path.length >= 2 ? surfaceProfile(path, elevationAt) : undefined;
      if (profile) {
        lines.push(
          `Over terrain ${formatDistance(profile.surfaceMeters, units)}, ` +
            `climb ${formatElevation(profile.climbMeters, units)}, ` +
            `descent ${formatElevation(profile.descentMeters, units)}`,
        );
      }
      return { title, lines, labels };
    }
    case "height": {
      if (points.length < 2 || !known(elevations)) {
        return {
          title: "Measure height difference",
          lines: points.length >= 2 ? ["Waiting for terrain…"] : [],
          labels: [],
        };
      }
      const [a, b] = [points[0]!, points[1]!];
      const stats = heightStats(a, b, elevations[0]!, elevations[1]!);
      return {
        title: `Height ${formatHeight(stats.verticalMeters, units)}`,
        lines: [
          `Horizontal ${formatDistance(stats.horizontalMeters, units)}`,
          `Slope distance ${formatDistance(stats.slopeMeters, units)}`,
          `Grade ${stats.gradePercent.toFixed(1)}% (${stats.slopeDegrees.toFixed(1)}°)`,
        ],
        labels: [
          { at: midpoint(a, b), text: formatHeight(stats.verticalMeters, units) },
          ...points.map((at, i) => ({ at, text: formatElevation(elevations[i]!, units) })),
        ],
      };
    }
    case "angle": {
      if (points.length < 3) {
        return { title: "Measure angle", lines: [], labels: [] };
      }
      // Like point-cloud tools: the angle at every corner of the triangle, in 3D with terrain.
      const [a, b, c] = [points[0]!, points[1]!, points[2]!];
      const z = known(elevations) ? [elevations[0]!, elevations[1]!, elevations[2]!] : undefined;
      const at = (p: LngLat, vertex: LngLat, q: LngLat, i: [number, number, number]) =>
        angleDegrees(p, vertex, q, z ? [z[i[0]]!, z[i[1]]!, z[i[2]]!] : undefined);
      const angles = [at(c, a, b, [2, 0, 1]), at(a, b, c, [0, 1, 2]), at(b, c, a, [1, 2, 0])];
      const lines = [`At the other corners ${angles[0]!.toFixed(1)}°, ${angles[2]!.toFixed(1)}°`];
      if (z) {
        // Steepness of each leg from the middle point, e.g. foot → top of a cliff.
        const incline = (to: LngLat, zTo: number) => {
          const degrees = heightStats(b, to, z[1]!, zTo).slopeDegrees;
          return `${degrees > 0 ? "+" : ""}${degrees.toFixed(1)}`;
        };
        lines.push(
          `Leg inclines from the middle point ${incline(a, z[0]!)}°, ${incline(c, z[2]!)}° (+ uphill)`,
        );
        lines.push(`In the horizontal plane ${angleDegrees(a, b, c).toFixed(1)}°`);
      }
      return {
        title: `Angle ${angles[1]!.toFixed(1)}°`,
        lines,
        labels: points.map((p, i) => ({ at: p, text: `${angles[i]!.toFixed(1)}°` })),
      };
    }
    case "point":
      return {
        title: points.length === 0 ? "Pin points" : `${points.length} point(s)`,
        lines: [],
        labels: points.map((at, i) => {
          const coordinates = `${at[1].toFixed(6)}, ${at[0].toFixed(6)}`;
          const elevation = elevations[i];
          const slope = terrainSlope(at, elevationAt);
          return {
            at,
            text: [
              coordinates,
              elevation != undefined ? formatElevation(elevation, units) : undefined,
              slope ? formatSlope(slope) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
          };
        }),
      };
  }
}

function CursorCoordinates({ map, units }: { map: MapLibreMap; units: Units }) {
  const [cursor, setCursor] = useState<{
    lngLat: LngLat;
    elevation?: number;
    slope?: TerrainSlope;
  }>();
  const [copied, setCopied] = useState(false);
  const { classes } = useStyles();

  useEffect(() => {
    const onMove = (event: MapMouseEvent) => {
      const lngLat: LngLat = [event.lngLat.lng, event.lngLat.lat];
      const elevationAt = (point: LngLat) => groundElevation(map, point);
      setCursor({
        lngLat,
        elevation: elevationAt(lngLat),
        slope: terrainSlope(lngLat, elevationAt),
      });
    };
    // Keep the last position when the pointer leaves, so the readout can be clicked to copy.
    map.on("mousemove", onMove);
    return () => {
      map.off("mousemove", onMove);
    };
  }, [map]);

  if (!cursor) {
    return null;
  }
  const [lon, lat] = cursor.lngLat;
  const text = `${lat.toFixed(7)}, ${lon.toFixed(7)}`;
  const elevation =
    cursor.elevation == undefined ? undefined : formatElevation(cursor.elevation, units);
  return (
    <Tooltip title={copied ? "Copied" : "Click to copy"}>
      <Paper
        className={classes.coordinates}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1200);
          });
        }}
      >
        {text}
        {elevation != undefined && ` · ${elevation}`}
        {cursor.slope && ` · ${formatSlope(cursor.slope)}`}
      </Paper>
    </Tooltip>
  );
}

type Handle = { measurement: number; kind: "vertex" | "mid"; index: number };

type Measurement = {
  id: number;
  tool: MeasureTool;
  points: LngLat[];
  /** drawing: placing points; done: ended (double-click, Enter, or the tool's point count). */
  status: "drawing" | "done";
  /** Distance tool only: closed on its first point, so it measures an area. */
  closed: boolean;
};

let nextMeasurementId = 1;

export function MapToolbar(props: Props): React.JSX.Element {
  const { map, units, showCoordinates, setMeasureData, measuringRef, onFitToData } = props;
  const { classes } = useStyles();
  const [tool, setTool] = useState<MeasureTool>();
  // Finished measurements stay on the map; the selected one is drawn into and edited.
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const [cursor, setCursor] = useState<{ lngLat: LngLat; onFirst: boolean }>();
  const [hasTerrain, setHasTerrain] = useState(map.getTerrain() != undefined);
  // Bumped when terrain tiles finish loading, so elevations get re-read.
  const [terrainTick, setTerrainTick] = useState(0);
  // Mirror for the map event handlers, which are bound once per tool.
  const stateRef = useRef({ measurements, selectedId });
  useLayoutEffect(() => {
    stateRef.current = { measurements, selectedId };
  }, [measurements, selectedId]);

  useEffect(() => {
    measuringRef.current = tool != undefined;
  }, [tool, measuringRef]);

  useEffect(() => {
    const update = () => {
      setHasTerrain(map.getTerrain() != undefined);
    };
    map.on("terrain", update);
    map.on("styledata", update);
    return () => {
      map.off("terrain", update);
      map.off("styledata", update);
    };
  }, [map]);

  useEffect(() => {
    if (measurements.length === 0 || !hasTerrain) {
      return;
    }
    const onIdle = () => {
      setTerrainTick((n) => n + 1);
    };
    map.on("idle", onIdle);
    return () => {
      map.off("idle", onIdle);
    };
  }, [hasTerrain, map, measurements.length]);

  useEffect(() => {
    if (!tool) {
      return;
    }
    const canvas = map.getCanvasContainer();
    canvas.style.cursor = "crosshair";
    map.doubleClickZoom.disable();

    const selected = () =>
      stateRef.current.measurements.find((m) => m.id === stateRef.current.selectedId);
    const update = (id: number, change: (m: Measurement) => Measurement | undefined) => {
      setMeasurements((prev) =>
        prev.flatMap((m) => {
          if (m.id !== id) {
            return [m];
          }
          const next = change(m);
          return next && next.points.length > 0 ? [next] : [];
        }),
      );
    };
    const finish = (id: number) => {
      update(id, (m) => ({ ...m, status: "done" }));
      setCursor(undefined);
    };

    // Pick against the rendered handles, so hits match what is drawn (also on 3D terrain).
    const pickHandle = (event: MapMouseEvent): Handle | undefined => {
      const layers = MEASURE_HANDLE_LAYERS.filter((id) => map.getLayer(id) != undefined);
      const { x, y } = event.point;
      const box: [PointLike, PointLike] = [
        [x - HANDLE_PICK_PX, y - HANDLE_PICK_PX],
        [x + HANDLE_PICK_PX, y + HANDLE_PICK_PX],
      ];
      const hits = map.queryRenderedFeatures(box, { layers });
      const hit = hits.find((f) => f.properties.kind === "vertex") ?? hits[0];
      return hit
        ? {
            measurement: Number(hit.properties.m),
            kind: hit.properties.kind as Handle["kind"],
            index: Number(hit.properties.i),
          }
        : undefined;
    };
    const removePoint = (id: number, index: number) => {
      update(id, (m) => {
        const points = m.points.filter((_point, i) => i !== index);
        const { maxPoints } = TOOL_RULES[m.tool];
        return {
          ...m,
          points,
          closed: m.closed && points.length >= 3,
          status: maxPoints != undefined && points.length < maxPoints ? "drawing" : m.status,
        };
      });
    };

    let drag: { id: number; index: number; moved: boolean } | undefined;
    let suppressClick = false;

    const onMouseDown = (event: MapMouseEvent) => {
      suppressClick = false; // a drag past clickTolerance fires no click, so a set flag is stale
      const handle = event.originalEvent.button === 0 ? pickHandle(event) : undefined;
      if (!handle) {
        return;
      }
      event.preventDefault(); // keep the map from panning
      setSelectedId(handle.measurement);
      if (handle.kind === "mid") {
        const point: LngLat = [event.lngLat.lng, event.lngLat.lat];
        update(handle.measurement, (m) => ({
          ...m,
          points: [
            ...m.points.slice(0, handle.index + 1),
            point,
            ...m.points.slice(handle.index + 1),
          ],
        }));
        drag = { id: handle.measurement, index: handle.index + 1, moved: true };
      } else {
        drag = { id: handle.measurement, index: handle.index, moved: false };
      }
      canvas.style.cursor = "grabbing";
    };
    const onMouseMove = (event: MapMouseEvent) => {
      const lngLat: LngLat = [event.lngLat.lng, event.lngLat.lat];
      if (drag) {
        const { id, index } = drag;
        drag.moved = true;
        update(id, (m) => ({ ...m, points: m.points.map((p, i) => (i === index ? lngLat : p)) }));
        return;
      }
      const handle = pickHandle(event);
      canvas.style.cursor = handle ? "grab" : "crosshair";
      const current = selected();
      if (current?.status === "drawing") {
        const onFirst =
          TOOL_RULES[current.tool].editableShape &&
          handle?.measurement === current.id &&
          handle.kind === "vertex" &&
          handle.index === 0 &&
          current.points.length >= 3;
        setCursor({ lngLat, onFirst });
      }
    };
    const onMouseUp = () => {
      if (drag) {
        suppressClick = drag.moved;
        drag = undefined;
        canvas.style.cursor = "grab";
      }
    };
    const onClick = (event: MapMouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const handle = pickHandle(event);
      const current = selected();
      if (handle?.kind === "vertex") {
        if (event.originalEvent.altKey) {
          removePoint(handle.measurement, handle.index);
        } else if (handle.measurement !== current?.id) {
          setSelectedId(handle.measurement);
        } else if (
          TOOL_RULES[current.tool].editableShape &&
          current.status === "drawing" &&
          handle.index === 0 &&
          current.points.length >= 3
        ) {
          update(current.id, (m) => ({ ...m, closed: true }));
          finish(current.id);
        }
        // Clicking an existing point never adds a new one (this also absorbs double-clicks).
        return;
      }
      const point: LngLat = [event.lngLat.lng, event.lngLat.lat];
      if (current?.status === "drawing" && current.tool === tool) {
        // The second click of a double-click can land before the new point is rendered.
        const last = current.points[current.points.length - 1];
        if (last && map.project(last).dist(event.point) < HANDLE_PICK_PX) {
          return;
        }
        const { maxPoints } = TOOL_RULES[current.tool];
        update(current.id, (m) => ({
          ...m,
          points: [...m.points, point],
          status: maxPoints != undefined && m.points.length + 1 >= maxPoints ? "done" : m.status,
        }));
        return;
      }
      // Start a new measurement; earlier ones stay on the map.
      const id = nextMeasurementId++;
      setMeasurements((prev) => [
        ...prev,
        { id, tool, points: [point], status: "drawing", closed: false },
      ]);
      setSelectedId(id);
    };
    const onDblClick = (event: MapMouseEvent) => {
      event.preventDefault();
      const current = selected();
      if (current?.status === "drawing" && current.points.length >= 2) {
        finish(current.id);
      }
    };
    const onContextMenu = (event: MapMouseEvent) => {
      const handle = pickHandle(event);
      if (handle?.kind === "vertex") {
        event.preventDefault();
        removePoint(handle.measurement, handle.index);
      }
    };
    // Only keys aimed at this panel (map canvas or toolbar), so other panels, dialogs, and menus
    // keep their keys.
    const panelRoot = map.getContainer().parentElement ?? map.getContainer();
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !panelRoot.contains(target) ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const current = selected();
      const drawing = current?.status === "drawing";
      if (event.key === "Escape") {
        if (current && drawing && TOOL_RULES[current.tool].lines && current.points.length >= 2) {
          finish(current.id);
        } else if (current) {
          setSelectedId(undefined);
          setCursor(undefined);
        } else {
          setTool(undefined);
        }
      } else if (event.key === "Enter" && current && drawing) {
        finish(current.id);
      } else if ((event.key === "Backspace" || event.key === "Delete") && current) {
        if (drawing && event.key === "Backspace") {
          removePoint(current.id, current.points.length - 1);
        } else {
          // Delete the selected measurement.
          update(current.id, () => undefined);
          setSelectedId(undefined);
        }
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKey, true);
    return () => {
      canvas.style.cursor = "";
      map.doubleClickZoom.enable();
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.off("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [map, tool]);

  const selected = measurements.find((m) => m.id === selectedId);

  // While drawing, the cursor is a live point; on the first point it previews the closed area.
  const preview =
    tool != undefined &&
    selected?.status === "drawing" &&
    TOOL_RULES[selected.tool].lines &&
    cursor != undefined;
  const live = preview && !cursor.onFirst ? cursor.lngLat : undefined;
  const isClosed = (m: Measurement) =>
    m.closed || (m.id === selected?.id && preview && cursor.onFirst);
  const pointsOf = useCallback(
    (m: Measurement) => (m.id === selected?.id && live ? [...m.points, live] : m.points),
    [live, selected?.id],
  );

  // Summaries sample terrain heavily (profiles, slopes), so only the measurement being drawn is
  // recomputed as the cursor moves; the others are cached per (immutable) measurement object.
  const summaryCache = useRef(new WeakMap<Measurement, { key: string; summary: Summary }>());
  const summaries = useMemo(() => {
    const elevationAt = (point: LngLat) => groundElevation(map, point);
    const cacheKey = `${units}|${hasTerrain}|${terrainTick}`;
    return new Map(
      measurements.map((m) => {
        if (m.id === selected?.id && preview) {
          return [
            m.id,
            summarize(m.tool, pointsOf(m), isClosed(m) ? "area" : "path", units, elevationAt),
          ];
        }
        const cached = summaryCache.current.get(m);
        if (cached?.key === cacheKey) {
          return [m.id, cached.summary];
        }
        const summary = summarize(m.tool, m.points, m.closed ? "area" : "path", units, elevationAt);
        summaryCache.current.set(m, { key: cacheKey, summary });
        return [m.id, summary];
      }),
    );
    // isClosed depends on the same inputs as pointsOf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    map,
    measurements,
    pointsOf,
    preview,
    selected?.id,
    hasTerrain,
    terrainTick,
    units,
    cursor?.onFirst,
  ]);

  useEffect(() => {
    setMeasureData({
      type: "FeatureCollection",
      features: measurements.flatMap(
        (m) =>
          measureFeatures(
            m.id,
            m.points,
            TOOL_RULES[m.tool],
            isClosed(m) ? "area" : "path",
            m.id === selected?.id ? live : undefined,
          ).features,
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor?.onFirst, live, measurements, selected?.id, setMeasureData]);

  // Labels anchored on the map (they follow 3D terrain). Markers are reused and only updated
  // when their position or text changes, instead of being recreated on every pointer move.
  const markersRef = useRef(new Map<string, Marker>());
  useEffect(() => {
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const [id, summary] of summaries) {
      summary.labels.forEach((label, i) => {
        const key = `${id}:${i}`;
        seen.add(key);
        const existing = markers.get(key);
        if (existing) {
          const at = existing.getLngLat();
          if (at.lng !== label.at[0] || at.lat !== label.at[1]) {
            existing.setLngLat(label.at);
          }
          if (existing.getElement().textContent !== label.text) {
            existing.getElement().textContent = label.text;
          }
        } else {
          markers.set(
            key,
            new Marker({ element: labelElement(label.text), anchor: "bottom", offset: [0, -8] })
              .setLngLat(label.at)
              .addTo(map),
          );
        }
      });
    }
    for (const [key, marker] of markers) {
      if (!seen.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }, [map, summaries]);
  useEffect(
    () => () => {
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
    },
    [map],
  );

  const summary = selected ? summaries.get(selected.id) : undefined;
  const activeRules = tool ? TOOL_RULES[tool] : undefined;
  const hint =
    tool === "point"
      ? "Click to pin points."
      : selected?.status === "drawing"
        ? tool === "distance"
          ? "Click the first point for an area, double-click to end a line."
          : `Click ${activeRules?.maxPoints === 3 ? "three points (e.g. cliff foot in the middle, top, and a ground point); every corner is labeled" : "the bottom and the top"}.`
        : "Click the map to start a measurement.";

  return (
    <>
      <div className={classes.topLeft}>
        <Paper className={classes.tools}>
          {TOOLS.map(({ tool: option, title, icon, needsTerrain = false }) => {
            const disabled = needsTerrain && !hasTerrain;
            return (
              <Tooltip
                key={option}
                title={disabled ? `${title} (turn on 3D terrain in an elevation layer)` : title}
                placement="right"
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={disabled}
                    color={tool === option ? "primary" : "default"}
                    onClick={() => {
                      setSelectedId(undefined);
                      setCursor(undefined);
                      setTool((prev) => (prev === option ? undefined : option));
                    }}
                  >
                    {icon}
                  </IconButton>
                </span>
              </Tooltip>
            );
          })}
          {/* Always rendered so activating a tool doesn't shift the toolbar. */}
          <Tooltip title="Clear all measurements" placement="right">
            <span>
              <IconButton
                size="small"
                disabled={measurements.length === 0}
                onClick={() => {
                  setMeasurements([]);
                  setSelectedId(undefined);
                }}
              >
                <Delete20Regular />
              </IconButton>
            </span>
          </Tooltip>
          <Divider />
          <Tooltip title="Zoom to data" placement="right">
            <span>
              <IconButton
                size="small"
                disabled={!onFitToData}
                onClick={() => {
                  onFitToData?.();
                }}
              >
                <ZoomFit20Regular />
              </IconButton>
            </span>
          </Tooltip>
        </Paper>
        {tool && (
          <Paper className={classes.result}>
            <Typography variant="body2" style={{ fontWeight: 600 }}>
              {summary?.title ?? TOOLS.find((t) => t.tool === tool)?.title}
            </Typography>
            {summary?.lines.map((line) => (
              <Typography
                key={line}
                variant="caption"
                color="textSecondary"
                style={{ display: "block" }}
              >
                {line}
              </Typography>
            ))}
            <Typography variant="caption" color="textSecondary" style={{ display: "block" }}>
              {hint} Drag points to move
              {activeRules?.editableShape === true ? ", click a midpoint to insert" : ""},
              right-click a point to delete. Click a point to select its measurement; Delete removes
              it, Esc deselects.
            </Typography>
          </Paper>
        )}
      </div>
      {showCoordinates && (
        <div className={classes.bottomLeft}>
          <CursorCoordinates map={map} units={units} />
        </div>
      )}
    </>
  );
}
