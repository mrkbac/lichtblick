// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import DiffIcon from "@mui/icons-material/Difference";
import {
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
} from "@mui/material";
import React from "react";

import MessagePathInput from "@lichtblick/suite-base/components/MessagePathSyntax/MessagePathInput";
import { usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useStylesToolbar } from "@lichtblick/suite-base/panels/RawMessagesCommon/index.style";
import {
  PropsToolbar,
  RawMessagesVirtualPanelConfig,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import { RAW_MESSAGES_SHORTCUTS } from "@lichtblick/suite-base/panels/RawMessagesVirtual/shortcuts";
import { shortcutLabel } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { RAW_MESSAGES_BUTTONS } from "./buttons";
import { PREV_MSG_METHOD, CUSTOM_METHOD } from "./constants";

const { diff: DiffButton, search: SearchButton } = RAW_MESSAGES_BUTTONS;

function ToolbarComponent(props: PropsToolbar): React.JSX.Element {
  const {
    canExpandAll,
    diffEnabled,
    diffMethod,
    diffTopicPath,
    onDiffTopicPathChange,
    onToggleDiff,
    onToggleExpandAll,
    onTopicPathChange,
    saveConfig,
    showFullMessageForDiff,
    topicPath,
    searchOpen,
    onToggleSearch,
  } = props;

  const { classes, cx } = useStylesToolbar();
  const diffTitle = usePanelButtonTitle(DiffButton);
  const expandButton = canExpandAll
    ? RAW_MESSAGES_BUTTONS.expandAll
    : RAW_MESSAGES_BUTTONS.collapseAll;
  const expandTitle = usePanelButtonTitle(expandButton);
  const searchTitle = usePanelButtonTitle(SearchButton);
  const searchKey = shortcutLabel(RAW_MESSAGES_SHORTCUTS, "rawMessages.search");

  return (
    <>
      <PanelToolbar className={classes.toolbar}>
        <IconButton
          className={cx(classes.iconButton, { "Mui-selected": diffEnabled })}
          title={diffTitle}
          aria-label={diffTitle}
          onClick={onToggleDiff}
          color={diffEnabled ? "default" : "inherit"}
          size="small"
        >
          {diffEnabled ? <DiffIcon fontSize="small" /> : <DiffButton.icon fontSize="small" />}
        </IconButton>
        <IconButton
          className={classes.iconButton}
          title={expandTitle}
          aria-label={expandTitle}
          onClick={onToggleExpandAll}
          data-testid="expand-all"
          size="small"
        >
          <expandButton.icon fontSize="small" />
        </IconButton>
        <IconButton
          className={cx(classes.iconButton, { "Mui-selected": searchOpen })}
          title={searchKey != undefined ? `${searchTitle} (${searchKey})` : searchTitle}
          aria-label={searchTitle}
          onClick={onToggleSearch}
          size="small"
        >
          <SearchButton.icon fontSize="small" />
        </IconButton>
        <Stack fullWidth paddingLeft={0.25}>
          <MessagePathInput
            index={0}
            supportsMathModifiers
            path={topicPath}
            onChange={onTopicPathChange}
          />
        </Stack>
      </PanelToolbar>
      {diffEnabled && (
        <div className={classes.diffOptions}>
          <Select
            variant="filled"
            size="small"
            title="Diff method"
            value={diffMethod}
            MenuProps={{ slotProps: { list: { dense: true } } }}
            onChange={(event: SelectChangeEvent) => {
              saveConfig({
                diffMethod: event.target.value as RawMessagesVirtualPanelConfig["diffMethod"],
              });
            }}
          >
            <MenuItem value={PREV_MSG_METHOD}>{PREV_MSG_METHOD}</MenuItem>
            <MenuItem value={CUSTOM_METHOD}>custom</MenuItem>
          </Select>
          {diffMethod === CUSTOM_METHOD && (
            <MessagePathInput
              index={1}
              supportsMathModifiers
              path={diffTopicPath}
              onChange={onDiffTopicPathChange}
            />
          )}
          <FormControlLabel
            className={classes.fullMessage}
            disableTypography
            checked={showFullMessageForDiff}
            control={
              <Checkbox
                size="small"
                onChange={() => {
                  saveConfig({ showFullMessageForDiff: !showFullMessageForDiff });
                }}
              />
            }
            label="Show full message"
          />
        </div>
      )}
    </>
  );
}

export const Toolbar = React.memo(ToolbarComponent);
