// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Typography } from "@mui/material";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUnmount } from "react-use";

import { SettingsTree } from "@lichtblick/suite";
import { useConfigById } from "@lichtblick/suite-base/PanelAPI";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { useMonitorSetup } from "@lichtblick/suite-base/components/MonitorSetupContext";
import { ActionMenu } from "@lichtblick/suite-base/components/PanelSettings/ActionMenu";
import { buildSettingsTree } from "@lichtblick/suite-base/components/PanelSettings/settingsTree";
import { PanelWindowContext } from "@lichtblick/suite-base/components/PanelWindow";
import SettingsTreeEditor from "@lichtblick/suite-base/components/SettingsTreeEditor";
import { ShareJsonModal } from "@lichtblick/suite-base/components/ShareJsonModal";
import { SidebarContent } from "@lichtblick/suite-base/components/SidebarContent";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  LayoutState,
  useCurrentLayoutActions,
  useCurrentLayoutSelector,
  useSelectedPanels,
} from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { usePanelCatalog } from "@lichtblick/suite-base/context/PanelCatalogContext";
import {
  PanelStateStore,
  usePanelStateStore,
} from "@lichtblick/suite-base/context/PanelStateContext";
import { PanelConfig } from "@lichtblick/suite-base/types/panels";
import { getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import { getAllPanelIds } from "@lichtblick/suite-base/util/tabLayout";

const selectLayoutData = (state: LayoutState) => state.selectedLayout?.data;
const EMPTY_IDS: readonly string[] = [];

const singlePanelIdSelector = (state: LayoutState) => {
  const data = state.selectedLayout?.data;
  const panelIds = data ? getAllPanelIds(data) : [];
  return panelIds.length === 1 ? panelIds[0] : undefined;
};

const selectIncrementSequenceNumber = (store: PanelStateStore) => store.incrementSequenceNumber;

const EMPTY_SETTINGS_TREE: SettingsTree = Object.freeze({
  actionHandler: () => undefined,
  nodes: {},
});

type PanelSettingsProps = React.PropsWithChildren<{
  disableToolbar?: boolean;
  selectedPanelIdsForTests?: readonly string[];
}>;

export default function PanelSettings({
  disableToolbar = false,
  selectedPanelIdsForTests,
}: PanelSettingsProps): React.JSX.Element {
  const { t } = useTranslation("panelSettings");
  const candidate = useCurrentLayoutSelector(singlePanelIdSelector);
  const data = useCurrentLayoutSelector(selectLayoutData);
  const inWindow = useContext(PanelWindowContext)?.isOpen === true;
  const detached = useMonitorSetup()?.detachedPanelIds ?? EMPTY_IDS;
  const hidden = useMemo(
    () =>
      new Set(
        !inWindow && data
          ? detached.flatMap((id) => getAllPanelIds({ ...data, layout: { panels: [id] } }))
          : [],
      ),
    [data, detached, inWindow],
  );
  const singlePanelId = candidate != undefined && !hidden.has(candidate) ? candidate : undefined;
  const {
    selectedPanelIds: originalSelectedPanelIds,
    setSelectedPanelIds,
    selectAllPanels,
  } = useSelectedPanels();
  const selectedPanelIds = useMemo(
    () => selectedPanelIdsForTests ?? originalSelectedPanelIds.filter((id) => !hidden.has(id)),
    [hidden, originalSelectedPanelIds, selectedPanelIdsForTests],
  );

  // If no panel is selected and there is only one panel in the layout, select it
  useEffect(() => {
    if (selectedPanelIds.length === 0 && singlePanelId != undefined) {
      selectAllPanels();
    }
  }, [selectAllPanels, selectedPanelIds, singlePanelId]);

  const selectedPanelId = useMemo(
    () => (selectedPanelIds.length === 1 ? selectedPanelIds[0] : undefined),
    [selectedPanelIds],
  );

  // Automatically deselect the panel we were editing when the settings sidebar closes
  useUnmount(() => {
    if (selectedPanelId != undefined) {
      setSelectedPanelIds([]);
    }
  });

  const panelCatalog = usePanelCatalog();
  const { getCurrentLayoutState: getCurrentLayout, savePanelConfigs } = useCurrentLayoutActions();
  const panelType = useMemo(
    () => (selectedPanelId != undefined ? getPanelTypeFromId(selectedPanelId) : undefined),
    [selectedPanelId],
  );
  const panelInfo = useMemo(
    () => (panelType != undefined ? panelCatalog.getPanelByType(panelType) : undefined),
    [panelCatalog, panelType],
  );

  const incrementSequenceNumber = usePanelStateStore(selectIncrementSequenceNumber);

  const [showShareModal, setShowShareModal] = useState(false);
  const shareModal = useMemo(() => {
    const panelConfigById = getCurrentLayout().selectedLayout?.data?.configById;
    if (selectedPanelId == undefined || !showShareModal || !panelConfigById) {
      return null;
    }
    return (
      <ShareJsonModal
        onRequestClose={() => {
          setShowShareModal(false);
        }}
        initialValue={panelConfigById[selectedPanelId] ?? {}}
        onChange={(config) => {
          savePanelConfigs({
            configs: [{ id: selectedPanelId, config: config as PanelConfig, override: true }],
          });
          incrementSequenceNumber(selectedPanelId);
        }}
        title={t("importOrExportSettings")}
      />
    );
  }, [
    getCurrentLayout,
    selectedPanelId,
    showShareModal,
    savePanelConfigs,
    incrementSequenceNumber,
    t,
  ]);

  const [config, , extensionSettings] = useConfigById(selectedPanelId);
  const messagePipelineState = useMessagePipelineGetter();

  const storedSettingsTreeSelector = useCallback(
    (store: PanelStateStore) =>
      selectedPanelId != undefined ? store.settingsTrees[selectedPanelId] : undefined,
    [selectedPanelId],
  );
  const storedSettingsTree = usePanelStateStore(storedSettingsTreeSelector);
  const settingsTree = useMemo(
    () =>
      buildSettingsTree({
        config,
        extensionSettings,
        messagePipelineState,
        panelType,
        settingsTree: storedSettingsTree,
      }),
    [
      config,
      extensionSettings,
      messagePipelineState,
      panelType,
      storedSettingsTree,
      /**
       * The core issue is that settingsTrees object in the PanelStateStore is being
       * mutated on each render, leading to unnecessary calls to buildSettingsTree
       * To address this, we need to ensure that settingsTrees remains
       * referentially stable unless its actual content changes.
       */
    ],
  );

  const resetToDefaults = useCallback(() => {
    if (selectedPanelId) {
      savePanelConfigs({
        configs: [{ id: selectedPanelId, config: {}, override: true }],
      });
      incrementSequenceNumber(selectedPanelId);
    }
  }, [incrementSequenceNumber, savePanelConfigs, selectedPanelId]);

  if (selectedPanelId == undefined) {
    return <EmptyState>{t("selectAPanelToEditItsSettings")}</EmptyState>;
  }

  if (!config) {
    return <EmptyState>{t("loadingPanelSettings")}</EmptyState>;
  }

  const showTitleField = panelInfo != undefined && panelInfo.hasCustomToolbar !== true;
  const title = panelInfo?.title ?? t("unknown");

  return (
    <SidebarContent
      disablePadding
      disableToolbar={disableToolbar}
      title={t("currentSettingsPanelName", { title })}
      trailingItems={[
        <ActionMenu
          key={1}
          allowShare
          onReset={resetToDefaults}
          onShare={() => {
            setShowShareModal(true);
          }}
        />,
      ]}
    >
      {shareModal}
      <Stack gap={2} justifyContent="flex-start" flex="auto">
        <Stack flex="auto">
          {settingsTree && (
            <>
              <Stack
                paddingLeft={0.75}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
              >
                <Typography variant="subtitle2">{t("panelName", { title })}</Typography>
                <ActionMenu
                  key={1}
                  fontSize="small"
                  allowShare
                  onReset={resetToDefaults}
                  onShare={() => {
                    setShowShareModal(true);
                  }}
                />
              </Stack>
              <Divider />
            </>
          )}
          {settingsTree || showTitleField ? (
            <SettingsTreeEditor
              key={selectedPanelId}
              settings={settingsTree ?? EMPTY_SETTINGS_TREE}
              variant="panel"
            />
          ) : (
            <Stack flex="auto" alignItems="center" justifyContent="center" paddingX={1}>
              <Typography variant="body2" align="center" color="textSecondary">
                {t("panelDoesNotHaveSettings")}
              </Typography>
            </Stack>
          )}
        </Stack>
      </Stack>
    </SidebarContent>
  );
}
