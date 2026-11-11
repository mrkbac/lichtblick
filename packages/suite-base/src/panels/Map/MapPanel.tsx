// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec } from "@foxglove/rostime";
import { Chip, alpha } from "@mui/material";
import type { FeatureCollection, Position } from "geojson";
import * as _ from "lodash-es";
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  MapMouseEvent,
  NavigationControl,
  Popup,
  ScaleControl,
  StyleSpecification,
} from "maplibre-gl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "react-use";
import { makeStyles } from "tss-react/mui";
import { useDebounce } from "use-debounce";

import { filterMap } from "@lichtblick/den/collection";
import Logger from "@lichtblick/log";
import { MessagePath, parseMessagePath } from "@lichtblick/message-path";
import { MessageEvent, PanelExtensionContext, SettingsTreeAction, Topic } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { OVERLAY_TOOLBAR_BUTTON_SIZE } from "@lichtblick/suite-base/components/OverlayToolbar";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { turboColorString } from "@lichtblick/suite-base/util/colorUtils";
import { formatTime } from "@lichtblick/suite-base/util/formatTime";
import { darkColor, lineColors } from "@lichtblick/suite-base/util/plotColors";
import { formatTimeRaw, isAbsoluteTime } from "@lichtblick/suite-base/util/time";

import { MapToolbar } from "./MapToolbar";
import { normalize, Sample, sampleAt, speedUnitLabel, speedValues, valueRange } from "./colorBy";
import {
  applySettingsAction,
  buildSettingsTree,
  Config,
  DEFAULT_POINT_SIZE,
  normalizeConfig,
} from "./config";
import {
  ARROW_IMAGE,
  createArrowImage,
  currentFeatures,
  emptyOverlayData,
  geoJsonFeatures,
  headingFromTrack,
  INTERACTIVE_LAYERS,
  lngLatOf,
  NavMessage,
  OVERLAY,
  OverlaySource,
  overlayStyle,
  trackFeatures,
  ValueStyle,
} from "./features";
import { loadGeoTiff } from "./geotiff";
import {
  composeStyle,
  fetchVectorStyle,
  ImageOverlay,
  resolveSource,
  SourceParams,
  validateSourceUrl,
} from "./layers";
import { forgetSavedSources, loadSavedSources, rememberSource } from "./savedSources";
import {
  fixLabel,
  GeoJsonMessage,
  isGeoJSONMessage,
  isGeoJSONSchema,
  isSupportedSchema,
  isValidMapMessage,
} from "./support";

const log = Logger.getLogger(__filename);

/** Cap for the trail built from live data, where no recorded range is available. */
const LIVE_TRAIL_LIMIT = 100_000;

type Hit =
  | { kind: "nav"; message: NavMessage; value?: string }
  | { kind: "geojson"; message: GeoJsonMessage; name?: string };

type View = Pick<Config, "center" | "zoomLevel" | "bearing" | "pitch">;

function eventTimeSec(event: MessageEvent): number {
  return toSec(event.receiveTime);
}

function popupContent(hit: Hit): HTMLElement {
  const root = document.createElement("div");
  root.style.font = "12px/1.4 system-ui, sans-serif";
  const line = (text: string, style?: { bold: boolean }) => {
    const el = document.createElement("div");
    el.textContent = text;
    if (style?.bold === true) {
      el.style.fontWeight = "600";
    }
    root.appendChild(el);
  };
  if (hit.kind === "geojson" && hit.name) {
    line(hit.name, { bold: true });
  }
  line(hit.message.topic, { bold: hit.kind === "nav" });
  const stamp = hit.message.receiveTime;
  line(isAbsoluteTime(stamp) ? formatTime(stamp) : `${formatTimeRaw(stamp)} s`);
  if (hit.kind === "nav") {
    const { latitude, longitude, altitude } = hit.message.message;
    line(`${latitude.toFixed(7)}, ${longitude.toFixed(7)}`);
    if (altitude != undefined && isFinite(altitude)) {
      line(`alt ${altitude.toFixed(2)} m`);
    }
    line(fixLabel(hit.message));
    if (hit.value != undefined) {
      line(hit.value, { bold: true });
    }
  }
  return root;
}

function extendWithCoordinates(bounds: LngLatBounds, coords: unknown): void {
  if (Array.isArray(coords) && typeof coords[0] === "number") {
    bounds.extend(coords as Position as [number, number]);
  } else if (Array.isArray(coords)) {
    for (const c of coords) {
      extendWithCoordinates(bounds, c);
    }
  }
}

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: theme.palette.background.default,
    "& .maplibregl-popup-content": {
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      boxShadow: theme.shadows[4],
      padding: theme.spacing(0.75, 1),
    },
    "& .maplibregl-popup-tip": { display: "none" },
    // Above the panel's own overlays (legends, toolbar).
    "& .maplibregl-popup": { zIndex: 3 },
    // Theme MapLibre's built-in controls.
    "& .maplibregl-ctrl-group:not(:empty)": {
      backgroundColor: theme.palette.background.paper,
      boxShadow: theme.shadows[4],
      borderRadius: theme.shape.borderRadius,
      overflow: "hidden",
      "& button": {
        width: OVERLAY_TOOLBAR_BUTTON_SIZE,
        height: OVERLAY_TOOLBAR_BUTTON_SIZE,
        borderRadius: theme.shape.borderRadius,
      },
      "& button:focus-visible": {
        outline: "1px solid currentColor",
        outlineOffset: -1,
      },
      color: theme.palette.text.secondary,
      "& button + button": { borderTop: 0 },
      "& button:not(:disabled):hover": {
        backgroundColor: theme.palette.action.hover,
      },
    },
    "& .maplibregl-ctrl-icon, & .maplibregl-ctrl-attrib-button": {
      filter: theme.palette.mode === "dark" ? "invert(1)" : undefined,
    },
    "& .maplibregl-ctrl-attrib, & .maplibregl-ctrl-attrib.maplibregl-compact": {
      backgroundColor: alpha(theme.palette.background.paper, 0.85),
      color: theme.palette.text.secondary,
      "& a": { color: theme.palette.text.secondary },
    },
    "& .maplibregl-ctrl-scale": {
      backgroundColor: alpha(theme.palette.background.paper, 0.85),
      color: theme.palette.text.primary,
      borderColor: theme.palette.text.primary,
    },
  },
  // MapLibre adds `.maplibregl-map { position: relative }`, so size explicitly.
  map: { width: "100%", height: "100%" },
  legends: {
    // Under the zoom/compass controls; the attribution at the bottom can wrap to several lines.
    position: "absolute",
    right: 10,
    top: 10 + OVERLAY_TOOLBAR_BUTTON_SIZE * 3 + 10,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.5),
    pointerEvents: "none",
  },
  legend: {
    width: 180,
    padding: theme.spacing(0.5, 1),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: alpha(theme.palette.background.paper, 0.9),
    boxShadow: theme.shadows[2],
    fontSize: theme.typography.caption.fontSize,
    color: theme.palette.text.primary,
  },
  legendTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  legendBar: { height: 8, borderRadius: 2, margin: theme.spacing(0.25, 0) },
  legendScale: {
    display: "flex",
    justifyContent: "space-between",
    color: theme.palette.text.secondary,
    fontVariantNumeric: "tabular-nums",
  },
  notice: {
    position: "absolute",
    top: 10,
    left: "50%",
    transform: "translateX(-50%)",
  },
}));

/** Themed container; rendered inside ThemeProvider so it follows the panel's color scheme. */
function MapFrame(
  props: React.PropsWithChildren<{
    containerRef: React.RefObject<HTMLDivElement | null>;
  }>,
): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <div className={classes.root}>
      <div ref={props.containerRef} className={classes.map} />
      {props.children}
    </div>
  );
}

/** CSS gradient of the color scale; reversed scales map high values to the low end. */
const LEGEND_GRADIENT = _.range(0, 11).map((i) => turboColorString(i / 10));

function ColorLegends(props: {
  legends: { topic: string; title: string; range: [number, number]; reverse: boolean }[];
}): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <div className={classes.legends}>
      {props.legends.map(({ topic, title, range, reverse }) => (
        <div key={topic} className={classes.legend}>
          <div className={classes.legendTitle} title={`${topic}: ${title}`}>
            {topic} · {title}
          </div>
          <div
            className={classes.legendBar}
            style={{
              background: `linear-gradient(to ${reverse ? "left" : "right"}, ${LEGEND_GRADIENT.join(", ")})`,
            }}
          />
          <div className={classes.legendScale}>
            <span>{Number(range[0].toPrecision(4))}</span>
            <span>{Number(range[1].toPrecision(4))}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MapNotice({ children }: { children: string }): React.JSX.Element {
  const { classes } = useStyles();
  return <Chip size="small" label={children} className={classes.notice} />;
}

type MapPanelProps = {
  context: PanelExtensionContext;
};

function MapPanel({ context }: MapPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<Config>(() => normalizeConfig(context.initialState));
  const configRef = useLatest(config);
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("light");
  const [topics, setTopics] = useState<readonly Topic[]>([]);
  const [trackMessages, setTrackMessages] = useState<NavMessage[]>([]);
  const [currentNav, setCurrentNav] = useState<ReadonlyMap<string, NavMessage[]>>(new Map());
  const [currentGeo, setCurrentGeo] = useState<ReadonlyMap<string, GeoJsonMessage>>(new Map());
  const [previewTime, setPreviewTime] = useState<number | undefined>();
  const [renderDone, setRenderDone] = useState<() => void>(() => () => {});
  const [savedSources, setSavedSources] = useState(loadSavedSources);
  const savedSourcesRef = useLatest(savedSources);
  const [vectorStyles, setVectorStyles] = useState<ReadonlyMap<string, StyleSpecification>>(
    new Map(),
  );
  const [images, setImages] = useState<ReadonlyMap<string, ImageOverlay>>(new Map());
  const [sourceErrors, setSourceErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [map, setMap] = useState<MapLibreMap | undefined>();

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayData = useRef(emptyOverlayData());
  const measuringRef = useRef(false);
  const rangeTopicsRef = useRef(new Set<string>());
  // Values of "color by message path" expressions over time, by path string.
  const [pathSamples, setPathSamples] = useState<ReadonlyMap<string, Sample[]>>(new Map());
  const pathRangeTopicsRef = useRef(new Set<string>());
  const rememberedRef = useRef(new Set<string>());
  const viewRef = useRef<View>({
    center: config.center,
    zoomLevel: config.zoomLevel,
    bearing: config.bearing,
    pitch: config.pitch,
  });
  const didInitialFitRef = useRef(config.center != undefined);
  const userMovingRef = useRef(false);

  // --- Topics -----------------------------------------------------------------------------

  const eligibleTopics = useMemo(
    () =>
      filterMap(topics, (topic) => {
        if (isSupportedSchema(topic.schemaName)) {
          return { name: topic.name, schemaName: topic.schemaName };
        }
        const schemaName = topic.convertibleTo?.find(isSupportedSchema);
        return schemaName ? { name: topic.name, schemaName } : undefined;
      }),
    [topics],
  );

  const enabledTopics = useMemo(
    () => eligibleTopics.filter((topic) => !config.disabledTopics.includes(topic.name)),
    [config.disabledTopics, eligibleTopics],
  );
  const enabledNames = useMemo(() => new Set(enabledTopics.map((t) => t.name)), [enabledTopics]);

  // Stable identity unless the set of enabled position topics changes, so unrelated settings
  // (layer opacity, colors, ...) don't re-read the whole recording.
  const navTopicsKey = enabledTopics
    .filter((t) => !isGeoJSONSchema(t.schemaName))
    .map((t) => `${t.name}\0${t.schemaName}`)
    .join("\n");
  const navTopics = useMemo(
    () =>
      navTopicsKey === ""
        ? []
        : navTopicsKey.split("\n").map((line) => {
            const [name, schemaName] = line.split("\0") as [string, string];
            return { name, schemaName };
          }),
    [navTopicsKey],
  );

  const colors = useMemo(() => {
    const result = new Map<string, string>();
    eligibleTopics.forEach((topic, i) => {
      result.set(topic.name, config.topicColors[topic.name] ?? lineColors[i % lineColors.length]!);
    });
    return result;
  }, [config.topicColors, eligibleTopics]);

  // --- Settings ---------------------------------------------------------------------------

  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action === "perform-node-action" && action.payload.id === "forget-saved") {
        forgetSavedSources();
        rememberedRef.current.clear();
        setSavedSources([]);
        return;
      }
      setConfig((prev) => applySettingsAction(prev, action, savedSourcesRef.current));
    },
    [savedSourcesRef],
  );

  const layerErrors = useMemo(() => {
    const errors = new Map<string, string>();
    for (const layer of config.layers) {
      const params = resolveSource(layer);
      const error = params ? sourceErrors.get(params.url) : undefined;
      if (error) {
        errors.set(layer.id, error);
      }
    }
    return errors;
  }, [config.layers, sourceErrors]);

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: buildSettingsTree(config, eligibleTopics, savedSources, layerErrors),
    });
  }, [config, context, eligibleTopics, layerErrors, savedSources, settingsActionHandler]);

  useEffect(() => {
    // Drop the Leaflet-era fields once the config has been migrated.
    context.saveState({
      ...config,
      ...viewRef.current,
      layer: undefined,
      customTileUrl: undefined,
      maxNativeZoom: undefined,
    });
  }, [context, config]);

  /** Remember custom sources that actually worked, for reuse in other panels and layouts. */
  const rememberWorkingSource = useCallback(
    (match: (layerId: string, params: SourceParams) => boolean) => {
      for (const layer of configRef.current.layers) {
        const custom = layer.custom;
        if (layer.source !== "custom" || !custom?.url || validateSourceUrl(custom)) {
          continue;
        }
        const key = `${custom.kind}|${custom.url}`;
        if (match(layer.id, custom) && !rememberedRef.current.has(key)) {
          rememberedRef.current.add(key);
          setSavedSources(rememberSource(custom));
        }
      }
    },
    [configRef],
  );

  // --- Subscriptions ----------------------------------------------------------------------

  // Message paths that color a track, parsed. Stable unless the set of paths changes.
  const colorPathsKey = _.uniq(
    enabledTopics.flatMap((topic) => {
      const style = config.topicStyles[topic.name];
      return style?.colorBy === "path" && style.colorPath ? [style.colorPath] : [];
    }),
  )
    .sort()
    .join("\n");
  const colorPaths = useMemo(
    () =>
      filterMap(colorPathsKey === "" ? [] : colorPathsKey.split("\n"), (path) => {
        const parsed = parseMessagePath(path);
        return parsed ? { path, parsed } : undefined;
      }),
    [colorPathsKey],
  );
  const colorPathsRef = useLatest(colorPaths);

  useEffect(() => {
    const subscribed = new Set(enabledTopics.map((topic) => topic.name));
    context.subscribe([
      ...enabledTopics.map((topic) => ({
        topic: topic.name,
        convertTo: topic.schemaName,
        preload: false,
      })),
      // Topics read by "color by message path" (unless already subscribed above).
      ..._.uniq(colorPaths.map(({ parsed }) => parsed.topicName))
        .filter((topic) => !subscribed.has(topic))
        .map((topic) => ({ topic, preload: false })),
    ]);
  }, [colorPaths, context, enabledTopics]);

  useEffect(
    () => () => {
      context.unsubscribeAll();
    },
    [context],
  );

  // Batch incoming messages so long recordings don't re-render once per range batch.
  const pendingTrack = useRef<NavMessage[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const appendTrack = useCallback((messages: NavMessage[], cap?: number) => {
    pendingTrack.current.push(...messages);
    // Live trails (capped) rebuild less often: each flush redraws the whole retained trail.
    flushTimer.current ??= setTimeout(
      () => {
        flushTimer.current = undefined;
        const pending = pendingTrack.current;
        pendingTrack.current = [];
        setTrackMessages((prev) => {
          const next = prev.concat(pending);
          return cap != undefined && next.length > cap ? next.slice(-cap) : next;
        });
      },
      cap == undefined ? 50 : 500,
    );
  }, []);

  // The full track comes from the recorded range. GeoJSON is deliberately not ranged: each
  // message is a complete scene that replaces the previous one.
  useLayoutEffect(() => {
    setTrackMessages([]);
    pendingTrack.current = [];
    rangeTopicsRef.current = new Set();
    const unsubscribes = navTopics.map((topic) =>
      context.unstable_subscribeMessageRange({
        topic: topic.name,
        convertTo: topic.schemaName,
        onNewRangeIterator: async (iterator) => {
          // A new iterator replaces the topic's data (e.g. an edited user script); drop the old.
          pendingTrack.current = pendingTrack.current.filter((m) => m.topic !== topic.name);
          setTrackMessages((prev) => prev.filter((m) => m.topic !== topic.name));
          rangeTopicsRef.current.add(topic.name);
          for await (const batch of iterator) {
            const valid = batch.filter(
              (event): event is NavMessage => isValidMapMessage(event) && !isGeoJSONMessage(event),
            );
            if (valid.length > 0) {
              appendTrack(valid);
            }
          }
        },
      }),
    );
    return () => {
      clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [appendTrack, context, navTopics]);

  // Batched and (for live sources) capped like the track: each flush recolors the whole track.
  const pendingSamples = useRef(new Map<string, Sample[]>());
  const sampleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const appendPathSamples = useCallback(
    (
      messages: readonly MessageEvent[],
      paths: readonly { path: string; parsed: MessagePath }[],
      cap?: number,
    ) => {
      for (const { path, parsed } of paths) {
        for (const message of messages) {
          const value = simpleGetMessagePathDataItems(message, parsed).find(
            (item): item is number | bigint => typeof item === "number" || typeof item === "bigint",
          );
          if (value != undefined) {
            const samples = pendingSamples.current.get(path) ?? [];
            samples.push({ time: eventTimeSec(message), value: Number(value) });
            pendingSamples.current.set(path, samples);
          }
        }
      }
      if (pendingSamples.current.size === 0) {
        return;
      }
      sampleTimer.current ??= setTimeout(
        () => {
          sampleTimer.current = undefined;
          const pending = pendingSamples.current;
          pendingSamples.current = new Map();
          setPathSamples((prev) => {
            const next = new Map(prev);
            for (const [path, samples] of pending) {
              const all = (prev.get(path) ?? []).concat(samples);
              next.set(path, cap != undefined && all.length > cap ? all.slice(-cap) : all);
            }
            return next;
          });
        },
        cap == undefined ? 50 : 500,
      );
    },
    [],
  );

  // Recorded values for "color by message path".
  useLayoutEffect(() => {
    setPathSamples(new Map());
    pendingSamples.current = new Map();
    pathRangeTopicsRef.current = new Set();
    const byTopic = _.groupBy(colorPaths, ({ parsed }) => parsed.topicName);
    const unsubscribes = Object.entries(byTopic).map(([topic, paths]) =>
      context.unstable_subscribeMessageRange({
        topic,
        onNewRangeIterator: async (iterator) => {
          for (const { path } of paths) {
            pendingSamples.current.delete(path);
          }
          setPathSamples((prev) => {
            const next = new Map(prev);
            for (const { path } of paths) {
              next.delete(path);
            }
            return next;
          });
          pathRangeTopicsRef.current.add(topic);
          for await (const batch of iterator) {
            appendPathSamples(batch, paths);
          }
        },
      }),
    );
    return () => {
      clearTimeout(sampleTimer.current);
      sampleTimer.current = undefined;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [appendPathSamples, colorPaths, context]);

  useLayoutEffect(() => {
    context.watch("topics");
    context.watch("currentFrame");
    context.watch("previewTime");
    context.watch("colorScheme");
    context.watch("didSeek");

    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setPreviewTime(renderState.previewTime);

      if (renderState.topics) {
        setTopics((old) => (_.isEqual(old, renderState.topics) ? old : (renderState.topics ?? [])));
      }
      if (renderState.colorScheme) {
        setColorScheme(renderState.colorScheme);
      }

      // Live sources have no recorded range: collect "color by" values as they arrive.
      const livePathMessages = renderState.currentFrame?.filter(
        (m) => !pathRangeTopicsRef.current.has(m.topic),
      );
      if (livePathMessages && livePathMessages.length > 0 && colorPathsRef.current.length > 0) {
        appendPathSamples(livePathMessages, colorPathsRef.current, LIVE_TRAIL_LIMIT);
      }

      // After a seek the frame is a backfill: drop positions of topics it doesn't contain.
      if (renderState.didSeek === true) {
        setCurrentNav(new Map());
        setCurrentGeo(new Map());
      }

      const frame = renderState.currentFrame?.filter(isValidMapMessage);
      if (!frame || frame.length === 0) {
        return;
      }
      const [geo, nav] = _.partition(frame, isGeoJSONMessage) as [GeoJsonMessage[], NavMessage[]];
      if (nav.length > 0) {
        // Only replace topics present in this frame; other topics keep their last position.
        setCurrentNav(
          (prev) => new Map([...prev, ...Object.entries(_.groupBy(nav, (m) => m.topic))]),
        );
        // Live sources have no recorded range: build the track from what arrives.
        const live = nav.filter((m) => !rangeTopicsRef.current.has(m.topic));
        if (live.length > 0) {
          appendTrack(live, LIVE_TRAIL_LIMIT);
        }
      }
      if (geo.length > 0) {
        setCurrentGeo((prev) => {
          const next = new Map(prev);
          for (const message of geo) {
            next.set(message.topic, message);
          }
          return next;
        });
      }
    };

    return () => {
      context.onRender = undefined;
    };
  }, [appendPathSamples, appendTrack, colorPathsRef, context]);

  useEffect(() => {
    renderDone();
  }, [renderDone]);

  // --- Derived data -----------------------------------------------------------------------

  const visibleTrack = useMemo(
    () => trackMessages.filter((m) => enabledNames.has(m.topic)),
    [enabledNames, trackMessages],
  );
  const trackByTopic = useMemo(() => _.groupBy(visibleTrack, (m) => m.topic), [visibleTrack]);
  const trackTimesByTopic = useMemo(
    () => _.mapValues(trackByTopic, (m) => m.map(eventTimeSec)),
    [trackByTopic],
  );

  // "Color by": per-fix colors from speed or a message path, with a range per topic.
  const { valueStyles, legends } = useMemo(() => {
    const styles = new Map<NavMessage, ValueStyle>();
    const legendList: {
      topic: string;
      title: string;
      range: [number, number];
      reverse: boolean;
    }[] = [];
    for (const [topic, messages] of Object.entries(trackByTopic)) {
      const style = config.topicStyles[topic];
      const colorBy = style?.colorBy ?? "topic";
      if (colorBy === "topic") {
        continue;
      }
      const times = trackTimesByTopic[topic] ?? [];
      const values =
        colorBy === "speed"
          ? speedValues(
              messages.map((m, i) => ({ time: times[i]!, position: lngLatOf(m) })),
              config.units,
            )
          : sampleAt(pathSamples.get(style?.colorPath ?? "") ?? [], times);
      const range = valueRange(values, style?.colorMin, style?.colorMax);
      if (!range) {
        continue;
      }
      const reverse = style?.colorReverse === true;
      const unit = colorBy === "speed" ? ` ${speedUnitLabel(config.units)}` : "";
      messages.forEach((message, i) => {
        const value = values[i];
        if (value != undefined && isFinite(value)) {
          const t = normalize(value, range);
          styles.set(message, {
            color: turboColorString(reverse ? 1 - t : t),
            label: `${Number(value.toPrecision(4))}${unit}`,
          });
        }
      });
      legendList.push({
        topic,
        title:
          colorBy === "speed"
            ? `Speed (${speedUnitLabel(config.units)})`
            : (style?.colorPath ?? ""),
        range,
        reverse,
      });
    }
    return { valueStyles: styles, legends: legendList };
  }, [config.topicStyles, config.units, pathSamples, trackByTopic, trackTimesByTopic]);

  const currentMessages = useMemo(
    () => [...currentNav.values()].flat().filter((m) => enabledNames.has(m.topic)),
    [currentNav, enabledNames],
  );
  const geoMessages = useMemo(
    () => [...currentGeo.values()].filter((m) => enabledNames.has(m.topic)),
    [currentGeo, enabledNames],
  );

  const headings = useMemo(() => {
    const result = new Map<string, number>();
    for (const [topic, messages] of currentNav) {
      const current = messages[messages.length - 1];
      if (!current) {
        continue;
      }
      const history = trackByTopic[topic] ?? [];
      const end = _.sortedLastIndexBy(history, current, eventTimeSec);
      const heading = headingFromTrack([...history.slice(Math.max(0, end - 500), end), current]);
      if (heading != undefined) {
        result.set(topic, heading);
      }
    }
    return result;
  }, [currentNav, trackByTopic]);

  // Refs for event handlers, which map feature indices back to messages.
  const trackRef = useLatest(visibleTrack);
  const currentRef = useLatest(currentMessages);
  const geoRef = useLatest(geoMessages);

  // --- Map --------------------------------------------------------------------------------

  const setOverlay = useCallback(
    (id: OverlaySource, data: FeatureCollection) => {
      overlayData.current[id] = data;
      void map?.getSource<GeoJSONSource>(id)?.setData(data);
    },
    [map],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const initial = viewRef.current;
    const instance = new MapLibreMap({
      container,
      style: { version: 8, sources: {}, layers: [] },
      center: initial.center ? [initial.center.lon, initial.center.lat] : [0, 20],
      zoom: initial.zoomLevel ?? (initial.center ? 16 : 1.5),
      bearing: initial.bearing ?? 0,
      pitch: initial.pitch ?? 0,
      maxPitch: 85,
      attributionControl: false,
    });
    instance.addControl(new AttributionControl({ compact: true }), "bottom-right");
    instance.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    instance.on("styleimagemissing", (event) => {
      if (event.id === ARROW_IMAGE && !instance.hasImage(ARROW_IMAGE)) {
        instance.addImage(ARROW_IMAGE, createArrowImage(), {
          sdf: true,
          pixelRatio: 2,
        });
      }
    });
    // A full style reload recreates the overlay sources; restore their latest data.
    instance.on("style.load", () => {
      for (const [id, data] of Object.entries(overlayData.current)) {
        void instance.getSource<GeoJSONSource>(id)?.setData(data);
      }
    });
    instance.on("movestart", (event) => {
      if ("originalEvent" in event && event.originalEvent) {
        userMovingRef.current = true;
        didInitialFitRef.current = true;
      }
    });
    instance.on("moveend", () => {
      userMovingRef.current = false;
      const center = instance.getCenter();
      viewRef.current = {
        center: { lat: center.lat, lon: center.lng },
        zoomLevel: instance.getZoom(),
        bearing: instance.getBearing(),
        pitch: instance.getPitch(),
      };
      context.saveState(viewRef.current);
    });

    // The panel resizes without window resizes, so observe the container directly.
    const Observer = container.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(() => {
      instance.resize();
    });
    observer.observe(container);
    setMap(instance);
    return () => {
      observer.disconnect();
      instance.remove();
      setMap(undefined);
    };
  }, [context]);

  // Custom URL fields update on every keystroke; only use URLs once they stop changing so
  // half-typed URLs aren't fetched. Other layer settings (sliders, toggles) apply immediately.
  const customUrls = config.layers.map((layer) => layer.custom?.url ?? "").join("\n");
  const [settledUrls] = useDebounce(customUrls, 400);
  const urlsSettled = customUrls === settledUrls;

  // Compose and apply the style. MapLibre diffs it against the current one.
  useEffect(() => {
    if (!map || !urlsSettled) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      map.setStyle(
        composeStyle({
          layers: config.layers,
          vectorStyles,
          images,
          projection: config.projection,
          overlay: overlayStyle(overlayData.current),
        }),
        { diff: true },
      );
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [config.layers, config.projection, images, map, urlsSettled, vectorStyles]);

  // Load vector styles and GeoTIFFs referenced by layers. Each URL loads once with its own
  // controller, aborted only when no layer references the URL any more, so unrelated setting
  // changes (e.g. an opacity slider) never restart a download.
  const loadsRef = useRef(new Map<string, AbortController>());
  const loadedRef = useLatest({ vectorStyles, images, sourceErrors });
  useEffect(() => {
    if (!urlsSettled) {
      return;
    }
    const loads = loadsRef.current;
    const wanted = new Map<string, "vector" | "geotiff">();
    for (const layer of config.layers) {
      const params = resolveSource(layer);
      if (
        params &&
        (params.kind === "vector" || params.kind === "geotiff") &&
        !validateSourceUrl(params)
      ) {
        wanted.set(params.url, params.kind);
      }
    }

    for (const [url, controller] of loads) {
      if (!wanted.has(url)) {
        controller.abort();
        loads.delete(url);
      }
    }
    // Free decoded images that no layer uses any more.
    setImages((prev) => {
      const unused = [...prev.keys()].filter((url) => !wanted.has(url));
      if (unused.length === 0) {
        return prev;
      }
      const next = new Map(prev);
      for (const url of unused) {
        URL.revokeObjectURL(prev.get(url)!.url);
        next.delete(url);
      }
      return next;
    });

    const loaded = loadedRef.current;
    for (const [url, kind] of wanted) {
      const have = kind === "vector" ? loaded.vectorStyles.has(url) : loaded.images.has(url);
      // A failed URL is retried once it is changed (its error is shown on the layer).
      if (have || loads.has(url) || loaded.sourceErrors.has(url)) {
        continue;
      }
      const controller = new AbortController();
      loads.set(url, controller);
      const settle = () => {
        if (loads.get(url) === controller) {
          loads.delete(url);
        }
      };
      const done = () => {
        settle();
        rememberWorkingSource((_id, p) => p.url === url);
      };
      const fail = (error: unknown) => {
        settle();
        if (!controller.signal.aborted) {
          setSourceErrors((prev) =>
            new Map(prev).set(url, String(error instanceof Error ? error.message : error)),
          );
        }
      };
      if (kind === "vector") {
        fetchVectorStyle(url, controller.signal).then((style) => {
          setVectorStyles((prev) => new Map(prev).set(url, style));
          done();
        }, fail);
      } else {
        loadGeoTiff(url, controller.signal).then((image) => {
          if (controller.signal.aborted) {
            URL.revokeObjectURL(image.url);
            return;
          }
          setImages((prev) => new Map(prev).set(url, image));
          done();
        }, fail);
      }
    }
  }, [config.layers, loadedRef, rememberWorkingSource, urlsSettled]);

  // On unmount: stop downloads and free decoded images.
  const imagesRef = useLatest(images);
  useEffect(
    () => () => {
      for (const controller of loadsRef.current.values()) {
        controller.abort();
      }
      for (const image of imagesRef.current.values()) {
        URL.revokeObjectURL(image.url);
      }
    },
    [imagesRef],
  );

  // Tile sources: remember them once a tile loads; report errors only if none ever loaded.
  useEffect(() => {
    if (!map) {
      return;
    }
    const loaded = new Set<string>();
    const urlOfSource = (sourceId: string) => {
      const layer = configRef.current.layers.find((l) => sourceId.startsWith(l.id));
      return layer ? resolveSource(layer)?.url : undefined;
    };
    const onData = (event: { dataType: string; sourceId?: string; tile?: unknown }) => {
      if (
        event.dataType !== "source" ||
        !event.sourceId ||
        event.tile == undefined ||
        loaded.has(event.sourceId)
      ) {
        return;
      }
      loaded.add(event.sourceId);
      const url = urlOfSource(event.sourceId);
      rememberWorkingSource((id) => event.sourceId!.startsWith(id));
      if (url) {
        setSourceErrors((prev) =>
          prev.has(url) ? new Map([...prev].filter(([k]) => k !== url)) : prev,
        );
      }
    };
    const onError = (event: { error?: { message?: string }; sourceId?: string }) => {
      if (!event.sourceId) {
        // Listening to "error" stops MapLibre's own logging, so keep non-tile errors visible.
        log.warn("Map error:", event.error?.message ?? event.error);
        return;
      }
      if (loaded.has(event.sourceId) || event.sourceId.startsWith("lb:")) {
        return;
      }
      const url = urlOfSource(event.sourceId);
      if (url) {
        setSourceErrors((prev) =>
          new Map(prev).set(url, event.error?.message ?? "Failed to load tiles"),
        );
      }
    };
    map.on("data", onData);
    map.on("error", onError);
    return () => {
      map.off("data", onData);
      map.off("error", onError);
    };
  }, [configRef, map, rememberWorkingSource]);

  // Interaction settings and controls.
  useEffect(() => {
    if (!map) {
      return;
    }
    if (config.allowRotation) {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.touchPitch.enable();
    } else {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.touchPitch.disable();
      if (config.followMode !== "heading" || !config.followTopic) {
        map.easeTo({ bearing: 0, pitch: 0 });
      }
    }
  }, [config.allowRotation, config.followMode, config.followTopic, map]);

  useEffect(() => {
    if (!map || !config.showScale) {
      return;
    }
    const scale = new ScaleControl({ unit: config.units, maxWidth: 120 });
    map.addControl(scale, "bottom-left");
    return () => {
      // The map may already be removed when the panel unmounts.
      if (map.hasControl(scale)) {
        map.removeControl(scale);
      }
    };
  }, [config.showScale, config.units, map]);

  // --- Overlay data -----------------------------------------------------------------------

  useEffect(() => {
    const { points, lines } = trackFeatures(visibleTrack, colors, config.topicStyles, (i) =>
      valueStyles.get(visibleTrack[i]!),
    );
    setOverlay(OVERLAY.track, points);
    setOverlay(OVERLAY.trackLine, lines);
  }, [colors, config.topicStyles, setOverlay, valueStyles, visibleTrack]);

  useEffect(() => {
    const { markers, accuracy } = currentFeatures(
      currentMessages,
      colors,
      config.topicStyles,
      headings,
    );
    setOverlay(OVERLAY.current, markers);
    setOverlay(OVERLAY.accuracy, accuracy);
  }, [colors, config.topicStyles, currentMessages, headings, setOverlay]);

  useEffect(() => {
    setOverlay(OVERLAY.geojson, geoJsonFeatures(geoMessages, colors));
  }, [colors, geoMessages, setOverlay]);

  // Marker for the hovered time (e.g. from a plot) on any track.
  useEffect(() => {
    let best: NavMessage | undefined;
    if (previewTime != undefined) {
      for (const [topic, messages] of Object.entries(trackByTopic)) {
        const index = _.sortedLastIndex(trackTimesByTopic[topic], previewTime);
        const candidate = messages[index - 1];
        if (candidate && (!best || eventTimeSec(candidate) > eventTimeSec(best))) {
          best = candidate;
        }
      }
    }
    const base = best ? colors.get(best.topic) : undefined;
    setOverlay(OVERLAY.preview, {
      type: "FeatureCollection",
      features:
        best && base
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: lngLatOf(best) },
                properties: {
                  c: darkColor(base),
                  r: config.topicStyles[best.topic]?.pointSize ?? DEFAULT_POINT_SIZE,
                },
              },
            ]
          : [],
    });
  }, [colors, config.topicStyles, previewTime, setOverlay, trackByTopic, trackTimesByTopic]);

  const setMeasureData = useCallback(
    (data: FeatureCollection) => {
      setOverlay(OVERLAY.measure, data);
    },
    [setOverlay],
  );

  // --- Camera -----------------------------------------------------------------------------

  const dataBounds = useCallback((): LngLatBounds | undefined => {
    const bounds = new LngLatBounds();
    for (const message of trackRef.current) {
      bounds.extend(lngLatOf(message));
    }
    for (const message of currentRef.current) {
      bounds.extend(lngLatOf(message));
    }
    for (const feature of overlayData.current[OVERLAY.geojson].features) {
      if (feature.geometry.type !== "GeometryCollection") {
        extendWithCoordinates(bounds, feature.geometry.coordinates);
      }
    }
    return bounds.isEmpty() ? undefined : bounds;
  }, [currentRef, trackRef]);

  const fitToData = useCallback(
    (duration = 600) => {
      const bounds = dataBounds();
      if (!map || !bounds) {
        return;
      }
      // Fit as if looking straight down, then keep the user's tilt: fitting at a steep pitch
      // zooms in far too much.
      const camera = map.cameraForBounds(bounds, {
        padding: 48,
        maxZoom: 18,
        bearing: map.getBearing(),
        pitch: 0,
      });
      if (camera) {
        map.easeTo({ ...camera, pitch: map.getPitch(), duration });
      }
    },
    [dataBounds, map],
  );

  // First data without a saved view: frame it, re-fitting while the recording streams in,
  // until the user takes over or loading settles.
  const firstDataAtRef = useRef<number>(undefined);
  const dataSize = visibleTrack.length + currentMessages.length + geoMessages.length;
  useEffect(() => {
    if (!map || dataSize === 0 || didInitialFitRef.current) {
      return;
    }
    firstDataAtRef.current ??= Date.now();
    if (Date.now() - firstDataAtRef.current > 3000) {
      didInitialFitRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      if (!didInitialFitRef.current) {
        fitToData(0);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [dataSize, fitToData, map]);

  // Follow a topic.
  useEffect(() => {
    if (!map || !config.followTopic || userMovingRef.current) {
      return;
    }
    const messages = currentNav.get(config.followTopic);
    const current = messages?.[messages.length - 1];
    if (!current) {
      return;
    }
    const center = lngLatOf(current);
    const heading = config.followMode === "heading" ? headings.get(config.followTopic) : undefined;
    const options = {
      center,
      ...(heading != undefined ? { bearing: heading } : {}),
    };
    // Jump on seeks and big moves, glide during normal playback.
    if (map.getBounds().contains(center)) {
      map.easeTo({
        ...options,
        duration: 200,
        easing: (t) => t,
        essential: true,
      });
    } else {
      map.jumpTo(options);
    }
  }, [config.followMode, config.followTopic, currentNav, headings, map]);

  // --- Hover and click --------------------------------------------------------------------

  useEffect(() => {
    if (!map) {
      return;
    }
    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
      maxWidth: "280px",
    });
    let hovered: Hit | undefined;

    const pick = (event: MapMouseEvent): Hit | undefined => {
      // Most specific first: a track point inside a GeoJSON area should win over the area.
      const priority: string[] = [
        ...INTERACTIVE_LAYERS.current,
        INTERACTIVE_LAYERS.track,
        ...INTERACTIVE_LAYERS.geojson.slice().reverse(),
      ];
      const layers = priority.filter((id) => map.getLayer(id) != undefined);
      // A few pixels of slack makes small points easy to hover.
      const { x, y } = event.point;
      const hits = map.queryRenderedFeatures(
        [
          [x - 4, y - 4],
          [x + 4, y + 4],
        ],
        { layers },
      );
      const feature = _.minBy(hits, (hit) => priority.indexOf(hit.layer.id));
      const index = feature?.properties.i as number | undefined;
      if (!feature || index == undefined) {
        return undefined;
      }
      const layerId = feature.layer.id;
      if (layerId === INTERACTIVE_LAYERS.track) {
        const message = trackRef.current[index];
        const value: unknown = feature.properties.v;
        return message
          ? { kind: "nav", message, value: typeof value === "string" ? value : undefined }
          : undefined;
      }
      if ((INTERACTIVE_LAYERS.current as readonly string[]).includes(layerId)) {
        const message = currentRef.current[index];
        return message ? { kind: "nav", message } : undefined;
      }
      const message = geoRef.current[index];
      const name: unknown = feature.properties.name;
      return message
        ? {
            kind: "geojson",
            message,
            name: typeof name === "string" && name ? name : undefined,
          }
        : undefined;
    };

    const clear = () => {
      if (hovered) {
        hovered = undefined;
        popup.remove();
        map.getCanvas().style.cursor = "";
        context.setPreviewTime(undefined);
      }
    };

    const onMove = (event: MapMouseEvent) => {
      if (measuringRef.current) {
        clear();
        return;
      }
      const hit = pick(event);
      if (!hit) {
        clear();
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      popup.setLngLat(event.lngLat);
      if (hit.message !== hovered?.message) {
        hovered = hit;
        popup.setDOMContent(popupContent(hit)).addTo(map);
        context.setPreviewTime(eventTimeSec(hit.message));
      }
    };
    const onClick = (event: MapMouseEvent) => {
      if (measuringRef.current) {
        return;
      }
      const hit = pick(event);
      if (hit) {
        context.seekPlayback?.(hit.message.receiveTime);
      }
    };

    map.on("mousemove", onMove);
    map.on("click", onClick);
    map.getCanvas().addEventListener("mouseleave", clear);
    return () => {
      map.off("mousemove", onMove);
      map.off("click", onClick);
      map.getCanvas().removeEventListener("mouseleave", clear);
      popup.remove();
    };
  }, [context, currentRef, geoRef, map, trackRef]);

  // --- Render -----------------------------------------------------------------------------

  return (
    <ThemeProvider isDark={colorScheme === "dark"}>
      <MapFrame containerRef={containerRef}>
        {map && (
          <MapToolbar
            map={map}
            units={config.units}
            showCoordinates={config.showCoordinates}
            setMeasureData={setMeasureData}
            measuringRef={measuringRef}
            onFitToData={dataSize > 0 ? fitToData : undefined}
          />
        )}
        {legends.length > 0 && <ColorLegends legends={legends} />}
        {eligibleTopics.length === 0 && (
          <MapNotice>No NavSatFix, LocationFix, or GeoJSON topics</MapNotice>
        )}
      </MapFrame>
    </ThemeProvider>
  );
}

export default MapPanel;
