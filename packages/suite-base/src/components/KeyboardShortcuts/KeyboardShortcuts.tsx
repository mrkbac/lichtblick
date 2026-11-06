// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Dialog, DialogContent, DialogTitle, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { create } from "zustand";

import { LAYOUT_SHORTCUTS } from "@lichtblick/suite-base/components/CommandPalette/layoutShortcuts";
import KeyListener from "@lichtblick/suite-base/components/KeyListener";
import {
  LayoutState,
  useCurrentLayoutSelector,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import {
  filterShortcutGroups,
  KeyboardShortcutTitleKey,
  panelShortcutGroups,
  ShortcutGroup,
  shortcutKeyHandlers,
  shortcutRows,
} from "@lichtblick/suite-base/util/keyboardShortcuts";
import { getPanelIds } from "@lichtblick/suite-base/util/layoutTree";
import { customTypography } from "@lichtblick/theme";

import { APP_SHORTCUTS, PLAYBACK_SHORTCUTS } from "./appShortcuts";

/** Whether the shortcut overlay is open, so menus and the command palette can open it too. */
export const useKeyboardShortcutsStore = create<{
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

const useStyles = makeStyles()((theme) => ({
  paper: { alignSelf: "flex-start", marginTop: "10vh", maxHeight: "80vh" },
  groups: {
    columnWidth: 320,
    columnGap: theme.spacing(4),
    paddingTop: theme.spacing(1),
  },
  group: { breakInside: "avoid", marginBottom: theme.spacing(2) },
  empty: { paddingTop: theme.spacing(2) },
  row: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing(2),
    padding: theme.spacing(0.25, 0),
  },
  keys: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: theme.spacing(0.5) },
  kbd: {
    fontFamily: customTypography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    whiteSpace: "nowrap",
    padding: theme.spacing(0, 0.75),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
}));

const selectLayout = (state: LayoutState) => state.selectedLayout?.data?.layout;

/** Mounts the `?` shortcut; the overlay itself only renders while open. */
export function KeyboardShortcuts(): React.JSX.Element {
  const open = useKeyboardShortcutsStore((state) => state.open);
  const toggle = useKeyboardShortcutsStore((state) => state.toggle);
  const hide = useKeyboardShortcutsStore((state) => state.hide);
  const keyDownHandlers = useMemo(
    () => shortcutKeyHandlers(APP_SHORTCUTS, { "app.showShortcuts": toggle }),
    [toggle],
  );
  return (
    <>
      <KeyListener global keyDownHandlers={keyDownHandlers} />
      {open && <KeyboardShortcutsDialog onClose={hide} />}
    </>
  );
}

function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("keyboardShortcuts");
  const { t: tCommands } = useTranslation("commandPalette");
  const [query, setQuery] = useState("");
  const layout = useCurrentLayoutSelector(selectLayout);
  const { selectedPanelIds } = useSelectedPanels();
  const panelCatalog = usePanelCatalog();

  const groups = useMemo((): ShortcutGroup[] => {
    const translate = (key: KeyboardShortcutTitleKey) => t(key);
    const layoutRows = LAYOUT_SHORTCUTS.flatMap((s) => {
      const label = s.shortcut();
      return label != undefined ? [{ id: s.id, title: tCommands(s.titleKey), keys: [label] }] : [];
    });
    return [
      { id: "app", title: t("groupApp"), rows: shortcutRows(APP_SHORTCUTS, translate) },
      {
        id: "playback",
        title: t("groupPlayback"),
        rows: shortcutRows(PLAYBACK_SHORTCUTS, translate),
      },
      { id: "layout", title: t("groupLayout"), rows: layoutRows },
      // Selected panels first, then the rest of the layout
      ...panelShortcutGroups(
        [...selectedPanelIds, ...getPanelIds(layout)],
        (type) => panelCatalog.getPanelByType(type),
        translate,
      ),
    ];
  }, [layout, panelCatalog, selectedPanelIds, t, tCommands]);

  const visible = useMemo(() => filterShortcutGroups(groups, query), [groups, query]);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      classes={{ paper: classes.paper }}
      aria-labelledby="keyboard-shortcuts-title"
    >
      <DialogTitle id="keyboard-shortcuts-title">{t("title")}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          type="search"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          slotProps={{ htmlInput: { "aria-label": t("searchPlaceholder"), spellCheck: false } }}
        />
        {visible.length === 0 ? (
          <Typography variant="body2" color="text.secondary" className={classes.empty}>
            {t("noResults")}
          </Typography>
        ) : (
          <div className={classes.groups}>
            {visible.map((group) => (
              <section key={group.id} className={classes.group} aria-label={group.title}>
                <Typography variant="overline" color="text.secondary" component="h3">
                  {group.title}
                </Typography>
                {group.rows.map((row) => (
                  <div key={row.id} className={classes.row}>
                    <Typography variant="body2">{row.title}</Typography>
                    <span className={classes.keys}>
                      {row.keys.map((key) => (
                        <kbd key={key} className={classes.kbd}>
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
