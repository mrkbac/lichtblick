// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec } from "@foxglove/rostime";
import { Chip, alpha } from "@mui/material";
import type { FeatureCollection } from "geojson";
import * as _ from "lodash-es";
import {
  GeoJSONSource,
  LngLatBounds,
  MapGeoJSONFeature,
  Map as MapLibreMap,
  MapMouseEvent,
  MercatorCoordinate,
  NavigationControl,
  Popup,
  ScaleControl,
  StyleSpecification,
} from "maplibre-gl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";
import { useDebounce } from "use-debounce";

import { filterMap, pushAll } from "@lichtblick/den/collection";
import { useDeepMemo, useLatest } from "@lichtblick/hooks";
import Logger from "@lichtblick/log";
import { MessagePath, parseMessagePath } from "@lichtblick/message-path";
import { MessageEvent, SettingsTreeAction, Topic } from "@lichtblick/suite";
import { simpleGetMessagePathDataItems } from "@lichtblick/suite-base/components/MessagePathSyntax/simpleGetMessagePathDataItems";
import { OVERLAY_TOOLBAR_BUTTON_SIZE } from "@lichtblick/suite-base/components/OverlayToolbar";
import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { PANEL_FLOATING_TOOLBAR_HEIGHT } from "@lichtblick/suite-base/components/PanelToolbar/constants";
import { addTopicsDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { turboColorString } from "@lichtblick/suite-base/util/colorUtils";
import { formatTime } from "@lichtblick/suite-base/util/formatTime";
import { darkColor, lineColors } from "@lichtblick/suite-base/util/plotColors";
import { upperBound } from "@lichtblick/suite-base/util/sortedSearch";
import { formatTimeRaw, isAbsoluteTime } from "@lichtblick/suite-base/util/time";
import { toError } from "@lichtblick/suite-base/util/toError";

import { AutoHideAttributionControl } from "./AutoHideAttributionControl";
import { MapToolbar } from "./MapToolbar";
import { sampleAt, speedUnitLabel, speedValues, valueRange } from "./colorBy";
import {
  applySettingsAction,
  buildSettingsTree,
  Config,
  DEFAULT_POINT_SIZE,
  FOLLOW_MOVE_EVENT,
  normalizeConfig,
  shouldSaveView,
} from "./config";
import {
  ARROW_IMAGE,
  ColorScale,
  createArrowImage,
  currentFeatures,
  DataSource,
  DrawnTrack,
  emptyOverlayData,
  fixPasses,
  geoJsonFeatures,
  groupHitsByTopic,
  headingFromTrack,
  INTERACTIVE_LAYERS,
  lngLatOf,
  NavMessage,
  OVERLAY,
  OverlaySource,
  overlayStyle,
  resolveTrackFix,
  trackFixKey,
  trackFeatures,
  trackFlushDelayMs,
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
  expandLocationFixes,
} from "./support";
import { SampleStore, thinTrack, thinViewCovers, thinViewFor, ThinView, TrackStore } from "./track";

const log = Logger.getLogger(__filename);

/** Track points drawn at once, over all topics; the track is thinned to fit. */
const TRACK_POINT_BUDGET = 50_000;

/** `id` tells hovered things apart: the same fix or feature keeps its popup. */
type NavHitStop = { first: NavMessage; last: NavMessage; count: number };

type NavHit = {
  kind: "nav";
  id: unknown;
  message: NavMessage;
  value?: string;
  /** The stop `message` belongs to, when the cursor is over more than one of its fixes. */
  stop?: NavHitStop;
};

type Hit = NavHit | { kind: "geojson"; id: unknown; message: GeoJsonMessage; name?: string };

type View = Pick<Config, "center" | "zoomLevel" | "bearing" | "pitch">;

function eventTimeSec(event: MessageEvent): number {
  return toSec(event.receiveTime);
}

function hitContent(hit: Hit): HTMLElement {
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
  line(stampText(startOf(hit)));
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
    if (hit.stop) {
      line(`here ${stopText(hit.stop)}`);
    }
  }
  return root;
}

/** Rows listed per topic, and topics listed, when several features are under the cursor. */
const ROWS_PER_TOPIC = 3;
const TOPICS_LISTED = 6;

/**
 * The visit of fixes `first` to `last` when it is a stop (a second or more), not just dense
 * sampling while passing by.
 */
function stopAt(store: TrackStore, first: number, last: number): NavHitStop | undefined {
  const { time } = store.columns;
  return time[last]! - time[first]! >= 1
    ? { first: store.message(first), last: store.message(last), count: last - first + 1 }
    : undefined;
}

/** "600 fixes, 9:59": how long the cursor's spot was visited. */
function stopText({ first, last, count }: NavHitStop): string {
  const seconds = toSec(last.receiveTime) - toSec(first.receiveTime);
  const span =
    seconds < 60
      ? `${seconds.toFixed(1)} s`
      : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return `${count} fixes, ${span}`;
}

/** Where a hit is in time: a stop where it starts, so seeking there shows the whole stop. */
function startOf(hit: Hit): MessageEvent {
  return (hit.kind === "nav" ? hit.stop?.first : undefined) ?? hit.message;
}

function stampText(message: MessageEvent): string {
  const stamp = message.receiveTime;
  return isAbsoluteTime(stamp) ? formatTime(stamp) : `${formatTimeRaw(stamp)} s`;
}

/**
 * One popup for everything under the cursor: a topic heading per group, then a row per hit (time
 * and its key field). Rows are buttons that `onPick` the hit once the popup is pinned.
 */
function hitsContent(
  groups: readonly Hit[][],
  onPick: (message: MessageEvent) => void,
): HTMLElement {
  const root = document.createElement("div");
  root.style.font = "12px/1.4 system-ui, sans-serif";
  const add = (text: string, className?: string) => {
    const el = document.createElement("div");
    el.textContent = text;
    if (className) {
      el.className = className;
    }
    root.appendChild(el);
  };
  for (const group of groups.slice(0, TOPICS_LISTED)) {
    const { topic } = group[0]!.message;
    const count = group.length;
    add(count > 1 ? `${topic} (${count})` : topic, "hit-topic");
    for (const hit of group.slice(0, ROWS_PER_TOPIC)) {
      const stop = hit.kind === "nav" ? hit.stop : undefined;
      const start = startOf(hit);
      const detail =
        hit.kind === "geojson"
          ? (hit.name ?? "feature")
          : stop
            ? stopText(stop)
            : (hit.value ?? fixLabel(hit.message));
      const row = document.createElement("button");
      row.type = "button";
      row.className = "hit-row";
      row.textContent = `${stampText(start)} · ${detail}`;
      row.addEventListener("click", () => {
        onPick(start);
      });
      root.appendChild(row);
    }
    if (count > ROWS_PER_TOPIC) {
      add(
        `+${count - ROWS_PER_TOPIC} more, last ${stampText(group[group.length - 1]!.message)}`,
        "hit-more",
      );
    }
  }
  if (groups.length > TOPICS_LISTED) {
    add(`+${groups.length - TOPICS_LISTED} more topics`, "hit-more");
  }
  return root;
}

function extendWithCoordinates(bounds: LngLatBounds, coords: unknown): void {
  if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
    bounds.extend([coords[0], coords[1]]);
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
    ".maplibregl-ctrl-top-right": { top: PANEL_FLOATING_TOOLBAR_HEIGHT },
    backgroundColor: theme.palette.background.default,
    "& .maplibregl-popup-content": {
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      boxShadow: theme.shadows[4],
      padding: theme.spacing(0.75, 1),
    },
    "& .maplibregl-popup-tip": { display: "none" },
    // The list of a stack under the cursor: rows become clickable once a click pins it.
    "& .maplibregl-popup .hit-topic": { fontWeight: 600, marginTop: 2 },
    "& .maplibregl-popup .hit-more": { color: theme.palette.text.secondary },
    "& .maplibregl-popup .hit-row": {
      display: "block",
      width: "100%",
      padding: theme.spacing(0, 0.5),
      border: 0,
      borderRadius: theme.shape.borderRadius,
      background: "none",
      color: "inherit",
      font: "inherit",
      textAlign: "left",
    },
    "& .maplibregl-popup.pinned .hit-row": { cursor: "pointer" },
    "& .maplibregl-popup.pinned .hit-row:hover": {
      backgroundColor: theme.palette.action.hover,
    },
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
    minHeight: 0,
    overflowY: "auto",
    pointerEvents: "auto",
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing(0.5),
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
    top: `calc(10px + ${PANEL_FLOATING_TOOLBAR_HEIGHT})`,
    left: "50%",
    transform: "translateX(-50%)",
    // Stay between the tool bar on the left and the zoom controls on the right (10px insets).
    maxWidth: `calc(100% - ${2 * (10 + OVERLAY_TOOLBAR_BUTTON_SIZE + 10)}px)`,
    // Wrap instead of truncating, so the whole notice stays readable in a narrow panel.
    height: "auto",
    "& .MuiChip-label": { whiteSpace: "normal", textAlign: "center", paddingBlock: 2 },
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
const LEGEND_GRADIENT = Array.from({ length: 11 }, (_unused, i) => turboColorString(i / 10));

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
  context: BuiltinPanelExtensionContext;
};

function MapPanel({ context }: MapPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<Config>(() => normalizeConfig(context.initialState));
  const configRef = useLatest(config);
  const [colorScheme, setColorScheme] = useState<"dark" | "light">("light");
  const [topics, setTopics] = useState<readonly Topic[]>([]);
  // Fixes per topic, in mutable stores; the state object is replaced when they change.
  const tracksRef = useRef(new Map<string, TrackStore>());
  const [tracks, setTracks] = useState({ stores: tracksRef.current });
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
  const samplesRef = useRef(new Map<string, SampleStore>());
  const [pathSamples, setPathSamples] = useState({ stores: samplesRef.current });
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
  const eligibleTopicsRef = useLatest(eligibleTopics);

  const enabledTopics = useMemo(
    () => eligibleTopics.filter((topic) => !config.disabledTopics.includes(topic.name)),
    [config.disabledTopics, eligibleTopics],
  );
  const enabledNames = useMemo(() => new Set(enabledTopics.map((t) => t.name)), [enabledTopics]);

  // Stable identity unless the set of enabled position topics changes, so unrelated settings
  // (layer opacity, colors, ...) don't re-read the whole recording.
  const navTopics = useDeepMemo(
    enabledTopics
      .filter((t) => !isGeoJSONSchema(t.schemaName))
      .map(({ name, schemaName }) => ({ name, schemaName })),
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
      setConfig((prev) =>
        applySettingsAction(
          prev,
          action,
          savedSourcesRef.current,
          eligibleTopicsRef.current.map((topic) => topic.name),
        ),
      );
    },
    [eligibleTopicsRef, savedSourcesRef],
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

  // Drop a topic that is turned off from the topic list to show it again
  useEffect(() => {
    context.unstable_setMessagePathDropConfig(
      addTopicsDrop(
        (item) => config.disabledTopics.includes(item.topicName),
        (dropped) => {
          setConfig((prev) => ({
            ...prev,
            disabledTopics: prev.disabledTopics.filter((topic) => !dropped.includes(topic)),
          }));
        },
      ),
    );
  }, [config.disabledTopics, context]);

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
  const colorPathNames = useDeepMemo(
    [
      ...new Set(
        enabledTopics.flatMap((topic) => {
          const style = config.topicStyles[topic.name];
          return style?.colorBy === "path" && style.colorPath ? [style.colorPath] : [];
        }),
      ),
    ].sort(),
  );
  const colorPaths = useMemo(
    () =>
      filterMap(colorPathNames, (path) => {
        const parsed = parseMessagePath(path);
        return parsed ? { path, parsed } : undefined;
      }),
    [colorPathNames],
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
      ...[...new Set(colorPaths.map(({ parsed }) => parsed.topicName))]
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

  // Fixes go straight into the stores; re-renders are batched so long recordings don't redraw
  // once per range batch.
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trackLength = () => _.sumBy([...tracksRef.current.values()], (store) => store.length);
  const scheduleTrackFlush = useCallback((source: DataSource) => {
    flushTimer.current ??= setTimeout(
      () => {
        flushTimer.current = undefined;
        setTracks({ stores: tracksRef.current });
      },
      trackFlushDelayMs(trackLength(), source),
    );
  }, []);
  const appendTrack = useCallback(
    (messages: readonly NavMessage[], source: DataSource) => {
      for (const message of messages) {
        let store = tracksRef.current.get(message.topic);
        if (!store) {
          store = new TrackStore(message.topic);
          tracksRef.current.set(message.topic, store);
        }
        store.push(message);
      }
      scheduleTrackFlush(source);
    },
    [scheduleTrackFlush],
  );

  // The full track comes from the recorded range. GeoJSON is deliberately not ranged: each
  // message is a complete scene that replaces the previous one.
  useLayoutEffect(() => {
    tracksRef.current = new Map();
    setTracks({ stores: tracksRef.current });
    rangeTopicsRef.current = new Set();
    const unsubscribes = navTopics.map((topic) =>
      context.unstable_subscribeMessageRange({
        topic: topic.name,
        convertTo: topic.schemaName,
        onNewRangeIterator: async (iterator) => {
          // A new iterator replaces the topic's data (e.g. an edited user script); drop the old.
          tracksRef.current.get(topic.name)?.clear();
          scheduleTrackFlush("recorded");
          rangeTopicsRef.current.add(topic.name);
          for await (const batch of iterator) {
            const valid = expandLocationFixes(batch).filter(
              (event): event is NavMessage => isValidMapMessage(event) && !isGeoJSONMessage(event),
            );
            if (valid.length > 0) {
              appendTrack(valid, "recorded");
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
  }, [appendTrack, context, navTopics, scheduleTrackFlush]);

  // Batched like the track: each flush recolors the whole track.
  const sampleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const appendPathSamples = useCallback(
    (
      messages: readonly MessageEvent[],
      paths: readonly { path: string; parsed: MessagePath }[],
      source: DataSource,
    ) => {
      let added = false;
      for (const { path, parsed } of paths) {
        for (const message of messages) {
          const value = simpleGetMessagePathDataItems(message, parsed).find(
            (item): item is number | bigint => typeof item === "number" || typeof item === "bigint",
          );
          if (value != undefined) {
            let store = samplesRef.current.get(path);
            if (!store) {
              store = new SampleStore();
              samplesRef.current.set(path, store);
            }
            store.push(eventTimeSec(message), Number(value));
            added = true;
          }
        }
      }
      if (!added) {
        return;
      }
      sampleTimer.current ??= setTimeout(
        () => {
          sampleTimer.current = undefined;
          setPathSamples({ stores: samplesRef.current });
        },
        // Each flush recolors the whole track, so it is paced by the track's length.
        trackFlushDelayMs(trackLength(), source),
      );
    },
    [],
  );

  // Recorded values for "color by message path".
  useLayoutEffect(() => {
    samplesRef.current = new Map();
    setPathSamples({ stores: samplesRef.current });
    pathRangeTopicsRef.current = new Set();
    const byTopic = Map.groupBy(colorPaths, ({ parsed }) => parsed.topicName);
    const unsubscribes = [...byTopic].map(([topic, paths]) =>
      context.unstable_subscribeMessageRange({
        topic,
        onNewRangeIterator: async (iterator) => {
          for (const { path } of paths) {
            samplesRef.current.get(path)?.clear();
          }
          setPathSamples({ stores: samplesRef.current });
          pathRangeTopicsRef.current.add(topic);
          for await (const batch of iterator) {
            appendPathSamples(batch, paths, "recorded");
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
        appendPathSamples(livePathMessages, colorPathsRef.current, "live");
      }

      // After a seek the frame is a backfill: drop positions of topics it doesn't contain.
      if (renderState.didSeek === true) {
        setCurrentNav(new Map());
        setCurrentGeo(new Map());
      }

      const frame =
        renderState.currentFrame &&
        expandLocationFixes(renderState.currentFrame).filter(isValidMapMessage);
      if (!frame || frame.length === 0) {
        return;
      }
      const [geo, nav] = _.partition(frame, isGeoJSONMessage);
      if (nav.length > 0) {
        // Only replace topics present in this frame; other topics keep their last position.
        setCurrentNav((prev) => new Map([...prev, ...Map.groupBy(nav, (m) => m.topic)]));
        // Live sources have no recorded range: build the track from what arrives.
        const live = nav.filter((m) => !rangeTopicsRef.current.has(m.topic));
        if (live.length > 0) {
          appendTrack(live, "live");
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

  const visibleTracks = useMemo(
    () => [...tracks.stores.values()].filter((t) => t.length > 0 && enabledNames.has(t.topic)),
    [enabledNames, tracks],
  );

  // "Color by": per-fix values from speed or a message path, with a range per topic.
  const { colorValues, legends } = useMemo(() => {
    const values = new Map<string, ColorScale>();
    const legendList: {
      topic: string;
      title: string;
      range: [number, number];
      reverse: boolean;
    }[] = [];
    for (const store of visibleTracks) {
      const { topic } = store;
      const style = config.topicStyles[topic];
      const colorBy = style?.colorBy ?? "topic";
      if (colorBy === "topic") {
        continue;
      }
      const raw =
        colorBy === "speed"
          ? speedValues(store, config.units)
          : sampleAt(pathSamples.stores.get(style?.colorPath ?? ""), store);
      const range = valueRange(raw, style?.colorMin, style?.colorMax);
      if (!range) {
        continue;
      }
      const reverse = style?.colorReverse === true;
      const unit = colorBy === "speed" ? ` ${speedUnitLabel(config.units)}` : "";
      values.set(topic, { values: raw, range, reverse, unit });
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
    return { colorValues: values, legends: legendList };
  }, [config.topicStyles, config.units, pathSamples, visibleTracks]);

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
      const store = tracks.stores.get(topic);
      const end = store
        ? upperBound(store.columns.time, 0, store.length, eventTimeSec(current))
        : 0;
      const heading = store ? headingFromTrack(store, end, lngLatOf(current)) : undefined;
      if (heading != undefined) {
        result.set(topic, heading);
      }
    }
    return result;
  }, [currentNav, tracks]);

  // Refs for event handlers, which map feature indices back to messages.
  const currentRef = useLatest(currentMessages);
  const geoRef = useLatest(geoMessages);
  const visibleTracksRef = useLatest(visibleTracks);

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
      trackResize: false,
      // Label fades ask for a repaint on every display frame after each move; while following,
      // the map moves with every position, so it would never stop redrawing
      fadeDuration: 0,
    });
    instance.addControl(new AutoHideAttributionControl(), "bottom-right");
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
    instance.on("moveend", (event) => {
      userMovingRef.current = false;
      const center = instance.getCenter();
      viewRef.current = {
        center: { lat: center.lat, lon: center.lng },
        zoomLevel: instance.getZoom(),
        bearing: instance.getBearing(),
        pitch: instance.getPitch(),
      };
      if (shouldSaveView(event, configRef.current)) {
        context.saveState(viewRef.current);
      }
    });

    // Resizing clears the WebGL canvas; redraw in the same frame or the cleared (black)
    // canvas is painted until MapLibre's next render. Unthrottled, unlike MapLibre's own
    // observer (disabled via trackResize), so the map follows a panel drag every frame.
    const Observer = container.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(() => {
      instance.resize().redraw();
    });
    observer.observe(container);
    setMap(instance);
    return () => {
      observer.disconnect();
      instance.remove();
      setMap(undefined);
    };
  }, [configRef, context]);

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
      const unused = [...prev].filter(([url]) => !wanted.has(url));
      if (unused.length === 0) {
        return prev;
      }
      const next = new Map(prev);
      for (const [url, image] of unused) {
        URL.revokeObjectURL(image.url);
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
          setSourceErrors((prev) => new Map(prev).set(url, toError(error).message));
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
      const { sourceId } = event;
      if (
        event.dataType !== "source" ||
        !sourceId ||
        event.tile == undefined ||
        loaded.has(sourceId)
      ) {
        return;
      }
      loaded.add(sourceId);
      const url = urlOfSource(sourceId);
      rememberWorkingSource((id) => sourceId.startsWith(id));
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

  // Thin the track for the current view: redone after the map moves, not during.
  const [thinView, setThinView] = useState<ThinView>();
  useEffect(() => {
    if (!map) {
      return;
    }
    const update = () => {
      const b = map.getBounds();
      const bounds = {
        west: b.getWest(),
        east: b.getEast(),
        south: b.getSouth(),
        north: b.getNorth(),
      };
      const zoom = map.getZoom();
      // Keep the thinned track (and skip its upload) while it still covers the view.
      setThinView((prev) =>
        prev && thinViewCovers(prev, zoom, bounds) ? prev : thinViewFor(zoom, bounds),
      );
    };
    update();
    map.on("moveend", update);
    map.on("resize", update);
    return () => {
      map.off("moveend", update);
      map.off("resize", update);
    };
  }, [map]);

  const thinned = useMemo(() => {
    if (!thinView) {
      return [];
    }
    // Hidden histories take no share of the budget.
    const drawn = visibleTracks.filter(
      (store) => (config.topicStyles[store.topic]?.history ?? "points") !== "none",
    );
    const budget = TRACK_POINT_BUDGET / Math.max(1, drawn.length);
    return drawn.map((store) => {
      const style = config.topicStyles[store.topic] ?? {};
      const history = style.history ?? "points";
      // Points overlap heavily at half their radius apart; lines only need a pixel.
      const minPixels =
        history === "line" ? 1 : Math.max(1, (style.pointSize ?? DEFAULT_POINT_SIZE) / 2);
      return {
        store,
        style,
        version: store.version,
        length: store.length,
        tailReplacements: store.tailReplacements,
        ...thinTrack(store, { ...thinView, minPixels, budget }),
      };
    });
  }, [config.topicStyles, thinView, visibleTracks]);

  const drawnTracks = useMemo(
    () =>
      filterMap(thinned, (track): DrawnTrack | undefined => {
        const color = colors.get(track.store.topic);
        return color == undefined
          ? undefined
          : { ...track, color, colorScale: colorValues.get(track.store.topic) };
      }),
    [colorValues, colors, thinned],
  );
  // Tracks of the overlays sent to the map, by generation. Features the map still shows may be
  // from the previous one, so hovers resolve against the tracks their features were built from.
  const trackGenerations = useRef(new Map<number, readonly DrawnTrack[]>());
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    trackGenerations.current.set(generation, drawnTracks);
    trackGenerations.current.delete(generation - 2);
    const { points, lines } = trackFeatures(drawnTracks, generation);
    setOverlay(OVERLAY.track, points);
    setOverlay(OVERLAY.trackLine, lines);
  }, [drawnTracks, setOverlay]);

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
    let best: { store: TrackStore; index: number } | undefined;
    if (previewTime != undefined) {
      for (const store of visibleTracks) {
        const { time } = store.columns;
        const index = upperBound(time, 0, store.length, previewTime) - 1;
        if (index >= 0 && (!best || time[index]! > best.store.columns.time[best.index]!)) {
          best = { store, index };
        }
      }
    }
    const base = best ? colors.get(best.store.topic) : undefined;
    setOverlay(OVERLAY.preview, {
      type: "FeatureCollection",
      features:
        best && base
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: best.store.lngLat(best.index) },
                properties: {
                  c: darkColor(base),
                  r: config.topicStyles[best.store.topic]?.pointSize ?? DEFAULT_POINT_SIZE,
                },
              },
            ]
          : [],
    });
  }, [colors, config.topicStyles, previewTime, setOverlay, visibleTracks]);

  const setMeasureData = useCallback(
    (data: FeatureCollection) => {
      setOverlay(OVERLAY.measure, data);
    },
    [setOverlay],
  );

  // --- Camera -----------------------------------------------------------------------------

  const dataBounds = useCallback((): LngLatBounds | undefined => {
    const bounds = new LngLatBounds();
    for (const store of visibleTracksRef.current) {
      const { lon, lat } = store.columns;
      for (let i = 0; i < store.length; i++) {
        bounds.extend([lon[i]!, lat[i]!]);
      }
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
  }, [currentRef, visibleTracksRef]);

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
  const dataSize =
    _.sumBy(visibleTracks, (store) => store.length) + currentMessages.length + geoMessages.length;
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
    // Smooth follow glides during normal playback, which redraws the map on every display frame;
    // otherwise jump, redrawing only when a new position arrives. Seeks and big moves always jump.
    if (config.smoothFollow && map.getBounds().contains(center)) {
      map.easeTo(
        {
          ...options,
          duration: 200,
          easing: (t) => t,
          essential: true,
        },
        FOLLOW_MOVE_EVENT,
      );
    } else {
      map.jumpTo(options, FOLLOW_MOVE_EVENT);
    }
  }, [config.followMode, config.followTopic, config.smoothFollow, currentNav, headings, map]);

  // --- Hover and click --------------------------------------------------------------------

  useEffect(() => {
    if (!map) {
      return;
    }
    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      // Hover must not take focus from wherever the user is typing.
      focusAfterOpen: false,
      offset: 10,
      maxWidth: "280px",
    });
    // What the popup shows; `pinned` once a click on a stack made its rows clickable.
    let hovered: readonly Hit[] = [];
    let pinned = false;

    const pick = (event: MapMouseEvent): Hit[][] => {
      // Most specific first: a track point inside a GeoJSON area should win over the area.
      const priority: string[] = [
        ...INTERACTIVE_LAYERS.current,
        INTERACTIVE_LAYERS.track,
        ...INTERACTIVE_LAYERS.geojson.slice().reverse(),
      ];
      const layers = priority.filter((id) => map.getLayer(id) != undefined);
      // A few pixels of slack makes small points easy to hover.
      const { x, y } = event.point;
      const features = map.queryRenderedFeatures(
        [
          [x - 4, y - 4],
          [x + 4, y + 4],
        ],
        { layers },
      );
      const sorted = _.sortBy(features, (feature) => priority.indexOf(feature.layer.id));
      // A pixel in Web Mercator units, for the fixes a drawn track point stands for.
      const at = MercatorCoordinate.fromLngLat(event.lngLat);
      const edge = MercatorCoordinate.fromLngLat(map.unproject([x + 1, y]));
      const pixel = Math.hypot(edge.x - at.x, edge.y - at.y);
      // Drawn points of a track stand for overlapping runs of fixes: merged into passes below.
      const stacks = new Map<DrawnTrack, { runs: [number, number][]; nearest: number[] }>();
      const hits: Hit[] = [];
      for (const feature of sorted) {
        const index: unknown = feature.properties.i;
        if (typeof index !== "number") {
          continue;
        }
        if (feature.layer.id === INTERACTIVE_LAYERS.track) {
          const generation: unknown = feature.properties.g;
          const { k } = feature.properties;
          const generationTracks =
            typeof generation === "number" ? trackGenerations.current.get(generation) : undefined;
          const drawn = typeof k === "number" ? generationTracks?.[k] : undefined;
          // Another point of a stop already found it, end to end (a parked receiver): skip the scan.
          if (
            drawn &&
            stacks.get(drawn)?.runs.some(([a, b]) => a <= index && index <= b) === true
          ) {
            continue;
          }
          const size: unknown = feature.properties.r;
          const found = resolveTrackFix(
            generationTracks,
            k,
            index,
            [event.lngLat.lng, event.lngLat.lat],
            // Hit where its drawn circle meets the slack box: the box's corners plus the circle.
            pixel * (6 + (typeof size === "number" ? size : 0)),
          );
          if (found) {
            const stack = stacks.get(found.track) ?? { runs: [], nearest: [] };
            pushAll(stack.runs, found.runs);
            stack.nearest.push(found.fix);
            stacks.set(found.track, stack);
          }
        } else {
          const hit = toHit(feature, index);
          if (hit) {
            hits.push(hit);
          }
        }
      }
      const passes = [...stacks].flatMap(([track, stack]) =>
        fixPasses(stack.runs, stack.nearest).map((pass) => ({ track, pass })),
      );
      // By topic: features of one layer come in no particular order, and the list shouldn't jump.
      const trackHits = _.sortBy(
        passes.map(({ track, pass }) => trackHit(track, pass)),
        (hit) => hit.message.topic,
      );
      // A current marker is the newest fix of its track: the pass holding it lists it already.
      const listed = ({ message }: Hit) => {
        const t = toSec(message.receiveTime);
        return passes.some(({ track: { store }, pass }) => {
          const { time } = store.columns;
          return store.topic === message.topic && time[pass.first]! <= t && t <= time[pass.last]!;
        });
      };
      // Hits other than track ones are current markers, then GeoJSON features (by priority).
      const [current, geo] = _.partition(
        _.sortBy(hits, (hit) => hit.message.topic),
        (hit) => hit.kind === "nav",
      );
      return groupHitsByTopic([...current.filter((hit) => !listed(hit)), ...trackHits, ...geo]);
    };

    const trackHit = (
      track: DrawnTrack,
      { fix, first, last }: { fix: number; first: number; last: number },
    ): NavHit => {
      const { store, colorScale: colored } = track;
      const value = colored?.values[fix];
      const stop = stopAt(store, first, last);
      return {
        kind: "nav",
        // The fix, not the overlay: the popup and preview time stay put across redraws. A stop by
        // where it starts, which doesn't change as the cursor moves over it.
        id: trackFixKey(store, stop ? first : fix),
        message: store.message(fix),
        value:
          colored && value != undefined && isFinite(value)
            ? `${Number(value.toPrecision(4))}${colored.unit}`
            : undefined,
        stop,
      };
    };

    const toHit = (feature: MapGeoJSONFeature, index: number): Hit | undefined => {
      if ((INTERACTIVE_LAYERS.current as readonly string[]).includes(feature.layer.id)) {
        const message = currentRef.current[index];
        return message ? { kind: "nav", id: message, message } : undefined;
      }
      const message = geoRef.current[index];
      const name: unknown = feature.properties.name;
      return message
        ? {
            kind: "geojson",
            id: message,
            message,
            name: typeof name === "string" && name ? name : undefined,
          }
        : undefined;
    };

    const clear = () => {
      if (hovered.length > 0) {
        hovered = [];
        pinned = false;
        popup.removeClassName("pinned");
        popup.remove();
        map.getCanvas().style.cursor = "";
        context.setPreviewTime(undefined);
      }
    };

    const show = (groups: readonly Hit[][], at: MapMouseEvent["lngLat"]) => {
      const hits = groups.flat();
      popup.setLngLat(at);
      // Same hits as shown: keep the DOM, so the popup doesn't flicker as the cursor moves.
      if (hits.length === hovered.length && hits.every((hit, i) => hit.id === hovered[i]!.id)) {
        return;
      }
      hovered = hits;
      const content =
        hits.length === 1
          ? hitContent(hits[0]!)
          : hitsContent(groups, (message) => context.seekPlayback?.(message.receiveTime));
      popup.setDOMContent(content).addTo(map);
      context.setPreviewTime(eventTimeSec(startOf(hits[0]!)));
    };

    const onMove = (event: MapMouseEvent) => {
      if (measuringRef.current) {
        clear();
        return;
      }
      if (pinned) {
        return;
      }
      const groups = pick(event);
      if (groups.length === 0) {
        clear();
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      show(groups, event.lngLat);
    };
    const onClick = (event: MapMouseEvent) => {
      if (measuringRef.current) {
        return;
      }
      // Rows of a pinned popup handle their own clicks.
      if (
        event.originalEvent.target instanceof Node &&
        popup.isOpen() &&
        popup.getElement().contains(event.originalEvent.target)
      ) {
        return;
      }
      if (pinned) {
        clear();
      }
      const groups = pick(event);
      const hits = groups.flat();
      if (hits.length === 1) {
        context.seekPlayback?.(startOf(hits[0]!).receiveTime);
      } else if (hits.length > 1) {
        // A stack: keep its list open so a row can be picked.
        show(groups, event.lngLat);
        pinned = true;
        popup.addClassName("pinned");
      }
    };
    // Leaving the canvas into a pinned popup keeps it.
    const onLeave = () => {
      if (!pinned) {
        clear();
      }
    };

    map.on("mousemove", onMove);
    map.on("click", onClick);
    map.getCanvas().addEventListener("mouseleave", onLeave);
    return () => {
      map.off("mousemove", onMove);
      map.off("click", onClick);
      map.getCanvas().removeEventListener("mouseleave", onLeave);
      popup.remove();
    };
  }, [context, currentRef, geoRef, map]);

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
            bottomLeft={legends.length > 0 ? <ColorLegends legends={legends} /> : undefined}
          />
        )}
        {eligibleTopics.length === 0 && (
          <MapNotice>No NavSatFix, LocationFix(es), or GeoJSON topics</MapNotice>
        )}
      </MapFrame>
    </ThemeProvider>
  );
}

export default MapPanel;
