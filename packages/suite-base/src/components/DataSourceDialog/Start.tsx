// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Dismiss16Regular, Pin16Filled, Pin16Regular } from "@fluentui/react-icons";
import {
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { OpenUrlInput } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput";
import SidebarItems from "@lichtblick/suite-base/components/DataSourceDialog/SidebarItems";
import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/index.style";
import LichtblickLogoText from "@lichtblick/suite-base/components/LichtblickLogoText";
import { RecentSourceLabel } from "@lichtblick/suite-base/components/RecentSourceLabel";
import Stack from "@lichtblick/suite-base/components/Stack";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";

// Number of recents listed before "Show all"
const RECENTS_PREVIEW_COUNT = 10;

export default function Start(): React.JSX.Element {
  const { recentSources, selectRecent, removeRecent, togglePinRecent, clearRecents } =
    usePlayerSelection();
  const { classes } = useStyles();
  const { t } = useTranslation("openDialog");
  const { dialogActions } = useWorkspaceActions();
  const [showAllRecents, setShowAllRecents] = useState(false);

  const visibleRecents = showAllRecents
    ? recentSources
    : recentSources.slice(0, RECENTS_PREVIEW_COUNT);

  return (
    <Stack className={classes.grid}>
      <header className={classes.header}>
        <LichtblickLogoText color="primary" className={classes.logo} />
      </header>
      <Stack className={classes.content}>
        <Stack gap={4} flex="auto" overflow="hidden">
          <Stack gap={1}>
            <Typography variant="h5" gutterBottom>
              {t("openDataSource")}
            </Typography>
            <OpenUrlInput />
          </Stack>
          {recentSources.length > 0 && (
            <Stack gap={1} overflow="hidden">
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="h5">{t("recentDataSources")}</Typography>
                {recentSources.some((recent) => recent.pinned !== true) && (
                  <Button size="small" color="inherit" onClick={clearRecents}>
                    {t("clearRecents")}
                  </Button>
                )}
              </Stack>
              <List disablePadding dense className={classes.recentList}>
                {visibleRecents.map((recent) => {
                  const pinned = recent.pinned === true;
                  return (
                    <ListItem
                      disablePadding
                      key={recent.id}
                      id={recent.id}
                      className={classes.recentListItem}
                      secondaryAction={
                        <>
                          <Tooltip title={pinned ? t("unpin") : t("pin")}>
                            <IconButton
                              size="small"
                              aria-label={pinned ? t("unpin") : t("pin")}
                              className={pinned ? undefined : "recent-action"}
                              onClick={() => {
                                togglePinRecent(recent.id);
                              }}
                            >
                              {pinned ? <Pin16Filled /> : <Pin16Regular />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t("removeRecent")}>
                            <IconButton
                              size="small"
                              edge="end"
                              aria-label={t("removeRecent")}
                              className="recent-action"
                              onClick={() => {
                                removeRecent(recent.id);
                              }}
                            >
                              <Dismiss16Regular />
                            </IconButton>
                          </Tooltip>
                        </>
                      }
                    >
                      <ListItemButton
                        selected={recent.current === true}
                        onClick={() => {
                          selectRecent(recent.id);
                        }}
                      >
                        <RecentSourceLabel recent={recent} hidePinIndicator />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
              {!showAllRecents && recentSources.length > RECENTS_PREVIEW_COUNT && (
                <Button
                  size="small"
                  className={classes.showAllRecents}
                  onClick={() => {
                    setShowAllRecents(true);
                  }}
                >
                  {t("showAllRecents", { count: recentSources.length })}
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Stack>
      <div className={classes.spacer} />
      <Stack gap={4} className={classes.sidebar}>
        <SidebarItems onSelectView={dialogActions.dataSource.open} />
      </Stack>
      <Typography variant="caption" className={classes.version}>
        {t("version", { version: APP_CONFIG.version })}
      </Typography>
    </Stack>
  );
}
