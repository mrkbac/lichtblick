// SPDX-License-Identifier: MPL-2.0

import RestoreIcon from "@mui/icons-material/Restore";
import { Chip, IconButton, List, ListItem, ListItemText, Tooltip, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { ReactElement, useCallback, useEffect, useMemo, useState } from "react";

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

const selectLayout = (state: LayoutState) => state.selectedLayout;

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function formatAgo(savedAt: number, now: number): string {
  const ago = now - savedAt;
  for (const [unit, ms] of UNITS) {
    if (ago >= ms) {
      return relativeFormat.format(-Math.floor(ago / ms), unit);
    }
  }
  return "Just now";
}

/** Local version history of the current layout, newest first, with one-click restore. */
export default function LayoutHistoryList(): ReactElement {
  const selectedLayout = useCurrentLayoutSelector(selectLayout);
  const { restoreLayoutData } = useCurrentLayoutActions();
  const panelCatalog = usePanelCatalog();
  const { enqueueSnackbar } = useSnackbar();
  const layoutId = selectedLayout?.id;
  const currentData = selectedLayout?.data;

  const [versions, setVersions] = useState<LayoutVersion[]>([]);
  useEffect(() => {
    if (layoutId == undefined) {
      setVersions([]);
      return;
    }
    let active = true;
    const load = () => {
      void getLayoutVersions(layoutId).then((loaded) => {
        if (active) {
          setVersions(loaded);
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
        changes: describeChange(versions[i - 1]?.data, version.data, panelTitle),
      }))
      .reverse();
  }, [versions, panelCatalog]);

  const restore = useCallback(
    (version: LayoutVersion) => {
      if (layoutId == undefined) {
        return;
      }
      // Its own entry, so the state before the restore stays in the history too.
      recordLayoutVersion(layoutId, version.data, { kind: "restored" }).catch(() => {});
      restoreLayoutData(version.data);
      enqueueSnackbar(
        `Restored the version from ${new Date(version.savedAt).toLocaleString()}. Undo to go back.`,
        { variant: "success" },
      );
    },
    [enqueueSnackbar, layoutId, restoreLayoutData],
  );

  if (rows.length === 0) {
    return <EmptyState>Versions of this layout appear here as you edit it.</EmptyState>;
  }

  return (
    <Stack flex="auto" overflowY="auto">
      <List dense disablePadding>
        {rows.map(({ version, changes }) => {
          const isCurrent = currentData != undefined && _.isEqual(version.data, currentData);
          return (
            <ListItem
              key={version.savedAt}
              divider
              secondaryAction={
                !isCurrent && (
                  <Tooltip title="Restore this version">
                    <IconButton
                      edge="end"
                      size="small"
                      aria-label="Restore this version"
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
                      <span>{formatAgo(version.savedAt, now)}</span>
                    </Tooltip>
                    {version.kind === "opened" && <Chip size="small" label="Opened" />}
                    {version.kind === "restored" && <Chip size="small" label="Restored" />}
                    {isCurrent && <Chip size="small" color="primary" label="Current" />}
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
