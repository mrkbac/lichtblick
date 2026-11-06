// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { toSec } from "@foxglove/rostime";
import AddIcon from "@mui/icons-material/Add";
import { IconButton, Tooltip } from "@mui/material";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useDeepMemo } from "@lichtblick/hooks";
import { SettingsTreeAction } from "@lichtblick/suite";
import { useDataSourceInfo, useMessageReducer } from "@lichtblick/suite-base/PanelAPI";
import MessagePathInput from "@lichtblick/suite-base/components/MessagePathSyntax/MessagePathInput";
import { messagePathStructures } from "@lichtblick/suite-base/components/MessagePathSyntax/messagePathsForDatatype";
import {
  MessagePipelineContext,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import useGlobalVariables from "@lichtblick/suite-base/hooks/useGlobalVariables";
import { openSiblingPlotPanel } from "@lichtblick/suite-base/panels/Plot/utils/openSiblingPlotPanel";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import clipboard from "@lichtblick/suite-base/util/clipboard";
import { enumValuesByDatatypeAndField } from "@lichtblick/suite-base/util/enums";

import { useStyles } from "./Watch.style";
import { Painters, RowAction, WatchRowView } from "./WatchRowView";
import { Playback, WatchStore, createPlaybackClock } from "./WatchStore";
import { compileRows, pathsForEnter, subscriptionsFor } from "./compile";
import { DEFAULT_CONFIG, WatchConfig, migrateConfig, newRow, parsePastedPaths } from "./config";
import { copyText } from "./format";
import { createFrameScheduler } from "./frameScheduler";
import {
  buildSettingsTree,
  duplicateRow,
  moveRow,
  replaceRowPaths,
  settingsReducer,
} from "./settings";

const AGE_TICK_MS = 250;

/** Playback inputs of the clock that ages values. */
function playbackOf(ctx: MessagePipelineContext): Playback {
  const data = ctx.playerState.activeData;
  return {
    current: data ? toSec(data.currentTime) : undefined,
    isPlaying: data?.isPlaying === true,
    speed: data?.speed ?? 1,
  };
}

type Props = {
  config: WatchConfig;
  saveConfig: SaveConfig<WatchConfig>;
};

function Watch({ config: rawConfig, saveConfig }: Props): React.JSX.Element {
  const config = useMemo(() => migrateConfig(rawConfig), [rawConfig]);
  const { rows, sparklines, flashChanges, showAge, staleAfterSec } = config;
  const { t } = useTranslation("watch");
  const { classes } = useStyles();
  const { enqueueSnackbar } = useSnackbar();
  const { openSiblingPanel, setMessagePathDropConfig } = usePanelContext();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { globalVariables } = useGlobalVariables();
  const { topics, datatypes } = useDataSourceInfo();

  /** Update the config from its migrated form, so edits never act on an invalid config. */
  const updateConfig = useCallback(
    (update: (prev: WatchConfig) => WatchConfig) => {
      saveConfig((prev) => update(migrateConfig(prev)));
    },
    [saveConfig],
  );

  const schema = useMemo(
    () => ({
      structures: messagePathStructures(datatypes),
      enumValues: enumValuesByDatatypeAndField(datatypes),
      schemaNames: new Map(topics.map((topic) => [topic.name, topic.schemaName ?? ""])),
    }),
    [datatypes, topics],
  );
  const { compiled, invalid, enumNames } = useMemo(
    () => compileRows(rows, globalVariables, schema),
    [globalVariables, rows, schema],
  );

  // Rows paint themselves from the store; batch them to one paint per animation frame
  const [store] = useState(() => new WatchStore());
  const [painters] = useState<Painters>(() => new Map());
  const [scheduler] = useState(() =>
    createFrameScheduler(() => {
      for (const id of store.takeDirty()) {
        painters.get(id)?.();
      }
    }),
  );
  const requestPaint = scheduler.request;
  useEffect(() => scheduler.cancel, [scheduler]);

  // Sparkline canvases size their backing store when painted, so repaint all rows on resize
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      for (const paint of painters.values()) {
        paint();
      }
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [painters]);

  // Age values against the playback time without re-rendering: repaint only the age badges
  const getPipeline = useMessagePipelineGetter();
  useEffect(() => {
    const clock = createPlaybackClock();
    const tick = () => {
      const now = clock(playbackOf(getPipeline()), performance.now() / 1000);
      if (now !== store.now) {
        store.now = now;
        for (const paint of painters.values()) {
          paint("age");
        }
      }
    };
    tick();
    const timer = setInterval(tick, AGE_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [getPipeline, painters, store]);

  useLayoutEffect(() => {
    store.setRows(compiled);
    requestPaint();
  }, [compiled, requestPaint, store]);

  // One subscription per topic. The reducer keeps returning the same store, so messages never
  // re-render the panel; `restore` without a previous state means a seek.
  const subscriptions = useDeepMemo(useMemo(() => subscriptionsFor(compiled), [compiled]));
  useMessageReducer<WatchStore>({
    topics: subscriptions,
    restore: useCallback(
      (prev?: WatchStore) => {
        if (!prev) {
          store.reset();
        }
        requestPaint();
        return store;
      },
      [requestPaint, store],
    ),
    addMessages: useCallback(
      (s: WatchStore, events: readonly MessageEvent[]) => {
        s.addMessages(events);
        requestPaint();
        return s;
      },
      [requestPaint],
    ),
  });

  const addPaths = useCallback(
    (paths: readonly string[]) => {
      if (paths.length > 0) {
        updateConfig((prev) => ({ ...prev, rows: [...prev.rows, ...paths.map(newRow)] }));
      }
    },
    [updateConfig],
  );

  // Settings sidebar
  const rowErrors = useMemo(
    () => new Map([...invalid].map((id) => [id, t("invalidPath")])),
    [invalid, t],
  );
  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      updateConfig((prev) => settingsReducer(prev, action));
    },
    [updateConfig],
  );
  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config, rowErrors, t),
    });
  }, [actionHandler, config, rowErrors, t, updatePanelSettingsTree]);

  // Drag fields from the topic list into the panel
  useEffect(() => {
    setMessagePathDropConfig({
      getDropStatus: () => ({ canDrop: true, effect: "add" }),
      handleDrop: (dragged) => {
        addPaths(dragged.map((item) => item.path));
      },
    });
  }, [addPaths, setMessagePathDropConfig]);

  // Edit a row's path in place; a duplicate opens its editor right away
  const [editingId, setEditingId] = useState<string | undefined>();
  const onEditDone = useCallback(
    (id: string, paths: string[] | undefined) => {
      setEditingId(undefined);
      if (paths) {
        updateConfig((prev) => ({ ...prev, rows: replaceRowPaths(prev.rows, id, paths) }));
      }
    },
    [updateConfig],
  );

  const onAction = useCallback(
    (action: RowAction, id: string) => {
      const row = rows.find((item) => item.id === id);
      if (!row) {
        return;
      }
      switch (action) {
        case "openInPlot":
          if (!invalid.has(id) && row.path !== "") {
            openSiblingPlotPanel(openSiblingPanel, row.path);
          }
          break;
        case "copy":
          void clipboard.copy(copyText(store.get(id)?.value)).then(() => {
            enqueueSnackbar(t("copied"), { variant: "success", autoHideDuration: 1000 });
          });
          break;
        case "edit":
          setEditingId(id);
          break;
        case "duplicate": {
          const copyId = newRow("").id;
          updateConfig((prev) => ({ ...prev, rows: duplicateRow(prev.rows, id, copyId) }));
          setEditingId(copyId);
          break;
        }
        case "remove":
          updateConfig((prev) => ({ ...prev, rows: prev.rows.filter((item) => item.id !== id) }));
          break;
      }
    },
    [enqueueSnackbar, invalid, openSiblingPanel, rows, store, t, updateConfig],
  );

  // Reorder by dragging rows
  const [dropTarget, setDropTarget] = useState<string | undefined>();
  const onDropRow = useCallback(
    (fromId: string, toId: string) => {
      setDropTarget(undefined);
      updateConfig((prev) => ({ ...prev, rows: moveRow(prev.rows, fromId, toId) }));
    },
    [updateConfig],
  );

  // Add rows: type a path and press Enter (Shift+Enter adds every field below it), or paste
  // several paths at once
  const [draft, setDraftState] = useState("");
  // Picking a suggestion with Enter updates the draft during that same key event
  const draftRef = useRef("");
  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);
  // The add button works like Enter
  const submitDraft = useCallback(() => {
    const paths = pathsForEnter(draftRef.current, { shiftKey: false, picked: false }, schema);
    if (paths) {
      addPaths(paths);
      setDraft("");
    }
  }, [addPaths, schema, setDraft]);
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Enter that confirms an IME composition is not a submit
      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }
      // A prevented Enter picked an autocomplete suggestion
      const paths = pathsForEnter(
        draftRef.current,
        { shiftKey: event.shiftKey, picked: event.defaultPrevented },
        schema,
      );
      if (paths) {
        event.preventDefault();
        addPaths(paths);
        setDraft("");
      }
    },
    [addPaths, schema, setDraft],
  );
  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      const paths = parsePastedPaths(event.clipboardData.getData("text"));
      const inInput = event.target instanceof HTMLInputElement;
      // Single paths pasted into the input are edited there as usual
      if (paths.length > 1 || (paths.length === 1 && !inInput)) {
        event.preventDefault();
        addPaths(paths);
        if (paths.length > 1) {
          enqueueSnackbar(t("addedRows", { count: paths.length }), { variant: "info" });
        }
      }
    },
    [addPaths, enqueueSnackbar, t],
  );

  return (
    <div
      ref={rootRef}
      className={classes.root}
      onPaste={onPaste}
      onDragEnd={() => {
        setDropTarget(undefined);
      }}
    >
      <PanelToolbar />
      <div className={classes.list}>
        {rows.length === 0 && (
          <div className={classes.empty}>
            <div>{t("emptyTitle")}</div>
            <div>{t("emptyHint")}</div>
          </div>
        )}
        {rows.map((row) => (
          <WatchRowView
            key={row.id}
            row={row}
            store={store}
            painters={painters}
            enumNames={enumNames.get(row.id)}
            invalid={invalid.has(row.id)}
            sparklines={sparklines}
            flashChanges={flashChanges}
            showAge={showAge}
            staleAfterSec={row.staleAfterSec ?? staleAfterSec}
            isDropTarget={dropTarget === row.id}
            editing={editingId === row.id}
            schema={schema}
            onEditDone={onEditDone}
            onAction={onAction}
            onDragOverRow={setDropTarget}
            onDropRow={onDropRow}
          />
        ))}
      </div>
      <div className={classes.addRow} onKeyDown={onKeyDown}>
        <div className={classes.addInput}>
          <MessagePathInput
            path={draft}
            onChange={setDraft}
            placeholder={t("addPlaceholder")}
            supportsMathModifiers
            supportsStreamModifiers
          />
        </div>
        <Tooltip title={t("add")}>
          <span>
            <IconButton size="small" disabled={draft.trim() === ""} onClick={submitDraft}>
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

Watch.panelType = "Watch";
Watch.defaultConfig = DEFAULT_CONFIG;

export default Panel(Watch);
