// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import SearchIcon from "@mui/icons-material/Search";
import {
  Dialog,
  Divider,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { create } from "zustand";

import Logger from "@lichtblick/log";
import { HighlightChars } from "@lichtblick/suite-base/components/HighlightChars";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import { APP_SHORTCUTS } from "@lichtblick/suite-base/components/KeyboardShortcuts/appShortcuts";
import { shortcutKeyHandlers } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { customTypography } from "@lichtblick/theme";

import {
  Command,
  RankedCommand,
  initialPaletteState,
  loadRecentCommandIds,
  paletteReducer,
  pushRecentCommandId,
  rankCommands,
  useCommandRegistry,
} from "./commands";
import { useAppCommands } from "./useAppCommands";

const log = Logger.getLogger(__filename);

const LISTBOX_ID = "command-palette-listbox";
const optionId = (index: number) => `command-palette-option-${index}`;

const useStyles = makeStyles()((theme) => ({
  paper: {
    alignSelf: "flex-start",
    marginTop: "12vh",
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    padding: theme.spacing(1, 1.5),
  },
  crumb: {
    whiteSpace: "nowrap",
    padding: theme.spacing(0.25, 1),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.selected,
  },
  input: { flex: 1, fontSize: theme.typography.body1.fontSize },
  list: { overflowY: "auto", padding: theme.spacing(0.5, 0) },
  item: { gap: theme.spacing(1.5), paddingBlock: theme.spacing(0.5) },
  text: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  side: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    flexShrink: 0,
    color: theme.palette.text.secondary,
  },
  kbd: {
    fontFamily: customTypography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    padding: theme.spacing(0, 0.75),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
  footer: {
    display: "flex",
    gap: theme.spacing(2),
    padding: theme.spacing(0.75, 1.5),
    color: theme.palette.text.secondary,
  },
  empty: { padding: theme.spacing(2), color: theme.palette.text.secondary },
}));

/** Whether the palette is open, so menus can open it too. */
export const useCommandPaletteStore = create<{
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}>()((set) => ({
  open: false,
  show: () => {
    set({ open: true });
  },
  hide: () => {
    set({ open: false });
  },
  toggle: () => {
    set((state) => ({ open: !state.open }));
  },
}));

/** Mounts the Cmd/Ctrl+K shortcut; the palette itself only renders while open. */
export function CommandPalette(): React.JSX.Element {
  const open = useCommandPaletteStore((state) => state.open);
  const toggle = useCommandPaletteStore((state) => state.toggle);
  const close = useCommandPaletteStore((state) => state.hide);
  const keyDownHandlers = useMemo(
    () => shortcutKeyHandlers(APP_SHORTCUTS, { "app.commandPalette": toggle }),
    [toggle],
  );
  return (
    <>
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      {open && <CommandPaletteDialog onClose={close} />}
    </>
  );
}

/** The open palette: search input, ranked results and sub-menu breadcrumbs. */
function CommandPaletteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("commandPalette");
  const { commands: appCommands, queryCommands } = useAppCommands();
  const contributions = useCommandRegistry((state) => state.contributions);
  const [recentIds, setRecentIds] = useState(loadRecentCommandIds);
  const [state, dispatch] = useReducer(paletteReducer, initialPaletteState);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const level = state.stack[state.stack.length - 1]!;
  const isRoot = state.stack.length === 1;

  const rootCommands = useMemo(
    () => [...appCommands, ...Array.from(contributions.values()).flat()],
    [appCommands, contributions],
  );

  const results: RankedCommand[] = useMemo(() => {
    const ranked = rankCommands(level.items ?? rootCommands, level.query, recentIds);
    if (!isRoot) {
      return ranked;
    }
    const fromQuery = queryCommands(level.query).map((command) => ({
      command,
      positions: new Set<number>(),
    }));
    return [...fromQuery, ...ranked];
  }, [isRoot, level.items, level.query, queryCommands, recentIds, rootCommands]);

  const selectedIndex = Math.min(level.selectedIndex, results.length - 1);

  useEffect(() => {
    listRef.current?.children[selectedIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [selectedIndex]);

  const execute = useCallback(
    async (command: Command) => {
      if (loading) {
        return;
      }
      if (command.children) {
        setLoading(true);
        try {
          dispatch({
            type: "push",
            parent: command,
            items: await command.children(),
          });
        } catch (err: unknown) {
          log.error(err);
        } finally {
          setLoading(false);
        }
        return;
      }
      // Remember the whole path so the sub-menu entry also ranks higher next time.
      let recent = recentIds;
      for (const parent of state.stack) {
        if (parent.parent) {
          recent = pushRecentCommandId(recent, parent.parent.id);
        }
      }
      setRecentIds(pushRecentCommandId(recent, command.id));
      // Close first so commands that open dialogs or file pickers get focus.
      onClose();
      try {
        command.run();
      } catch (err: unknown) {
        log.error(err);
      }
    },
    [loading, onClose, recentIds, state.stack],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const selected = results[selectedIndex];
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        dispatch({
          type: "move",
          delta: event.key === "ArrowDown" ? 1 : -1,
          count: results.length,
        });
        break;
      case "Enter":
        event.preventDefault();
        if (selected) {
          void execute(selected.command);
        }
        break;
      case "Escape":
        if (!isRoot) {
          event.preventDefault();
          event.stopPropagation();
          dispatch({ type: "pop" });
        }
        break;
      case "Backspace":
        if (!isRoot && level.query === "") {
          event.preventDefault();
          dispatch({ type: "pop" });
        }
        break;
      case "k":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          onClose();
        }
        break;
    }
  };

  const placeholder = level.parent?.children ? level.parent.placeholder : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      classes={{ paper: classes.paper }}
      // The Paper carries role="dialog", so it needs the accessible name.
      slotProps={{ paper: { "aria-label": t("title") } }}
    >
      <div className={classes.header}>
        {isRoot ? (
          <SearchIcon fontSize="small" color="disabled" />
        ) : (
          <>
            <IconButton
              size="small"
              aria-label={t("back")}
              onClick={() => {
                dispatch({ type: "pop" });
              }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            {state.stack.slice(1).map((crumb) => (
              <Typography key={crumb.parent?.id} variant="body2" className={classes.crumb}>
                {crumb.parent?.title.replace(/…$/, "")}
              </Typography>
            ))}
          </>
        )}
        <InputBase
          autoFocus
          className={classes.input}
          placeholder={placeholder ?? t("placeholder")}
          value={level.query}
          onChange={(event) => {
            dispatch({ type: "set-query", query: event.target.value });
          }}
          onKeyDown={onKeyDown}
          inputProps={{
            role: "combobox",
            "aria-expanded": true,
            "aria-controls": LISTBOX_ID,
            "aria-activedescendant": selectedIndex >= 0 ? optionId(selectedIndex) : undefined,
            spellCheck: false,
          }}
        />
      </div>
      <Divider />
      {results.length === 0 ? (
        <Typography className={classes.empty} variant="body2">
          {loading ? t("loading") : t("noResults")}
        </Typography>
      ) : (
        <List dense id={LISTBOX_ID} role="listbox" ref={listRef} className={classes.list}>
          {results.map(({ command, positions }, index) => (
            <ListItemButton
              key={command.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              selected={index === selectedIndex}
              className={classes.item}
              onMouseMove={() => {
                if (index !== selectedIndex) {
                  dispatch({ type: "select", index });
                }
              }}
              onClick={() => {
                void execute(command);
              }}
            >
              <div className={classes.text}>
                <Typography variant="body2" noWrap>
                  <HighlightChars str={command.title} indices={positions} />
                </Typography>
                {command.detail != undefined && (
                  <Typography variant="caption" noWrap color="textSecondary">
                    {command.detail}
                  </Typography>
                )}
              </div>
              <div className={classes.side}>
                {command.group != undefined && (
                  <Typography variant="caption">{command.group}</Typography>
                )}
                {command.shortcut != undefined && (
                  <kbd className={classes.kbd}>{command.shortcut}</kbd>
                )}
                {command.children && <ChevronRightIcon fontSize="small" />}
              </div>
            </ListItemButton>
          ))}
        </List>
      )}
      <Divider />
      <div className={classes.footer}>
        <Typography variant="caption">↑↓ {t("hintNavigate")}</Typography>
        <Typography variant="caption">↵ {t("hintRun")}</Typography>
        {!isRoot && <Typography variant="caption">⌫ {t("hintBack")}</Typography>}
        <Typography variant="caption">esc {isRoot ? t("hintClose") : t("hintBack")}</Typography>
      </div>
    </Dialog>
  );
}
