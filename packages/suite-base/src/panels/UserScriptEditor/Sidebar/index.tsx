// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Paper, Tab, Tabs, tabClasses, tabsClasses } from "@mui/material";
import * as monacoApi from "monaco-editor/editor/editor.api.js";
import { SyntheticEvent, useCallback, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { Script } from "@lichtblick/suite-base/panels/UserScriptEditor/script";
import { UserScript, UserScripts } from "@lichtblick/suite-base/types/panels";
import { parseColor } from "@lichtblick/suite-base/util/parseColor";

import { USER_SCRIPTS_BUTTONS } from "../buttons";
import { ScriptsList } from "./ScriptsList";
import { Templates } from "./Templates";
import { Utilities } from "./Utilities";

const useStyles = makeStyles()((theme) => ({
  tabs: {
    padding: theme.spacing(0.75),

    [`.${tabClasses.root}`]: {
      minWidth: "auto",
      minHeight: 44,
      padding: theme.spacing(1, 1.25),
    },
    [`.${tabsClasses.indicator}`]: {
      backgroundColor: parseColor(theme.palette.primary.main)
        .alpha(theme.palette.action.selectedOpacity)
        .toRgbString(),
      right: 0,
      width: "100%",
      borderRadius: theme.shape.borderRadius,
      transition: "none",
      pointerEvents: "none",
    },
  },
  explorerWrapper: {
    backgroundColor: theme.palette.background.paper,
    width: 350,
    overflow: "auto",
  },
}));

type TabOption =
  | false // false means no tab is selected
  | "nodes"
  | "utils"
  | "templates";

type SidebarProps = {
  addNewScript: (sourceCode?: string) => void;
  selectScript: (scriptId: string) => void;
  deleteScript: (scriptId: string) => void;
  setScriptOverride: (script: Script, maxDepth?: number) => void;
  setUserScripts: (scripts: Partial<UserScripts>) => void;
  userScripts: UserScripts;
  selectedScriptId?: string;
  selectedScript?: UserScript;
  script?: Script;
};

export function Sidebar({
  userScripts,
  selectScript,
  deleteScript,
  selectedScriptId,
  selectedScript,
  setScriptOverride,
  setUserScripts,
  script,
  addNewScript: addNewNode,
}: SidebarProps): React.JSX.Element {
  const { classes } = useStyles();
  const scriptsTitle = usePanelButtonTitle(USER_SCRIPTS_BUTTONS.scripts);
  const utilitiesTitle = usePanelButtonTitle(USER_SCRIPTS_BUTTONS.utilities);
  const templatesTitle = usePanelButtonTitle(USER_SCRIPTS_BUTTONS.templates);
  const [activeTab, setActiveTab] = useState<TabOption>(false);

  const gotoUtils = useCallback(
    (filePath: string) => {
      const monacoFilePath = monacoApi.Uri.parse(`file://${filePath}`);
      const requestedModel = monacoApi.editor.getModel(monacoFilePath);
      if (!requestedModel) {
        return;
      }
      setScriptOverride(
        {
          filePath: requestedModel.uri.path,
          code: requestedModel.getValue(),
          readOnly: true,
          selection: undefined,
        },
        2,
      );
    },
    [setScriptOverride],
  );

  const handleClose = () => {
    setActiveTab(false);
  };

  const tabs = [
    {
      value: "nodes",
      button: USER_SCRIPTS_BUTTONS.scripts,
      title: `${scriptsTitle} (${Object.keys(userScripts).length})`,
      testId: "node-explorer",
    },
    {
      value: "utils",
      button: USER_SCRIPTS_BUTTONS.utilities,
      title: utilitiesTitle,
      testId: "utils-explorer",
    },
    {
      value: "templates",
      button: USER_SCRIPTS_BUTTONS.templates,
      title: templatesTitle,
      testId: "templates-explorer",
    },
  ] as const;

  return (
    <Paper elevation={0}>
      <Stack direction="row" fullHeight>
        <Tabs
          className={classes.tabs}
          orientation="vertical"
          value={activeTab}
          onChange={(_event: SyntheticEvent, newValue: TabOption) => {
            setActiveTab(newValue);
          }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.value}
              disableRipple
              value={tab.value}
              title={tab.title}
              icon={<tab.button.icon />}
              data-testid={tab.testId}
              // Clicking the open tab closes it (Tabs only reports changes)
              onClick={activeTab === tab.value ? handleClose : undefined}
            />
          ))}
        </Tabs>
        {activeTab !== false && (
          <>
            <Divider flexItem orientation="vertical" />
            <div className={classes.explorerWrapper}>
              {activeTab === "nodes" && (
                <ScriptsList
                  scripts={userScripts}
                  selectScript={selectScript}
                  deleteScript={deleteScript}
                  addNewScript={addNewNode}
                  onClose={handleClose}
                  selectedScriptId={selectedScriptId}
                  selectedScript={selectedScript}
                  setUserScripts={setUserScripts}
                />
              )}
              {activeTab === "utils" && (
                <Utilities onClose={handleClose} gotoUtils={gotoUtils} script={script} />
              )}
              {activeTab === "templates" && (
                <Templates onClose={handleClose} addNewNode={addNewNode} />
              )}
            </div>
          </>
        )}
        <Divider flexItem orientation="vertical" />
      </Stack>
    </Paper>
  );
}
