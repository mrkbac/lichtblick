// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button, Typography, alpha } from "@mui/material";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { useDeepMemo } from "@lichtblick/hooks";
import { Immutable, SettingsTreeAction, Topic } from "@lichtblick/suite";
import { BuiltinPanelExtensionContext } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { useElementSize } from "@lichtblick/suite-base/hooks/useElementSize";
import { addTopicsDrop } from "@lichtblick/suite-base/panels/shared/pathDrop";
import { findShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { fontMonospace } from "@lichtblick/theme";

import { GridRenderer } from "./GridRenderer";
import { annotationTopicNames, tileAnnotationTopics } from "./annotations";
import { autoColumns, imageKind, imageTopicNames } from "./layout";
import { addAllTopics, buildSettingsTree, settingsReducer } from "./settings";
import { CAMERA_GRID_SHORTCUTS } from "./shortcuts";
import { CameraGridConfig, DEFAULT_CONFIG, TileConfig } from "./types";

const DEFAULT_ASPECT = 4 / 3;

/** Zoom per +/- key press, and pan per arrow key press in CSS pixels. */
const KEY_ZOOM_FACTOR = 1.25;
const KEY_PAN_PX = 40;
const KEY_PAN_DIRECTIONS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Wheel zoom per pixel of scroll (and per line, for mice that scroll by lines). */
const ZOOM_PER_PIXEL = 0.002;
const ZOOM_PER_LINE = 0.05;

const useStyles = makeStyles()((theme) => ({
  root: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    outline: "none",
    backgroundColor: theme.palette.background.default,
  },
  grid: {
    display: "grid",
    width: "100%",
    height: "100%",
    gap: 1,
  },
  tile: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: theme.palette.background.default,
    // Outlines of neighbouring tiles meet in the 1px gap as a single divider line.
    outline: `1px solid ${theme.palette.divider}`,
    cursor: "zoom-in",
    "&:focus-visible": {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: -2,
      zIndex: 1,
    },
  },
  maximized: {
    cursor: "zoom-out",
  },
  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },
  label: {
    position: "absolute",
    top: 4,
    left: 4,
    maxWidth: "calc(100% - 8px)",
    display: "flex",
    gap: theme.spacing(1),
    padding: theme.spacing(0.25, 0.75),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    color: "#fff",
    fontSize: theme.typography.caption.fontSize,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    pointerEvents: "none",
    "&[hidden]": { display: "none" },
  },
  timestamp: {
    fontFamily: fontMonospace,
    opacity: 0.8,
  },
  status: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing(1),
    textAlign: "center",
    color: theme.palette.text.secondary,
    // Invisible on an empty tile; dims a frame left under an error so the text stays legible.
    backgroundColor: alpha(theme.palette.background.default, 0.75),
    fontSize: theme.typography.caption.fontSize,
    pointerEvents: "none",
    "&[hidden]": { display: "none" },
  },
  empty: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(1),
    padding: theme.spacing(2),
    textAlign: "center",
  },
}));

type TileProps = {
  tile: TileConfig;
  renderer: GridRenderer;
  showLabels: boolean;
  showTimestamps: boolean;
  maximized: boolean;
  onToggleMaximize: (topic: string) => void;
};

export function Tile({
  tile,
  renderer,
  showLabels,
  showTimestamps,
  maximized,
  onToggleMaximize,
}: TileProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileElementRef = useRef<HTMLDivElement>(null);
  const timestampRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef(tile);
  tileRef.current = tile;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const timestamp = timestampRef.current;
    const status = statusRef.current;
    if (!canvas || !timestamp || !status) {
      return;
    }
    renderer.attach(tile.topic, { canvas, timestamp, status }, tileRef.current);
    return () => {
      renderer.detach(tile.topic);
    };
  }, [renderer, tile.topic]);

  useEffect(() => {
    renderer.setTileConfig(tile);
  }, [renderer, tile]);

  // React's wheel listener is passive, so it can't stop the page from scrolling.
  useEffect(() => {
    const element = tileElementRef.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const perUnit =
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? ZOOM_PER_PIXEL : ZOOM_PER_LINE;
      renderer.zoomAt(tile.topic, Math.exp(-event.deltaY * perUnit), event.offsetX, event.offsetY);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [renderer, tile.topic]);

  const dragRef = useRef<{ x: number; y: number } | undefined>(undefined);

  // Double-click or Enter first resets a zoomed tile, then maximizes it.
  const resetOrMaximize = () => {
    if (!renderer.resetView(tile.topic)) {
      onToggleMaximize(tile.topic);
    }
  };

  return (
    <div
      ref={tileElementRef}
      className={cx(classes.tile, { [classes.maximized]: maximized })}
      role="button"
      tabIndex={0}
      aria-label={tile.topic}
      aria-pressed={maximized}
      aria-keyshortcuts="Enter + - ArrowLeft ArrowRight ArrowUp ArrowDown"
      onDoubleClick={resetOrMaximize}
      onKeyDown={(event) => {
        const element = event.currentTarget;
        const centerX = element.clientWidth / 2;
        const centerY = element.clientHeight / 2;
        switch (findShortcut(CAMERA_GRID_SHORTCUTS, event)?.id) {
          case "cameraGrid.resetOrMaximize":
            resetOrMaximize();
            break;
          case "cameraGrid.zoomIn":
            renderer.zoomAt(tile.topic, KEY_ZOOM_FACTOR, centerX, centerY);
            break;
          case "cameraGrid.zoomOut":
            renderer.zoomAt(tile.topic, 1 / KEY_ZOOM_FACTOR, centerX, centerY);
            break;
          case "cameraGrid.pan": {
            // Arrows move the view, so the image moves the other way
            const [dx, dy] = KEY_PAN_DIRECTIONS[event.key] ?? [0, 0];
            renderer.panBy(tile.topic, -dx * KEY_PAN_PX, -dy * KEY_PAN_PX);
            break;
          }
          default:
            return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (event.button === 0 && renderer.isZoomed(tile.topic)) {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag) {
          renderer.panBy(tile.topic, event.clientX - drag.x, event.clientY - drag.y);
          drag.x = event.clientX;
          drag.y = event.clientY;
        }
      }}
      onPointerUp={() => {
        dragRef.current = undefined;
      }}
      onPointerCancel={() => {
        dragRef.current = undefined;
      }}
    >
      <canvas ref={canvasRef} className={classes.canvas} />
      <div ref={statusRef} className={classes.status} />
      <div className={classes.label} hidden={!showLabels && !showTimestamps}>
        {showLabels && <span>{tile.topic}</span>}
        <span ref={timestampRef} className={classes.timestamp} hidden={!showTimestamps} />
      </div>
    </div>
  );
}

export function CameraGrid({
  context,
}: {
  context: BuiltinPanelExtensionContext;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("cameraGrid");
  const [config, setConfig] = useState<CameraGridConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(context.initialState as Partial<CameraGridConfig> | undefined),
  }));
  const [topics, setTopics] = useState<Immutable<Topic[]>>();
  const [maximizedTopic, setMaximizedTopic] = useState<string>();
  const [aspectVersion, bumpAspectVersion] = useReducer((n: number) => n + 1, 0);
  const [renderer] = useState(() => new GridRenderer(bumpAspectVersion, t("waitingForImages")));

  const imageTopics = useMemo(() => imageTopicNames(topics), [topics]);
  // "Add all" skips raw images: they can saturate the connection. They can still be added one by one.
  const addAllTopicNames = useMemo(() => imageTopicNames(topics, { includeRaw: false }), [topics]);
  const annotationTopics = useMemo(() => annotationTopicNames(topics), [topics]);
  const visibleTiles = useMemo(() => config.tiles.filter((tile) => tile.visible), [config.tiles]);
  // Per tile: its image topic, then its annotation topics. Deep-memoized so unrelated config
  // changes (rotation, labels) don't resubscribe.
  const subscribedTiles = useDeepMemo(
    visibleTiles.map((tile) => [tile.topic, ...tileAnnotationTopics(tile, annotationTopics)]),
  );
  // Video decoding needs every frame since the last keyframe, so only still images are sampled.
  const videoTopicNames = useDeepMemo(
    (topics ?? [])
      .filter((topic) => imageKind(topic.schemaName) === "video")
      .map((topic) => topic.name),
  );

  useEffect(() => {
    return () => {
      renderer.dispose();
    };
  }, [renderer]);

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setTopics(renderState.topics);
      if (renderState.didSeek === true) {
        renderer.seek();
      }
      if (renderState.currentFrame) {
        renderer.setFrame(renderState.currentFrame);
      }
      // Decoding is asynchronous and drops stale frames, so it never holds up playback.
      done();
    };
    context.watch("topics");
    context.watch("currentFrame");
    context.watch("didSeek");
    return () => {
      context.onRender = undefined;
    };
  }, [context, renderer]);

  useEffect(() => {
    const annotationsByTile = new Map(
      subscribedTiles.map(([topic = "", ...annotations]) => [topic, annotations]),
    );
    const subscribed = [...annotationsByTile.keys()];
    const videoTopics = new Set(videoTopicNames);
    renderer.setTopics(subscribed, annotationsByTile);
    // Annotations are small and unsampled, so syncing can find the one stamped like the image.
    const annotations = new Set([...annotationsByTile.values()].flat());
    context.subscribe([
      ...subscribed.map((topic) =>
        videoTopics.has(topic)
          ? { topic }
          : { topic, sampling: { mode: "latest-per-render-tick" as const } },
      ),
      ...[...annotations].map((topic) => ({ topic })),
    ]);
  }, [context, renderer, subscribedTiles, videoTopicNames]);

  useEffect(() => {
    renderer.setOptions({ linkZoom: config.linkZoom, syncAnnotations: config.syncAnnotations });
  }, [renderer, config.linkZoom, config.syncAnnotations]);

  useEffect(() => {
    context.saveState(config);
  }, [context, config]);

  // Drop image topics from the topic list to add a tile for each, or show a hidden one again
  useEffect(() => {
    context.unstable_setMessagePathDropConfig(
      addTopicsDrop(
        (item) => item.rootSchemaName != undefined && imageKind(item.rootSchemaName) != undefined,
        (dropped) => {
          setConfig((prev) => {
            const added = addAllTopics(prev, dropped);
            return {
              ...added,
              tiles: added.tiles.map((tile) =>
                dropped.includes(tile.topic) ? { ...tile, visible: true } : tile,
              ),
            };
          });
        },
      ),
    );
  }, [context]);

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      setConfig((prev) => settingsReducer(prev, action, addAllTopicNames, annotationTopics));
    },
    [addAllTopicNames, annotationTopics],
  );

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler,
      nodes: buildSettingsTree(config, imageTopics, annotationTopics, t),
    });
  }, [context, actionHandler, config, imageTopics, annotationTopics, t]);

  const maximizedTile = visibleTiles.find((tile) => tile.topic === maximizedTopic);
  const shownTiles = useMemo(
    () => (maximizedTile ? [maximizedTile] : visibleTiles),
    [maximizedTile, visibleTiles],
  );

  const { width = 0, height = 0, ref: gridRef } = useElementSize<HTMLDivElement>();

  const aspect = useMemo(() => {
    void aspectVersion; // recompute when the renderer reports new image sizes
    const aspects = shownTiles.flatMap((tile) => {
      const value = renderer.aspect(tile.topic);
      if (value == undefined) {
        return [];
      }
      return [tile.rotation === 90 || tile.rotation === 270 ? 1 / value : value];
    });
    return aspects.length > 0
      ? aspects.reduce((sum, value) => sum + value, 0) / aspects.length
      : DEFAULT_ASPECT;
  }, [aspectVersion, renderer, shownTiles]);

  const columns = Math.max(
    1,
    Math.min(
      shownTiles.length,
      config.columns ?? autoColumns(shownTiles.length, width, height, aspect),
    ),
  );
  const rows = Math.ceil(shownTiles.length / columns);

  const toggleMaximize = useCallback((topic: string) => {
    setMaximizedTopic((current) => (current === topic ? undefined : topic));
  }, []);

  if (visibleTiles.length === 0) {
    return (
      <div className={classes.root}>
        <div className={classes.empty}>
          {config.tiles.length > 0 ? (
            <Typography color="textSecondary">{t("allCamerasHidden")}</Typography>
          ) : imageTopics.length > 0 ? (
            <>
              <Typography color="textSecondary">{t("emptyIntro")}</Typography>
              {addAllTopicNames.length > 0 ? (
                <Button
                  variant="contained"
                  onClick={() => {
                    setConfig((prev) => addAllTopics(prev, addAllTopicNames));
                  }}
                >
                  {t("addAllImageTopicsCount", { count: addAllTopicNames.length })}
                </Button>
              ) : (
                <Typography color="textSecondary">{t("onlyRawImageTopics")}</Typography>
              )}
            </>
          ) : (
            <Typography color="textSecondary">{t("waitingForImageTopics")}</Typography>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={classes.root}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (findShortcut(CAMERA_GRID_SHORTCUTS, event)?.id === "cameraGrid.restore") {
          setMaximizedTopic(undefined);
        }
      }}
    >
      <div
        ref={gridRef}
        className={classes.grid}
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {shownTiles.map((tile) => (
          <Tile
            key={tile.topic}
            tile={tile}
            renderer={renderer}
            showLabels={config.showLabels}
            showTimestamps={config.showTimestamps}
            maximized={maximizedTile != undefined}
            onToggleMaximize={toggleMaximize}
          />
        ))}
      </div>
    </div>
  );
}
