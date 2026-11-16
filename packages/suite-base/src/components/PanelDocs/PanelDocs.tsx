// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CloseIcon from "@mui/icons-material/Close";
import {
  Chip,
  Dialog,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import type { TFunction } from "i18next";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { create } from "zustand";

import { useAsync } from "@lichtblick/hooks";
import { PanelInfo, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import { shortcutRows } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { customTypography } from "@lichtblick/theme";

/** One group of short facts, e.g. "Settings" or "Mouse". Each item is [term, explanation]. */
export type PanelDocsSection = {
  title: string;
  items: readonly (readonly [string, string])[];
};

/**
 * In-app documentation for a panel, shown in the panel guide (the ⓘ button in a panel's toolbar,
 * or the app menu). Lives next to the panel and loads lazily, so it can import the panel's own
 * schema constants and the list can't drift from what the panel reads.
 */
export type PanelDocs = {
  /** One short sentence: what the panel is for. */
  intro: string;
  /** Schemas the panel reads, from the panel's own constants. */
  schemas?: Iterable<string>;
  /** Short, high-value facts. Keyboard shortcuts come from the panel's `shortcuts`. */
  sections?: readonly PanelDocsSection[];
};

/**
 * Merges encoding variants of one schema (ROS 1/2 `pkg/msg/Name`, `ros.pkg.Name`, `foxglove::X`,
 * `foxglove_msgs/X`) into one display name, sorted.
 */
export function schemaDisplayNames(names: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const name of names) {
    out.add(
      name
        .replace("/msg/", "/")
        .replace(/^ros\.([^.]+)\.([^.]+)$/, "$1/$2")
        .replace(/^foxglove(?:::|_msgs\/)/, "foxglove."),
    );
  }
  return [...out].sort();
}

/** Whether the panel guide is open, and at which panel. */
export const usePanelGuideStore = create<{
  open: boolean;
  panelType: string | undefined;
  show: (panelType?: string) => void;
  hide: () => void;
}>()((set) => ({
  open: false,
  panelType: undefined,
  show: (panelType) => {
    set((state) => ({ open: true, panelType: panelType ?? state.panelType }));
  },
  hide: () => {
    set({ open: false });
  },
}));

type LoadedDocs = {
  info: PanelInfo;
  docs: PanelDocs;
  schemas: string[];
  /** Lower-cased text the search matches against. */
  haystack: string;
};

const useStyles = makeStyles()((theme) => ({
  paper: { height: "84vh", flexDirection: "row", overflow: "hidden" },
  nav: {
    width: 260,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${theme.palette.divider}`,
  },
  search: { padding: theme.spacing(2, 2, 1) },
  list: { overflowY: "auto", flex: 1 },
  subItem: { paddingLeft: theme.spacing(4) },
  main: { flex: 1, overflowY: "auto", padding: theme.spacing(2, 3, 3), position: "relative" },
  close: { position: "absolute", top: theme.spacing(1), right: theme.spacing(1) },
  intro: { margin: theme.spacing(1, 0, 2) },
  sections: { columnWidth: 340, columnGap: theme.spacing(4) },
  section: { breakInside: "avoid", marginBottom: theme.spacing(2) },
  chips: { display: "flex", flexWrap: "wrap", gap: theme.spacing(0.5) },
  chip: { fontFamily: customTypography.fontMonospace },
  rows: {
    display: "grid",
    gridTemplateColumns: "minmax(80px, max-content) 1fr",
    columnGap: theme.spacing(1.5),
    rowGap: theme.spacing(0.5),
  },
  term: { fontWeight: 600 },
  kbd: {
    fontFamily: customTypography.fontMonospace,
    fontSize: theme.typography.caption.fontSize,
    whiteSpace: "nowrap",
    padding: theme.spacing(0, 0.75),
    marginRight: theme.spacing(0.5),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
}));

function sectionId(panelType: string, title: string): string {
  return `panel-guide-${panelType}-${title}`.replace(/\W+/g, "-");
}

function Section(props: {
  id: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <section id={props.id} className={classes.section} aria-label={props.title}>
      <Typography variant="overline" color="text.secondary" component="h3">
        {props.title}
      </Typography>
      {props.children}
    </section>
  );
}

function PanelDocsView(props: { entry: LoadedDocs; words: string[] }): React.JSX.Element {
  const { entry, words } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const { t: tShortcuts } = useTranslation("keyboardShortcuts");
  const { info, docs, schemas } = entry;
  const shortcuts = shortcutRows(info.shortcuts ?? [], (key) => tShortcuts(key));
  const id = (title: string) => sectionId(info.type, title);
  return (
    <>
      <Typography variant="h4" component="h2" id="panel-guide-title">
        {info.title}
      </Typography>
      <Typography variant="body1" className={classes.intro}>
        {docs.intro}
      </Typography>
      <div className={classes.sections}>
        {schemas.length > 0 && (
          <Section id={id(t("supportedSchemas"))} title={t("supportedSchemas")}>
            <div className={classes.chips}>
              {schemas.map((schema) => (
                <Chip
                  key={schema}
                  size="small"
                  label={schema}
                  className={classes.chip}
                  color={
                    words.some((word) => schema.toLowerCase().includes(word))
                      ? "primary"
                      : "default"
                  }
                />
              ))}
            </div>
          </Section>
        )}
        {docs.sections?.map((section) => (
          <Section key={section.title} id={id(section.title)} title={section.title}>
            <div className={classes.rows}>
              {section.items.map(([term, text]) => (
                <Fragment key={term}>
                  <Typography variant="body2" className={classes.term}>
                    {term}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {text}
                  </Typography>
                </Fragment>
              ))}
            </div>
          </Section>
        ))}
        {shortcuts.length > 0 && (
          <Section id={id(t("keyboardShortcuts"))} title={t("keyboardShortcuts")}>
            <div className={classes.rows}>
              {shortcuts.map((row) => (
                <Fragment key={row.id}>
                  <span>
                    {row.keys.map((key) => (
                      <kbd key={key} className={classes.kbd}>
                        {key}
                      </kbd>
                    ))}
                  </span>
                  <Typography variant="body2" color="text.secondary">
                    {row.title}
                  </Typography>
                </Fragment>
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

/** Section titles in display order, for the navigation tree. */
function sectionTitles(entry: LoadedDocs, t: TFunction<"panelToolbar">): string[] {
  return [
    ...(entry.schemas.length > 0 ? [t("supportedSchemas")] : []),
    ...(entry.docs.sections ?? []).map((section) => section.title),
    ...((entry.info.shortcuts?.length ?? 0) > 0 ? [t("keyboardShortcuts")] : []),
  ];
}

function PanelGuideDialog(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const hide = usePanelGuideStore((state) => state.hide);
  const show = usePanelGuideStore((state) => state.show);
  const selectedType = usePanelGuideStore((state) => state.panelType);
  const panelCatalog = usePanelCatalog();
  const [query, setQuery] = useState("");

  // Load every panel's docs up front, so search also finds panels by schema.
  const loaded = useAsync(async () => {
    const panels = panelCatalog.getPanels().filter((info) => info.docs != undefined);
    return await Promise.all(
      panels.map(async (info): Promise<LoadedDocs> => {
        const docs = (await info.docs!()).default;
        const schemas = schemaDisplayNames(docs.schemas ?? []);
        const haystack = [
          info.title,
          docs.intro,
          ...schemas,
          ...(docs.sections ?? []).flatMap((section) => [section.title, ...section.items.flat()]),
        ]
          .join("\n")
          .toLowerCase();
        return { info, docs, schemas, haystack };
      }),
    );
  }, [panelCatalog]);

  const entries = useMemo(() => loaded.value ?? [], [loaded.value]);
  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const visible = useMemo(() => {
    return entries.filter(
      (entry) => entry.info.hidden !== true && words.every((word) => entry.haystack.includes(word)),
    );
  }, [entries, words]);

  // A hidden alias (e.g. a legacy panel type) is selectable but not listed.
  const selected =
    entries.find((entry) => entry.info.type === selectedType) ??
    entries.find((entry) => entry.info.hidden !== true);

  return (
    <Dialog
      open
      onClose={hide}
      fullWidth
      maxWidth="lg"
      classes={{ paper: classes.paper }}
      aria-labelledby="panel-guide-title"
    >
      <nav className={classes.nav} aria-label={t("panelGuide")}>
        <TextField
          className={classes.search}
          autoFocus
          size="small"
          type="search"
          placeholder={t("searchPanelGuide")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          slotProps={{ htmlInput: { "aria-label": t("searchPanelGuide"), spellCheck: false } }}
        />
        <List dense className={classes.list}>
          {visible.map((entry) => {
            const isSelected = entry === selected;
            return (
              <li key={entry.info.type}>
                <ListItemButton
                  selected={isSelected}
                  onClick={() => {
                    show(entry.info.type);
                  }}
                >
                  <ListItemText primary={entry.info.title} />
                </ListItemButton>
                {isSelected && (
                  <List dense disablePadding>
                    {sectionTitles(entry, t).map((title) => (
                      <ListItemButton
                        key={title}
                        className={classes.subItem}
                        onClick={() => {
                          document
                            .getElementById(sectionId(entry.info.type, title))
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        <ListItemText secondary={title} />
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </li>
            );
          })}
          {loaded.value && visible.length === 0 && (
            <ListItemText className={classes.search} secondary={t("noPanelsFound")} />
          )}
        </List>
      </nav>
      {/* Keyed so switching panels starts at the top. */}
      <main key={selected?.info.type} className={classes.main}>
        <IconButton className={classes.close} onClick={hide} aria-label={t("close")}>
          <CloseIcon />
        </IconButton>
        {loaded.loading && <LinearProgress />}
        {loaded.error && <Typography color="error">{loaded.error.message}</Typography>}
        {selected && <PanelDocsView key={selected.info.type} entry={selected} words={words} />}
      </main>
    </Dialog>
  );
}

/** Mounts the panel guide; it only renders while open. */
export function PanelGuide(): React.JSX.Element {
  const open = usePanelGuideStore((state) => state.open);
  return <>{open && <PanelGuideDialog />}</>;
}
