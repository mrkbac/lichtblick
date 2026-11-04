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

import { compare } from "@foxglove/rostime";
import { Autocomplete, TextField } from "@mui/material";
import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction } from "@lichtblick/suite";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useStyles } from "@lichtblick/suite-base/panels/DiagnosticStatus/DiagnosticStatusPanel.style";
import { DiagnosticStatusPanelProps } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { getDisplayName } from "@lichtblick/suite-base/panels/DiagnosticStatus/utils/getDisplayName";
import { handleTopicToggle } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticTopics";
import { useDiagnosticsPanelData } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";

import DiagnosticTable from "./DiagnosticTable";
import { buildStatusPanelSettingsTree } from "./utils/buildStatusPanelSettingsTree";

type Option = { label: string; hardwareId: string; name: string | undefined };

// component to display a single diagnostic status from list
const DiagnosticStatusPanel = (props: DiagnosticStatusPanelProps): React.JSX.Element => {
  const { saveConfig, config } = props;
  const { openSiblingPanel } = usePanelContext();
  const { selectedHardwareId, selectedName, splitFraction, numericPrecision } = config;
  const { classes } = useStyles();
  const { t } = useTranslation("diagnostics");
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { topics, diagnostics, history, staleSec, range, seek } = useDiagnosticsPanelData(config);

  // Autocomplete entries: each hardware id (all its checks) and each single check.
  const autocompleteOptions = useMemo(() => {
    const items: Option[] = [];
    const seenHardwareIds = new Set<string>();
    for (const { status } of diagnostics.values()) {
      const hardwareId = status.hardware_id;
      if (hardwareId && !seenHardwareIds.has(hardwareId)) {
        seenHardwareIds.add(hardwareId);
        items.push({ label: hardwareId, hardwareId, name: undefined });
      }
      if (status.name) {
        items.push({
          label: getDisplayName(hardwareId, status.name),
          hardwareId,
          name: status.name,
        });
      }
    }
    return _.sortBy(items, (item) => item.label.toLowerCase());
  }, [diagnostics]);

  const selectedDisplayName = useMemo(() => {
    return selectedHardwareId != undefined
      ? getDisplayName(selectedHardwareId, selectedName ?? "")
      : undefined;
  }, [selectedHardwareId, selectedName]);

  const selectedAutocompleteOption = useMemo(() => {
    return (
      autocompleteOptions.find((item) => {
        return item.label === selectedDisplayName;
      }) ?? ReactNull
    );
  }, [autocompleteOptions, selectedDisplayName]);

  const filteredDiagnostics = useMemo(() => {
    const items = [];
    for (const diagnostic of diagnostics.values()) {
      if (
        diagnostic.status.hardware_id === (selectedHardwareId ?? "") &&
        (selectedName == undefined || selectedName === diagnostic.status.name)
      ) {
        items.push(diagnostic);
      }
    }
    return _.sortBy(items, ({ status }) => status.name.toLowerCase());
  }, [diagnostics, selectedHardwareId, selectedName]);

  // If there are available options but none match the user input we show a No matches
  // but if we don't have any options at all then we show waiting for diagnostics...
  const noOptionsText =
    autocompleteOptions.length > 0 ? t("noMatches") : t("waitingForDiagnostics");

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
      saveConfig(produce((draft) => _.set(draft, path.slice(1), value)));
    },
    [saveConfig, topics],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildStatusPanelSettingsTree(config, topics, t),
    });
  }, [actionHandler, config, topics, t, updatePanelSettingsTree]);

  const onChangeSplitFraction = useCallback(
    (newSplitFraction: number) => {
      saveConfig({ splitFraction: newSplitFraction });
    },
    [saveConfig],
  );

  let emptyState: React.JSX.Element;
  if (topics.subscribed.length === 0) {
    emptyState = <EmptyState>{t("noTopics")}</EmptyState>;
  } else if (selectedDisplayName) {
    emptyState = (
      <EmptyState>
        {t("waitingForDiagnosticsFrom")} <code>{selectedDisplayName}</code>
      </EmptyState>
    );
  } else {
    emptyState = <EmptyState>{t("noNodeSelected")}</EmptyState>;
  }

  return (
    <Stack flex="auto" overflow="hidden">
      <PanelToolbar className={classes.toolbar}>
        <Autocomplete
          disablePortal
          blurOnSelect={true}
          disabled={autocompleteOptions.length === 0}
          options={autocompleteOptions}
          value={selectedAutocompleteOption ?? ReactNull}
          noOptionsText={noOptionsText}
          isOptionEqualToValue={(option, value) => option.label === value.label}
          onChange={(_ev, value) => {
            saveConfig({
              selectedHardwareId: value?.hardwareId,
              selectedName: value?.name,
            });
          }}
          fullWidth
          size="small"
          renderInput={(params) => (
            <TextField
              variant="standard"
              {...params}
              slotProps={{ input: { ...params.InputProps, disableUnderline: true } }}
              placeholder={selectedDisplayName ?? t("filter")}
            />
          )}
        />
      </PanelToolbar>
      {filteredDiagnostics.length > 0 ? (
        <DiagnosticTable
          infos={filteredDiagnostics}
          history={history}
          range={range}
          staleSec={staleSec}
          onSeek={seek}
          numericPrecision={numericPrecision}
          splitFraction={splitFraction}
          onChangeSplitFraction={onChangeSplitFraction}
          openSiblingPanel={openSiblingPanel}
        />
      ) : (
        emptyState
      )}
    </Stack>
  );
};

export default DiagnosticStatusPanel;
