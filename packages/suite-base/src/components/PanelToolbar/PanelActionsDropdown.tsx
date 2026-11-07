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
import React, { MouseEvent, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { PanelSelection } from "@lichtblick/suite-base/components/PanelCatalog";
import PanelContext from "@lichtblick/suite-base/components/PanelContext";
import ChangePanelMenu from "@lichtblick/suite-base/components/PanelToolbar/ChangePanelMenu";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import { PanelWindowContext } from "@lichtblick/suite-base/components/PanelWindow";
import { useCurrentLayoutActions } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { getPanelIdForType } from "@lichtblick/suite-base/util/layout";

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

    ".root-span": {
      display: "flex",
      marginLeft: theme.spacing(-0.25),
    },
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
  const isTouchInteraction = useRef(false);
  const { t } = useTranslation("panelToolbar");

  const menuOpen = Boolean(menuAnchorEl);
  // The open submenu is the one anchored at its menu item.
  const changePanelOpen = subMenuAnchorEl?.id === "change-panel-button";
  const newTabOpen = subMenuAnchorEl?.id === "new-tab-button";

  const panelContext = useContext(PanelContext);
  const panelWindow = useContext(PanelWindowContext);
  const {
    getCurrentLayoutState: getCurrentLayout,
    closePanel,
    splitPanel,
    addPanel,
  } = useCurrentLayoutActions();
  const handleTouchStart = useCallback(() => {
    isTouchInteraction.current = true;
  }, []);

  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setSubmenuAnchorEl(undefined);
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setSubmenuAnchorEl(undefined);
    setMenuAnchorEl(undefined);
  };

  const handleSubmenuClick = (event: MouseEvent<HTMLElement>) => {
    if (subMenuAnchorEl !== event.currentTarget) {
      setSubmenuAnchorEl(event.currentTarget);
    }
    if (!isTouchInteraction.current) {
      setMenuAnchorEl(undefined);
    }
  };

  const handleSubmenuClose = useCallback(() => {
    setSubmenuAnchorEl(undefined);
  }, []);

  const handleSubmenuMouseEnter = (event: MouseEvent<HTMLElement>) => {
    setSubmenuAnchorEl(event.currentTarget);
  };

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

  const addTab = useCallback(
    ({ type, config }: PanelSelection) => {
      addPanel({
        id: getPanelIdForType(type),
        config,
        position: "center",
        targetPanelId: panelContext?.id,
      });
      handleMenuClose();
    },
    [addPanel, panelContext?.id],
  );

  const enterFullscreen = useCallback(() => {
    panelContext?.enterFullscreen();
    handleMenuClose();
  }, [panelContext]);

  const menuItems = useMemo(() => {
    const items = [];

    if (!isUnknownPanel) {
      items.push(
        {
          key: "vsplit",
          text: t("splitRight"),
          onClick: () => {
            split(panelContext?.id, "row");
          },
        },
        {
          key: "hsplit",
          text: t("splitDown"),
          onClick: () => {
            split(panelContext?.id, "column");
          },
        },
      );
    }

    if (panelContext?.isFullscreen !== true && panelWindow?.isOpen !== true) {
      items.push({
        key: "enter-fullscreen",
        text: t("fullscreen"),
        onClick: enterFullscreen,
        "data-testid": "panel-menu-fullscreen",
      });
    }

    if (panelWindow) {
      if (panelWindow.isOpen) {
        items.push({
          key: "return",
          text: t("returnToWorkspace"),
          onClick: () => {
            handleMenuClose();
            panelWindow.close();
          },
        });
      } else {
        items.push({
          key: "popout",
          text: t("openPopout"),
          onClick: () => {
            panelWindow.open("popout");
            handleMenuClose();
          },
        });
        if (panelWindow.supportsPiP) {
          items.push({
            key: "pip",
            text: t("openPictureInPicture"),
            onClick: () => {
              panelWindow.open("pip");
              handleMenuClose();
            },
          });
        }
      }
    }
    items.push({ key: "divider", type: "divider" });

    items.push({
      key: "remove",
      text: t("removePanel"),
      onClick: close,
      "data-testid": "panel-menu-remove",
      className: classes.error,
    });

    return items;
  }, [
    classes.error,
    close,
    enterFullscreen,
    isUnknownPanel,
    panelContext?.id,
    panelContext?.isFullscreen,
    panelWindow,
    split,
    t,
  ]);

  const buttonRef = useRef<HTMLDivElement>(null);
  const type = panelContext?.type;

  if (type == undefined) {
    return <></>;
  }

  return (
    <div ref={buttonRef}>
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
        onTouchStart={handleTouchStart}
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
          onClick={handleSubmenuClick}
          onMouseEnter={handleSubmenuMouseEnter}
        >
          {t("changePanel")}
          <ChevronRightIcon className={classes.icon} fontSize="small" />
        </MenuItem>
        <ChangePanelMenu
          anchorEl={changePanelOpen ? subMenuAnchorEl : undefined}
          onClose={handleSubmenuClose}
        />
        {!isUnknownPanel && (
          <MenuItem
            className={classes.menuItem}
            selected={newTabOpen}
            id="new-tab-button"
            data-testid="panel-menu-new-tab"
            aria-controls={newTabOpen ? "new-tab-menu" : undefined}
            aria-haspopup="true"
            aria-expanded={newTabOpen ? "true" : undefined}
            onClick={handleSubmenuClick}
            onMouseEnter={handleSubmenuMouseEnter}
          >
            {t("addTab")}
            <ChevronRightIcon className={classes.icon} fontSize="small" />
          </MenuItem>
        )}
        <ChangePanelMenu
          id="new-tab-menu"
          anchorEl={newTabOpen ? subMenuAnchorEl : undefined}
          onClose={handleSubmenuClose}
          onPanelSelect={addTab}
        />
        <Divider variant="middle" />
        {menuItems.map((item, idx) =>
          item.type === "divider" ? (
            <Divider key={`divider-${idx}`} variant="middle" />
          ) : (
            <MenuItem
              key={item.key}
              onClick={(event) => {
                event.stopPropagation();
                item.onClick?.();
              }}
              onMouseEnter={() => {
                setSubmenuAnchorEl(undefined);
              }}
              className={cx(classes.menuItem, item.className)}
              data-testid={item["data-testid"]}
            >
              {item.text}
            </MenuItem>
          ),
        )}
      </Menu>
    </div>
  );
}

export const PanelActionsDropdown = React.memo(PanelActionsDropdownComponent);
