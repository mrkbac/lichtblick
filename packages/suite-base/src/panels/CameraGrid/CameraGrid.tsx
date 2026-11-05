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
import { autoColumns, imageTopicNames } from "./layout";
import { addAllTopics, buildSettingsTree, settingsReducer } from "./settings";
import { CameraGridConfig, DEFAULT_CONFIG, TileConfig } from "./types";

const DEFAULT_ASPECT = 4 / 3;

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

  return (
    <div
      className={cx(classes.tile, { [classes.maximized]: maximized })}
      onDoubleClick={() => {
        onToggleMaximize(tile.topic);
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
  const visibleTiles = useMemo(() => config.tiles.filter((tile) => tile.visible), [config.tiles]);
  const subscribedKey = visibleTiles.map((tile) => tile.topic).join("\n");

  useEffect(() => {
    return () => {
      renderer.dispose();
    };
  }, [renderer]);

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setTopics(renderState.topics);
      if (renderState.currentFrame) {
        renderer.setFrame(renderState.currentFrame);
      }
      // Decoding is asynchronous and drops stale frames, so it never holds up playback.
      done();
    };
    context.watch("topics");
    context.watch("currentFrame");
    return () => {
      context.onRender = undefined;
    };
  }, [context, renderer]);

  useEffect(() => {
    const subscribed = subscribedKey === "" ? [] : subscribedKey.split("\n");
    renderer.setTopics(subscribed);
    context.subscribe(
      subscribed.map((topic) => ({ topic, sampling: { mode: "latest-per-render-tick" as const } })),
    );
  }, [context, renderer, subscribedKey]);

  useEffect(() => {
    context.saveState(config);
  }, [context, config]);

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      setConfig((prev) => settingsReducer(prev, action, imageTopics));
    },
    [imageTopics],
  );

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler,
      nodes: buildSettingsTree(config, imageTopics, t),
    });
  }, [context, actionHandler, config, imageTopics, t]);

  const maximizedTile = visibleTiles.find((tile) => tile.topic === maximizedTopic);
  const shownTiles = useMemo(
    () => (maximizedTile ? [maximizedTile] : visibleTiles),
    [maximizedTile, visibleTiles],
  );

  const {
    width = 0,
    height = 0,
    ref: gridRef,
  } = useElementSize<HTMLDivElement>();

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
            <Typography color="text.secondary">{t("allCamerasHidden")}</Typography>
          ) : imageTopics.length > 0 ? (
            <>
              <Typography color="text.secondary">{t("emptyIntro")}</Typography>
              <Button
                variant="contained"
                onClick={() => {
                  setConfig((prev) => addAllTopics(prev, imageTopics));
                }}
              >
                {t("addAllImageTopicsCount", { count: imageTopics.length })}
              </Button>
            </>
          ) : (
            <Typography color="text.secondary">{t("waitingForImageTopics")}</Typography>
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
