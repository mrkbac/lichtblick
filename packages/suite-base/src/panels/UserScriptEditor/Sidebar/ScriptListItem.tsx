// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  InputBase,
  ListItem,
  ListItemButton,
  ListItemText,
  inputBaseClasses,
  listItemSecondaryActionClasses,
} from "@mui/material";
import { ChangeEventHandler, FocusEventHandler, KeyboardEvent, useCallback, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { PanelIconButton } from "@lichtblick/suite-base/components/PanelButton";
import { findShortcut } from "@lichtblick/suite-base/util/keyboardShortcuts";

import { USER_SCRIPTS_BUTTONS } from "../buttons";
import { USER_SCRIPTS_SHORTCUTS } from "../shortcuts";

const useStyles = makeStyles()((theme) => ({
  input: {
    font: "inherit",
    padding: theme.spacing(1, 6, 1, 2),
    flexGrow: 1,
    overflow: "hidden",

    [`.${inputBaseClasses.input}`]: {
      padding: 0,
    },
  },
  listItem: {
    [`:not(:hover) .${listItemSecondaryActionClasses.root}`]: {
      visibility: "hidden",
    },
    [`:focus-within`]: {
      backgroundColor: theme.palette.action.selected,
    },
  },
}));

export function ScriptListItem({
  onClick,
  onDelete,
  onRename,
  title,
  selected,
}: {
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  title: string;
  selected?: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  const [label, setLabel] = useState(title);
  const [editMode, setEditMode] = useState(false);

  const onChange: ChangeEventHandler<HTMLInputElement> = useCallback((event) => {
    const name = event.target.value;
    setLabel(name);
  }, []);

  const onDoubleClick = useCallback(() => {
    setEditMode(true);
  }, []);

  const onFocus: FocusEventHandler<HTMLInputElement> = useCallback((event) => {
    event.target.select();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (label === "") {
        return;
      }
      const shortcut = findShortcut(USER_SCRIPTS_SHORTCUTS, event);
      if (shortcut?.id === "userScripts.cancelRename") {
        setLabel(title);
        setEditMode(false);
      } else if (shortcut?.id === "userScripts.rename") {
        setEditMode(false);
        onRename(label);
      }
    },
    [label, onRename, title],
  );

  const onBlur = useCallback(() => {
    if (label !== "") {
      setEditMode(false);
      onRename(label);

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }, [label, onRename]);

  const onButtonKeyDown = useCallback((event: KeyboardEvent) => {
    if (findShortcut(USER_SCRIPTS_SHORTCUTS, event)?.id === "userScripts.rename") {
      setEditMode(true);
    }
  }, []);

  return (
    <ListItem
      className={classes.listItem}
      disablePadding
      secondaryAction={
        <>
          {!editMode && (
            <PanelIconButton
              button={USER_SCRIPTS_BUTTONS.rename}
              onClick={() => {
                setEditMode(true);
              }}
            />
          )}
          <PanelIconButton button={USER_SCRIPTS_BUTTONS.delete} color="error" onClick={onDelete} />
        </>
      }
    >
      {editMode ? (
        <ListItemText slotProps={{ primary: { variant: "body2" } }}>
          <InputBase
            autoFocus
            fullWidth
            onBlur={onBlur}
            onChange={onChange}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
            value={label}
            className={classes.input}
          />
        </ListItemText>
      ) : (
        <ListItemButton
          selected={selected}
          onClick={onClick}
          onKeyDown={onButtonKeyDown}
          onDoubleClick={onDoubleClick}
        >
          <ListItemText
            primary={title}
            slotProps={{ primary: { variant: "body2", noWrap: true } }}
          />
        </ListItemButton>
      )}
    </ListItem>
  );
}
