// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button, Typography } from "@mui/material";
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

import { Immutable, PanelExtensionContext, SettingsTreeAction, Topic } from "@lichtblick/suite";
import { useElementSize } from "@lichtblick/suite-base/hooks/useElementSize";
import { fontMonospace } from "@lichtblick/theme";

import { GridRenderer } from "./GridRenderer";
import { annotationTopicNames, tileAnnotationTopics } from "./annotations";
import { autoColumns, imageKind, imageTopicNames } from "./layout";
import { addAllTopics, buildSettingsTree, settingsReducer } from "./settings";
import { CameraGridConfig, DEFAULT_CONFIG, TileConfig } from "./types";

const DEFAULT_ASPECT = 4 / 3;

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
    gap: 2,
  },
  tile: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: "#000",
    cursor: "zoom-in",
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
    color: "rgba(255, 255, 255, 0.6)",
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

function Tile({
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

  return (
    <div
      ref={tileElementRef}
      className={cx(classes.tile, { [classes.maximized]: maximized })}
      onDoubleClick={() => {
        // Double-click first resets a zoomed tile, then maximizes it.
        if (!renderer.resetView(tile.topic)) {
          onToggleMaximize(tile.topic);
        }
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

export function CameraGrid({ context }: { context: PanelExtensionContext }): React.JSX.Element {
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
  // One line per tile: its image topic, then its annotation topics, tab-separated. A string, so
  // unrelated config changes (rotation, labels) don't resubscribe.
  const subscribedKey = visibleTiles
    .map((tile) => [tile.topic, ...tileAnnotationTopics(tile, annotationTopics)].join("\t"))
    .join("\n");
  // Video decoding needs every frame since the last keyframe, so only still images are sampled.
  const videoTopicsKey = (topics ?? [])
    .filter((topic) => imageKind(topic.schemaName) === "video")
    .map((topic) => topic.name)
    .join("\n");

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
    const lines = subscribedKey === "" ? [] : subscribedKey.split("\n");
    const annotationsByTile = new Map(
      lines.map((line) => {
        const [topic = "", ...annotations] = line.split("\t");
        return [topic, annotations];
      }),
    );
    const subscribed = [...annotationsByTile.keys()];
    const videoTopics = new Set(videoTopicsKey.split("\n"));
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
  }, [context, renderer, subscribedKey, videoTopicsKey]);

  useEffect(() => {
    renderer.setOptions({ linkZoom: config.linkZoom, syncAnnotations: config.syncAnnotations });
  }, [renderer, config.linkZoom, config.syncAnnotations]);

  useEffect(() => {
    context.saveState(config);
  }, [context, config]);

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
        if (event.key === "Escape") {
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
