// SPDX-License-Identifier: MPL-2.0

import RestoreIcon from "@mui/icons-material/Restore";
import { Chip, IconButton, List, ListItem, ListItemText, Tooltip, Typography } from "@mui/material";
import { useSnackbar } from "notistack";
import { ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import {
  LayoutVersion,
  getLayoutVersions,
  onLayoutVersionsChange,
  recordLayoutVersion,
} from "@lichtblick/suite-base/services/layoutVersions";

import { describeChange } from "./describeChange";

const selectLayoutId = (state: LayoutState) => state.selectedLayout?.id;

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function formatAgo(savedAt: number, now: number, justNow: string): string {
  const ago = now - savedAt;
  for (const [unit, ms] of UNITS) {
    if (ago >= ms) {
      return relativeFormat.format(-Math.floor(ago / ms), unit);
    }
  }
  return justNow;
}

/** Local version history of the current layout, newest first, with one-click restore. */
export default function LayoutHistoryList(): ReactElement {
  const layoutId = useCurrentLayoutSelector(selectLayoutId);
  const { restoreLayoutData } = useCurrentLayoutActions();
  const panelCatalog = usePanelCatalog();
  const { enqueueSnackbar } = useSnackbar();
  const { t } = useTranslation("layoutHistory");

  // Tagged with their layout, so another layout's versions never show (or restore) while the
  // newly selected layout's versions are still loading.
  const [loaded, setLoaded] = useState<{ layoutId: string; versions: LayoutVersion[] }>();
  const versions = useMemo(
    () => (loaded != undefined && loaded.layoutId === layoutId ? loaded.versions : []),
    [loaded, layoutId],
  );
  useEffect(() => {
    if (layoutId == undefined) {
      return;
    }
    let active = true;
    const load = () => {
      void getLayoutVersions(layoutId).then((result) => {
        if (active) {
          setLoaded({ layoutId, versions: result });
        }
      });
    };
    load();
    const unsubscribe = onLayoutVersionsChange((changed) => {
      if (changed === layoutId) {
        load();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [layoutId]);

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

  const rows = useMemo(() => {
    const panelTitle = (type: string) => panelCatalog.getPanelByType(type)?.title ?? type;
    return versions
      .map((version, i) => ({
        version,
        changes: describeChange(versions[i - 1]?.data, version.data, panelTitle, t),
      }))
      .reverse();
  }, [versions, panelCatalog, t]);

  const restore = useCallback(
    (version: LayoutVersion) => {
      if (layoutId == undefined) {
        return;
      }
      // Its own entry, so the state before the restore stays in the history too.
      recordLayoutVersion(layoutId, version.data, { kind: "restored" }).catch(() => {});
      restoreLayoutData(version.data);
      enqueueSnackbar(t("restoredToast", { time: new Date(version.savedAt).toLocaleString() }), {
        variant: "success",
      });
    },
    [enqueueSnackbar, layoutId, restoreLayoutData, t],
  );

  if (rows.length === 0) {
    return <EmptyState>{t("empty")}</EmptyState>;
  }

  return (
    <Stack flex="auto" overflowY="auto">
      <List dense disablePadding>
        {rows.map(({ version, changes }, index) => {
          // Every edit, undo and restore records a version, so the newest one is the current
          // state. Comparing data instead would flicker while a save is still debounced.
          const isCurrent = index === 0;
          return (
            <ListItem
              // Stable while an editing burst keeps updating the newest version.
              key={version.startedAt ?? version.savedAt}
              divider
              secondaryAction={
                !isCurrent && (
                  <Tooltip title={t("restore")}>
                    <IconButton
                      edge="end"
                      size="small"
                      aria-label={t("restore")}
                      onClick={() => {
                        restore(version);
                      }}
                    >
                      <RestoreIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              }
            >
              <ListItemText
                primary={
                  <Stack direction="row" alignItems="center" gap={0.5}>
                    <Tooltip title={new Date(version.savedAt).toLocaleString()}>
                      <span>{formatAgo(version.savedAt, now, t("justNow"))}</span>
                    </Tooltip>
                    {version.kind === "opened" && <Chip size="small" label={t("opened")} />}
                    {version.kind === "restored" && <Chip size="small" label={t("restored")} />}
                    {isCurrent && <Chip size="small" color="primary" label={t("current")} />}
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
            </ListItem>
          );
        })}
      </List>
    </Stack>
  );
}
