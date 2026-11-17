// SPDX-License-Identifier: MPL-2.0

import { Chip, List, ListItemButton, ListItemText, Tooltip, Typography } from "@mui/material";
import { ReactElement, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import type { HistoryEntry } from "@lichtblick/suite-base/providers/CurrentLayoutProvider/layoutHistory";

import { describeChange } from "./describeChange";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function formatAgo(
  savedAt: number,
  now: number,
  justNow: string,
  relativeFormat: Intl.RelativeTimeFormat,
): string {
  const ago = now - savedAt;
  for (const [unit, ms] of UNITS) {
    if (ago >= ms) {
      return relativeFormat.format(-Math.floor(ago / ms), unit);
    }
  }
  return justNow;
}

/**
 * The current layout's undo history, newest first. Undo/redo move the Current step; clicking a
 * step jumps there. Steps after Current are what redo would bring back.
 */
export default function LayoutHistoryList(): ReactElement {
  const { getLayoutHistory, subscribeLayoutHistory, goToLayoutHistory } = useCurrentLayoutActions();
  const { entries, index } = useSyncExternalStore(subscribeLayoutHistory, getLayoutHistory);
  const panelCatalog = usePanelCatalog();
  const { t, i18n } = useTranslation("layoutHistory");
  // Times follow the app's language, not the browser's.
  const locale = i18n.language;
  const relativeFormat = useMemo(
    () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
    [locale],
  );

  // Keep "5 minutes ago" fresh.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // Typing replaces only the newest step, so only its summary is computed again.
  const summaries = useRef(new WeakMap<HistoryEntry, { prev?: HistoryEntry; lines: string[] }>());
  const rows = useMemo(() => {
    const panelTitle = (type: string) => panelCatalog.getPanelByType(type)?.title ?? type;
    return entries
      .map((entry, i) => {
        const prev = entries[i - 1];
        let summary = summaries.current.get(entry);
        if (summary == undefined || summary.prev !== prev) {
          summary = { prev, lines: describeChange(prev?.data, entry.data, panelTitle, t) };
          summaries.current.set(entry, summary);
        }
        return { entry, i, changes: summary.lines };
      })
      .reverse();
  }, [entries, panelCatalog, t]);

  if (rows.length === 0) {
    return <EmptyState>{t("empty")}</EmptyState>;
  }

  return (
    <Stack flex="auto" overflowY="auto">
      <List dense disablePadding>
        {rows.map(({ entry, i, changes }) => (
          <ListItemButton
            key={i}
            divider
            selected={i === index}
            title={i === index ? undefined : t("goTo")}
            // Undone steps stay until the next edit, like redo.
            style={{ opacity: i > index ? 0.5 : undefined }}
            onClick={() => {
              goToLayoutHistory(i);
            }}
          >
            <ListItemText
              primary={
                <Stack direction="row" alignItems="center" gap={0.5}>
                  <Tooltip title={new Date(entry.savedAt).toLocaleString(locale)}>
                    <span>{formatAgo(entry.savedAt, now, t("justNow"), relativeFormat)}</span>
                  </Tooltip>
                  {entry.kind === "opened" && <Chip size="small" label={t("opened")} />}
                  {i === index && <Chip size="small" color="primary" label={t("current")} />}
                </Stack>
              }
              secondary={changes.map((line) => (
                <Typography
                  key={line}
                  variant="caption"
                  component="span"
                  style={{ display: "block" }}
                >
                  {line}
                </Typography>
              ))}
            />
          </ListItemButton>
        ))}
      </List>
    </Stack>
  );
}
