// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { Divider, Typography } from "@mui/material";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLatest } from "@lichtblick/hooks";
import { SettingsTree } from "@lichtblick/suite";
import { useConfigById } from "@lichtblick/suite-base/PanelAPI";
import { PanelSideScope } from "@lichtblick/suite-base/components/Compare/ComparedPanel";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { useMonitorSetup } from "@lichtblick/suite-base/components/MonitorSetupContext";
import { usePanelGuideStore } from "@lichtblick/suite-base/components/PanelDocs/PanelGuide";
import { ActionMenu } from "@lichtblick/suite-base/components/PanelSettings/ActionMenu";
import { buildSettingsTree } from "@lichtblick/suite-base/components/PanelSettings/settingsTree";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
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
import { getPanelTypeFromId } from "@lichtblick/suite-base/util/layout";
import {
  getAllPanelIds,
  getFallbackPanelId,
  getVisiblePanelIds,
  isTabPanel,
} from "@lichtblick/suite-base/util/tabLayout";

const selectLayoutData = (state: LayoutState) => state.selectedLayout?.data;
const EMPTY_IDS: readonly string[] = [];

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
  const { t: tToolbar } = useTranslation("panelToolbar");
  const showPanelGuide = usePanelGuideStore((state) => state.show);
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
  const visiblePanelIds = useMemo(
    () => (data ? getVisiblePanelIds(data).filter((id) => !hidden.has(id)) : []),
    [data, hidden],
  );
  const { selectedPanelIds: originalSelectedPanelIds, setSelectedPanelIds } = useSelectedPanels();
  const selectedPanelIds = useMemo(
    () => selectedPanelIdsForTests ?? originalSelectedPanelIds.filter((id) => !hidden.has(id)),
    [hidden, originalSelectedPanelIds, selectedPanelIdsForTests],
  );

  // Always show something. A panel still on screen (e.g. in another split) stays selected. When
  // nothing is selected, the selected panel went off screen because its tab was switched away, or
  // the Tab panel itself was selected (clicking its tab strip), show the first panel of that tab.
  const singleId = selectedPanelIds.length === 1 ? selectedPanelIds[0] : undefined;
  const needsFallback =
    selectedPanelIds.length === 0 ||
    (singleId != undefined && (!visiblePanelIds.includes(singleId) || isTabPanel(singleId)));
  const fallbackPanelId = useMemo(
    () => (needsFallback && data ? getFallbackPanelId(data, singleId, hidden) : undefined),
    [data, hidden, needsFallback, singleId],
  );
  useEffect(() => {
    if (
      selectedPanelIdsForTests == undefined &&
      fallbackPanelId != undefined &&
      fallbackPanelId !== singleId
    ) {
      setSelectedPanelIds([fallbackPanelId]);
    }
  }, [fallbackPanelId, selectedPanelIdsForTests, setSelectedPanelIds, singleId]);

  const selectedPanelId = useMemo(
    () => (selectedPanelIds.length === 1 ? selectedPanelIds[0] : undefined),
    [selectedPanelIds],
  );

  // Automatically deselect the panel we were editing when the settings sidebar closes
  const onUnmountRef = useLatest(() => {
    if (selectedPanelId != undefined) {
      setSelectedPanelIds([]);
    }
  });
  useEffect(
    () => () => {
      onUnmountRef.current();
    },
    [onUnmountRef],
  );

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
            configs: [{ id: selectedPanelId, config, override: true }],
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
  const hasPanelGuide = panelInfo?.docs != undefined;
  const title = panelInfo?.title ?? t("unknown");

  return (
    <SidebarContent
      disablePadding
      disableToolbar={disableToolbar}
      title={t("currentSettingsPanelName", { title })}
      trailingItems={[
        <ActionMenu
          key={1}
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
          {(settingsTree != undefined || hasPanelGuide) && (
            <>
              <Stack
                paddingLeft={0.75}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
              >
                <Typography variant="subtitle2">{t("panelName", { title })}</Typography>
                <Stack direction="row" alignItems="center">
                  {hasPanelGuide && (
                    <ToolbarIconButton
                      aria-label={tToolbar("panelInfo")}
                      title={tToolbar("panelInfo")}
                      onClick={() => {
                        showPanelGuide(panelType);
                      }}
                    >
                      <InfoOutlinedIcon />
                    </ToolbarIconButton>
                  )}
                  <ActionMenu
                    fontSize="small"
                    onReset={resetToDefaults}
                    onShare={() => {
                      setShowShareModal(true);
                    }}
                  />
                </Stack>
              </Stack>
              <Divider />
            </>
          )}
          {settingsTree || showTitleField ? (
            <PanelSideScope panelType={panelType} config={config}>
              <SettingsTreeEditor
                key={selectedPanelId}
                settings={settingsTree ?? EMPTY_SETTINGS_TREE}
                variant="panel"
              />
            </PanelSideScope>
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
