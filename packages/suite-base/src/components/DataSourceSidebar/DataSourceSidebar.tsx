// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import { CircularProgress, Divider, IconButton, Tab, Tabs } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { SidebarContent } from "@lichtblick/suite-base/components/SidebarContent";
import Stack from "@lichtblick/suite-base/components/Stack";
import { TopicList } from "@lichtblick/suite-base/components/TopicList";
import WssErrorModal from "@lichtblick/suite-base/components/WssErrorModal";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import useAlertCount from "@lichtblick/suite-base/hooks/useAlertCount";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import { AlertsList } from "../AlertList/AlertsList";
import { DataSourceInfoView } from "../DataSourceInfoView";
import { useStyles } from "./DataSourceSidebar.style";
import { AlertBadge } from "./utils";

type Props = {
  disableToolbar?: boolean;
};

const selectPlayerPresence = ({ playerState }: MessagePipelineContext) => playerState.presence;

type DataSourceSidebarTab = "topics" | "alerts";

export default function DataSourceSidebar(props: Props): React.JSX.Element {
  const { disableToolbar = false } = props;
  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const { playerAlerts, alertCount, highestSeverity } = useAlertCount();
  const [activeTab, setActiveTab] = useState<DataSourceSidebarTab>("topics");
  const { classes } = useStyles();
  const { t } = useTranslation("dataSourceInfo");
  const { dialogActions } = useWorkspaceActions();

  const isLoading = useMemo(
    () =>
      playerPresence === PlayerPresence.INITIALIZING ||
      playerPresence === PlayerPresence.RECONNECTING,
    [playerPresence],
  );

  useEffect(() => {
    if (playerPresence === PlayerPresence.ERROR || playerPresence === PlayerPresence.RECONNECTING) {
      setActiveTab("alerts");
    }
  }, [playerPresence]);

  return (
    <SidebarContent
      disablePadding
      disableToolbar={disableToolbar}
      overflow="auto"
      title={t("dataSource")}
      trailingItems={[
        isLoading && (
          <Stack key="loading" alignItems="center" justifyContent="center" padding={1}>
            <CircularProgress size={18} variant="indeterminate" />
          </Stack>
        ),
        <IconButton
          key="add-connection"
          color="primary"
          title="New connection"
          onClick={() => {
            dialogActions.dataSource.open("start");
          }}
        >
          <AddIcon />
        </IconButton>,
      ].filter(Boolean)}
    >
      <Stack fullHeight>
        {!disableToolbar && (
          <Stack paddingX={2} paddingBottom={2}>
            <DataSourceInfoView />
          </Stack>
        )}
        {playerPresence !== PlayerPresence.NOT_PRESENT && (
          <>
            <Stack flex={1}>
              {!disableToolbar && (
                <>
                  <Tabs
                    className={classes.tabs}
                    value={activeTab}
                    onChange={(_ev, newValue: DataSourceSidebarTab) => {
                      setActiveTab(newValue);
                    }}
                    textColor="inherit"
                  >
                    <Tab className={classes.tab} disableRipple label="Topics" value="topics" />
                    <Tab
                      className={classes.tab}
                      disableRipple
                      label={
                        <Stack direction="row" alignItems="baseline" gap={1}>
                          Alerts
                          {alertCount > 0 && (
                            <AlertBadge count={alertCount} severity={highestSeverity} />
                          )}
                        </Stack>
                      }
                      value="alerts"
                    />
                  </Tabs>
                  <Divider />
                </>
              )}
              {activeTab === "topics" && (
                <div className={classes.tabContent}>
                  <TopicList />
                </div>
              )}
              {activeTab === "alerts" && (
                <div className={classes.tabContent}>
                  <AlertsList />
                </div>
              )}
            </Stack>
          </>
        )}
      </Stack>
      <WssErrorModal playerAlerts={playerAlerts} />
    </SidebarContent>
  );
}
