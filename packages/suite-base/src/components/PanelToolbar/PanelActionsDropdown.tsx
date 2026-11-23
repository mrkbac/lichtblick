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

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Divider, Menu, MenuItem } from "@mui/material";
import React, { MouseEvent, useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import ChangePanelMenu from "@lichtblick/suite-base/components/PanelToolbar/ChangePanelMenu";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import { PanelWindowContext } from "@lichtblick/suite-base/components/PanelWindow";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";

type Props = {
  isUnknownPanel: boolean;
};

const useStyles = makeStyles()((theme) => ({
  error: { color: theme.palette.error.main },
  icon: {
    marginRight: theme.spacing(-1),
  },
  menuItem: {
    display: "flex",
    gap: theme.spacing(1),
    alignItems: "center",

    "&.Mui-selected": {
      backgroundColor: theme.palette.action.hover,

      "&:hover": {
        backgroundColor: theme.palette.action.hover,
      },
    },
  },
}));

function PanelActionsDropdownComponent({ isUnknownPanel }: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const [menuAnchorEl, setMenuAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const [subMenuAnchorEl, setSubmenuAnchorEl] = useState<undefined | HTMLElement>(undefined);
  const { t } = useTranslation("panelToolbar");

  const menuOpen = Boolean(menuAnchorEl);
  // The open submenu is the one anchored at its menu item.
  const changePanelOpen = subMenuAnchorEl?.id === "change-panel-button";

  const panelContext = useContext(PanelContext);
  const panelWindow = useContext(PanelWindowContext);
  const {
    getCurrentLayoutState: getCurrentLayout,
    closePanel,
    splitPanel,
  } = useCurrentLayoutActions();
  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setSubmenuAnchorEl(undefined);
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setSubmenuAnchorEl(undefined);
    setMenuAnchorEl(undefined);
  };

  // Clicking or hovering opens the submenu. The menu stays open: the submenu is rendered inside it.
  const openSubmenu = (event: MouseEvent<HTMLElement>) => {
    setSubmenuAnchorEl(event.currentTarget);
  };

  // A mouse press on the submenu's item would take focus from the submenu's search field.
  const keepSubmenuFocus = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
  };

  const handleSubmenuClose = useCallback(() => {
    setSubmenuAnchorEl(undefined);
  }, []);

  const close = useCallback(() => {
    if (panelContext?.id != undefined) {
      closePanel({ id: panelContext.id });
    }
    handleMenuClose();
  }, [closePanel, panelContext?.id]);

  const split = useCallback(
    (id: string | undefined, direction: "row" | "column") => {
      if (id == undefined) {
        throw new Error("Trying to split unknown panel!");
      }

      const config = getCurrentLayout().selectedLayout?.data?.configById[id] ?? {};
      splitPanel({ id, direction, config });
      handleMenuClose();
    },
    [getCurrentLayout, splitPanel],
  );

  const enterFullscreen = useCallback(() => {
    panelContext?.enterFullscreen();
    handleMenuClose();
  }, [panelContext]);

  const type = panelContext?.type;

  if (type == undefined) {
    return <></>;
  }

  return (
    <div>
      <ToolbarIconButton
        id="panel-menu-button"
        aria-controls={menuOpen ? "panel-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={menuOpen ? "true" : undefined}
        onClick={handleMenuClick}
        data-testid="panel-menu"
        title={t("more")}
      >
        <MoreVertIcon />
      </ToolbarIconButton>
      <Menu
        id="panel-menu"
        anchorEl={menuAnchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          list: {
            "aria-labelledby": "panel-menu-button",
            dense: true,
          },
        }}
      >
        <MenuItem
          className={classes.menuItem}
          selected={changePanelOpen}
          id="change-panel-button"
          aria-controls={changePanelOpen ? "change-panel-menu" : undefined}
          aria-haspopup="true"
          aria-expanded={changePanelOpen ? "true" : undefined}
          onClick={openSubmenu}
          onMouseDown={keepSubmenuFocus}
          onMouseEnter={openSubmenu}
        >
          {t("changePanel")}
          <ChevronRightIcon className={classes.icon} fontSize="small" />
        </MenuItem>
        <ChangePanelMenu
          anchorEl={changePanelOpen ? subMenuAnchorEl : undefined}
          onClose={handleSubmenuClose}
        />
        <Divider variant="middle" />
        {!isUnknownPanel && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();
              split(panelContext?.id, "row");
            }}
            onMouseEnter={handleSubmenuClose}
            className={classes.menuItem}
          >
            {t("splitRight")}
          </MenuItem>
        )}
        {!isUnknownPanel && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();
              split(panelContext?.id, "column");
            }}
            onMouseEnter={handleSubmenuClose}
            className={classes.menuItem}
          >
            {t("splitDown")}
          </MenuItem>
        )}
        {panelContext?.isFullscreen !== true && panelWindow?.isOpen !== true && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();
              enterFullscreen();
            }}
            onMouseEnter={handleSubmenuClose}
            className={classes.menuItem}
            data-testid="panel-menu-fullscreen"
          >
            {t("fullscreen")}
          </MenuItem>
        )}
        {panelWindow?.isOpen === true && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();
              handleMenuClose();
              panelWindow.close();
            }}
            onMouseEnter={handleSubmenuClose}
            className={classes.menuItem}
          >
            {t("returnToWorkspace")}
          </MenuItem>
        )}
        {panelWindow?.isOpen === false && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();
              panelWindow.open("popout");
              handleMenuClose();
            }}
            onMouseEnter={handleSubmenuClose}
            className={classes.menuItem}
          >
            {t("openPopout")}
          </MenuItem>
        )}
        {panelWindow?.isOpen === false && panelWindow.supportsPiP && (
          <MenuItem
            onClick={(event) => {
              event.stopPropagation();
              panelWindow.open("pip");
              handleMenuClose();
            }}
            onMouseEnter={handleSubmenuClose}
            className={classes.menuItem}
          >
            {t("openPictureInPicture")}
          </MenuItem>
        )}
        <Divider variant="middle" />
        <MenuItem
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
          onMouseEnter={handleSubmenuClose}
          className={cx(classes.menuItem, classes.error)}
          data-testid="panel-menu-remove"
        >
          {t("removePanel")}
        </MenuItem>
      </Menu>
    </div>
  );
}

export const PanelActionsDropdown = React.memo(PanelActionsDropdownComponent);
