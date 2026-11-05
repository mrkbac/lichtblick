// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { InputBase, MenuItem, Select, Typography } from "@mui/material";
import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { List, RowComponentProps } from "react-window";

import { filterMap } from "@lichtblick/den/collection";
import { SettingsTreeAction } from "@lichtblick/suite";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { DiagnosticInfo } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import DiagnosticNodeRow from "@lichtblick/suite-base/panels/DiagnosticSummary/DiagnosticNodeRow";
import { useStyles } from "@lichtblick/suite-base/panels/DiagnosticSummary/DiagnosticSummary.style";
import {
  KNOWN_LEVELS,
  LEVEL_NAMES,
  MESSAGE_COLORS,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import {
  getConfiguredTopics,
  handleTopicToggle,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticTopics";
import { useDiagnosticsPanelData } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData";
import {
  DiagnosticSummaryConfig,
  DiagnosticSummaryProps,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import toggle from "@lichtblick/suite-base/util/toggle";

import { buildSettingsTree } from "./utils/buildSettingsTree";
import { filterAndSortDiagnostics, getDiagnosticsByLevel } from "./utils/util";

type RowData = { data: DiagnosticInfo[] };

const DiagnosticSummary = (props: DiagnosticSummaryProps): React.JSX.Element => {
  const { config, saveConfig } = props;
  const { classes } = useStyles();
  const { t } = useTranslation("diagnostics");
  const { minLevel, pinnedIds, hardwareIdFilter, sortByLevel = true, showHistory = true } = config;
  const { openSiblingPanel } = usePanelContext();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { topics, diagnostics, history, staleSec, range, seek } = useDiagnosticsPanelData(config);

  const togglePinned = useCallback(
    (info: DiagnosticInfo) => {
      saveConfig({ pinnedIds: toggle(pinnedIds, info.id) });
    },
    [pinnedIds, saveConfig],
  );

  const configuredTopics = useMemo(
    () => getConfiguredTopics({ topics: config.topics, topicToRender: config.topicToRender }),
    [config.topics, config.topicToRender],
  );
  const showDetails = useCallback(
    (info: DiagnosticInfo) => {
      openSiblingPanel({
        panelType: "DiagnosticStatusPanel",
        siblingConfigCreator: () => ({
          selectedHardwareId: info.status.hardware_id,
          selectedName: info.status.name,
          topics: configuredTopics,
          collapsedSections: [],
        }),
        updateIfExists: true,
      });
    },
    [configuredTopics, openSiblingPanel],
  );

  const renderRow = useCallback(
    (renderProps: RowComponentProps<RowData>) => {
      const item = renderProps.data[renderProps.index]!;
      return (
        <div
          style={{ ...renderProps.style }}
          data-testid={`diagnostic-summary-node-row-${renderProps.index}`}
        >
          <DiagnosticNodeRow
            key={item.id}
            info={item}
            isPinned={pinnedIds.includes(item.id)}
            onClick={showDetails}
            onClickPin={togglePinned}
            history={history.get(item.id)}
            range={range}
            staleSec={staleSec}
            showHistory={showHistory}
            onSeek={seek}
          />
        </div>
      );
    },
    [pinnedIds, showDetails, togglePinned, history, range, staleSec, showHistory, seek],
  );

  const nodes = useMemo(() => {
    const pinnedNodes = filterMap(pinnedIds, (id) => diagnostics.get(id));
    const nodesByLevel = getDiagnosticsByLevel(diagnostics);
    const levels = Array.from(nodesByLevel.keys()).sort().reverse();
    const sortedNodes = sortByLevel
      ? levels.flatMap((level) =>
          filterAndSortDiagnostics(nodesByLevel.get(level) ?? [], hardwareIdFilter, pinnedIds),
        )
      : filterAndSortDiagnostics([...diagnostics.values()], hardwareIdFilter, pinnedIds);

    return [...pinnedNodes, ...sortedNodes].filter(({ status }) => status.level >= minLevel);
  }, [diagnostics, hardwareIdFilter, pinnedIds, sortByLevel, minLevel]);

  let summary: React.ReactNode = null;
  if (topics.subscribed.length === 0) {
    summary = <EmptyState>{t("noTopics")}</EmptyState>;
  } else if (diagnostics.size === 0) {
    summary = <EmptyState>{t("waitingForDiagnostics")}</EmptyState>;
  } else if (nodes.length > 0) {
    summary = (
      <List<RowData>
        style={{ outline: "none", width: "100%", height: "100%" }}
        rowHeight={30}
        rowProps={{ data: nodes }}
        rowCount={nodes.length}
        overscanCount={10}
        rowComponent={renderRow}
      />
    );
  }

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }
      const { path, value } = action.payload;
      const topicPatch = handleTopicToggle(path, value, topics);
      if (topicPatch) {
        saveConfig(topicPatch);
        return;
      }
      saveConfig(produce<DiagnosticSummaryConfig>((draft) => _.set(draft, path.slice(1), value)));
    },
    [saveConfig, topics],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config, topics, t),
    });
  }, [actionHandler, config, topics, t, updatePanelSettingsTree]);

  return (
    <Stack flex="auto">
      <PanelToolbar>
        <Stack flex="auto" direction="row" gap={1}>
          <Select
            className={classes.select}
            value={minLevel}
            id="status-filter-menu"
            color="secondary"
            size="small"
            onChange={(event) => {
              saveConfig({ minLevel: event.target.value });
            }}
            MenuProps={{ MenuListProps: { dense: true } }}
          >
            {KNOWN_LEVELS.map((level) => (
              <MenuItem key={level} value={level}>
                <Typography variant="inherit" color={MESSAGE_COLORS[level]}>
                  {LEVEL_NAMES[level]?.toUpperCase()}
                </Typography>
              </MenuItem>
            ))}
          </Select>
          <InputBase
            value={hardwareIdFilter}
            placeholder={t("filter")}
            onChange={(e) => {
              saveConfig({ hardwareIdFilter: e.target.value });
            }}
            style={{ flex: "auto", font: "inherit" }}
          />
        </Stack>
      </PanelToolbar>
      <Stack flex="auto">{summary}</Stack>
    </Stack>
  );
};

export default DiagnosticSummary;
