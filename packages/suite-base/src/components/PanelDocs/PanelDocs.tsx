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
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";
import { create } from "zustand";

import { useAsync } from "@lichtblick/hooks";
import Log from "@lichtblick/log";
import { PanelButton, PanelButtonPreview } from "@lichtblick/suite-base/components/PanelButton";
import { PanelInfo, usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import type { DocumentedNodes } from "@lichtblick/suite-base/panels/shared/documentedSettings";
import { shortcutRows } from "@lichtblick/suite-base/util/keyboardShortcuts";
import { customTypography } from "@lichtblick/theme";

const log = Log.getLogger(__filename);

/** One fact the panel's declarations can't tell: [term, explanation]. */
export type PanelDocsItem = readonly [term: string, text: string];

/** One group of short facts, e.g. "Data". */
export type PanelDocsSection = {
  title: string;
  items: readonly PanelDocsItem[];
};

/**
 * In-app documentation for a panel, shown in the panel guide (the ⓘ button in a panel's toolbar,
 * or the app menu). Lives next to the panel and loads lazily. Everything the panel declares comes
 * from those declarations, so docs can't drift: buttons from its `buttons.ts`, settings from its
 * own settings builder, keyboard and mouse input from `PanelInfo.shortcuts`, schemas from its
 * constants. `sections` hold only what no declaration can tell.
 */
export type PanelDocs = {
  /** One short sentence: what the panel is for. */
  intro: string;
  /** Schemas the panel reads, from the panel's own constants. */
  schemas?: Iterable<string>;
  /** Schemas a topic needs to be opened in a new panel of this kind ("Open in"); else `schemas`. */
  openInSchemas?: Iterable<string>;
  /** The panel's declared buttons, in the order it draws them. */
  buttons?: readonly PanelButton[];
  /** The panel's settings tree for its default config, built by the panel's own builder. */
  settings?: () => DocumentedNodes;
  /** Short facts no declaration covers, e.g. what a message path accepts. */
  sections?: readonly PanelDocsSection[];
};

/** [label path, label, help] rows for every documented node and field, in tree order. */
export function settingsRows(
  nodes: DocumentedNodes,
  path: readonly string[] = [],
): { path: string; label: string; help: string }[] {
  return Object.values(nodes).flatMap((node) => {
    if (node == undefined) {
      return [];
    }
    const nodePath = node.label != undefined ? [...path, node.label] : path;
    const rows = [];
    if (node.help != undefined && node.label != undefined) {
      rows.push({ path: path.join(" › "), label: node.label, help: node.help });
    }
    for (const field of Object.values(node.fields ?? {})) {
      if (field != undefined) {
        rows.push({ path: nodePath.join(" › "), label: field.label, help: field.help });
      }
    }
    // Actions (e.g. "Send test alert") are listed when they have a tooltip.
    for (const action of node.actions ?? []) {
      if (action.type === "action" && action.tooltip != undefined) {
        rows.push({ path: nodePath.join(" › "), label: action.label, help: action.tooltip });
      }
    }
    return [...rows, ...settingsRows(node.children ?? {}, nodePath)];
  });
}

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

type Row = {
  term: string;
  text: string;
  button?: PanelButton;
  /** Formatted keys and gestures, for keyboard and mouse rows. */
  keys?: string[];
  /** Sub-heading the row sits under, e.g. a settings node's path. */
  group?: string;
};
type Section = { title: string; rows: Row[] };

type LoadedDocs = {
  info: PanelInfo;
  docs: PanelDocs;
  schemas: string[];
  /**
   * In display order: the panel's hand-written facts first, then what's generated from its
   * declarations (buttons, settings, keyboard and mouse). Schemas come last.
   */
  sections: Section[];
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
  main: { flex: 1, overflowY: "auto", padding: theme.spacing(2, 3, 3), position: "relative" },
  close: { position: "absolute", top: theme.spacing(1), right: theme.spacing(1) },
  intro: { margin: theme.spacing(1, 0, 1) },
  // One grid for the whole page, so terms line up across sections.
  grid: {
    display: "grid",
    gridTemplateColumns: "auto minmax(80px, max-content) 1fr",
    columnGap: theme.spacing(1.5),
    rowGap: theme.spacing(0.5),
    alignItems: "center",
  },
  // Clears the sticky jump bar when jumped to.
  sectionTitle: { gridColumn: "1 / -1", marginTop: theme.spacing(2), scrollMarginTop: 48 },
  groupTitle: { gridColumn: "2 / -1", marginTop: theme.spacing(1.5), fontWeight: 600 },
  fullRow: { gridColumn: "1 / -1" },
  // Stays visible while scrolling, so long pages (e.g. 3D settings) stay navigable.
  jump: {
    position: "sticky",
    top: theme.spacing(-2),
    zIndex: 1,
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing(0.5),
    padding: theme.spacing(1, 0),
    backgroundColor: theme.palette.background.paper,
    backgroundImage: "inherit",
  },

  chips: { display: "flex", flexWrap: "wrap", gap: theme.spacing(0.5) },
  chip: { fontFamily: customTypography.fontMonospace },
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

const sectionId = (index: number) => `panel-guide-section-${index}`;

function SectionTitle(props: { title: string; id: string }): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      component="h3"
      id={props.id}
      className={classes.sectionTitle}
    >
      {props.title}
    </Typography>
  );
}

function PanelDocsView(props: { entry: LoadedDocs; words: string[] }): React.JSX.Element {
  const { entry, words } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const { info, schemas, sections } = entry;
  const titles = [...sections.map((section) => section.title)];
  if (schemas.length > 0) {
    titles.push(t("supportedSchemas"));
  }
  return (
    <>
      <Typography variant="h4" component="h2" id="panel-guide-title">
        {info.title}
      </Typography>
      <Typography variant="body1" className={classes.intro}>
        {entry.docs.intro}
      </Typography>
      {titles.length > 2 && (
        <nav className={classes.jump} aria-label={t("panelGuideSections")}>
          {titles.map((title, index) => (
            <Chip
              key={title}
              size="small"
              variant="outlined"
              label={title}
              onClick={() => {
                document.getElementById(sectionId(index))?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          ))}
        </nav>
      )}
      <div className={classes.grid}>
        {sections.map((section, sectionIndex) => (
          <Fragment key={section.title}>
            <SectionTitle title={section.title} id={sectionId(sectionIndex)} />
            {section.rows.map(({ term, text, button, keys, group }, index) => (
              // Merged settings nodes can repeat a label (e.g. two "Scale" fields).
              <Fragment key={`${index}:${term}`}>
                {group != undefined && group !== section.rows[index - 1]?.group && (
                  <Typography
                    variant="body2"
                    color="primary"
                    component="h4"
                    className={classes.groupTitle}
                  >
                    {group}
                  </Typography>
                )}
                <span>{button && <PanelButtonPreview button={button} />}</span>
                {keys != undefined ? (
                  <span>
                    {keys.map((key) => (
                      <kbd key={key} className={classes.kbd}>
                        {key}
                      </kbd>
                    ))}
                  </span>
                ) : (
                  <Typography variant="body2" className={classes.term}>
                    {term}
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  {text}
                </Typography>
              </Fragment>
            ))}
          </Fragment>
        ))}
        {schemas.length > 0 && (
          <>
            <SectionTitle title={t("supportedSchemas")} id={sectionId(sections.length)} />
            <div className={`${classes.fullRow} ${classes.chips}`}>
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
          </>
        )}
      </div>
    </>
  );
}

function PanelGuideDialog(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("panelToolbar");
  const { t: tButtons } = useTranslation("panelButtons");
  const { t: tShortcuts } = useTranslation("keyboardShortcuts");
  const hide = usePanelGuideStore((state) => state.hide);
  const show = usePanelGuideStore((state) => state.show);
  const selectedType = usePanelGuideStore((state) => state.panelType);
  const panelCatalog = usePanelCatalog();
  const [query, setQuery] = useState("");

  // Load every panel's docs up front, so search also finds panels by schema.
  const loaded = useAsync(async () => {
    const panels = panelCatalog.getPanels().filter((info) => info.docs != undefined);
    // One panel's broken docs (e.g. a stale chunk after a deploy) must not hide the others.
    const results = await Promise.allSettled(
      panels.map(async (info): Promise<LoadedDocs> => {
        const docs = (await info.docs!()).default;
        const schemas = schemaDisplayNames(docs.schemas ?? []);
        // Hand-written facts first: they're what the panel's declarations can't tell.
        const sections: Section[] = (docs.sections ?? []).map((section) => ({
          title: section.title,
          rows: section.items.map(([term, text]) => ({ term, text })),
        }));
        if (docs.buttons != undefined && docs.buttons.length > 0) {
          sections.push({
            title: t("buttons"),
            rows: docs.buttons.map((button) => ({
              term: tButtons(`${button.id}.title`),
              text: tButtons(`${button.id}.help`),
              button,
            })),
          });
        }
        // One section; each settings node's path is a sub-heading.
        const settings = settingsRows(docs.settings?.() ?? {}).map(
          (row): Row => ({ term: row.label, text: row.help, group: row.path || undefined }),
        );
        if (settings.length > 0) {
          sections.push({ title: t("settings"), rows: settings });
        }
        const shortcuts = shortcutRows(info.shortcuts ?? [], (key) => tShortcuts(key));
        if (shortcuts.length > 0) {
          sections.push({
            title: t("keyboardAndMouse"),
            rows: shortcuts.map((row) => ({
              term: row.keys.join(" "),
              text: row.title,
              keys: row.keys,
            })),
          });
        }
        const haystack = [
          info.title,
          docs.intro,
          ...schemas,
          ...sections.flatMap((section) => [
            section.title,
            ...section.rows.flatMap((row) => [row.term, row.text]),
          ]),
        ]
          .join("\n")
          .toLowerCase();
        return { info, docs, schemas, sections, haystack };
      }),
    );
    return results.flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return [result.value];
      }
      log.error(`Failed to load docs for ${panels[index]?.type}`, result.reason);
      return [];
    });
  }, [panelCatalog, t, tButtons, tShortcuts]);

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
          {visible.map((entry) => (
            <ListItemButton
              key={entry.info.type}
              selected={entry === selected}
              onClick={() => {
                show(entry.info.type);
              }}
            >
              <ListItemText primary={entry.info.title} />
            </ListItemButton>
          ))}
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
