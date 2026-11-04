// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  Divider,
  ListSubheader,
  Menu,
  MenuItem,
  PaperProps,
  PopoverPosition,
  PopoverReference,
} from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { isSafeUrl } from "@lichtblick/suite-base/api/organization/client";
import { AppSettingsTab } from "@lichtblick/suite-base/components/AppSettingsDialog/types";
import { useOrganization } from "@lichtblick/suite-base/context/OrganizationContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";

const useStyles = makeStyles()({
  menuList: {
    minWidth: 200,
  },
});

type SettingsMenuProps = {
  handleClose: () => void;
  anchorEl?: HTMLElement;
  anchorReference?: PopoverReference;
  anchorPosition?: PopoverPosition;
  disablePortal?: boolean;
  open: boolean;
};

export function SettingsMenu({
  anchorEl,
  anchorReference,
  anchorPosition,
  disablePortal,
  handleClose,
  open,
}: SettingsMenuProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");

  const { dialogActions } = useWorkspaceActions();

  const onSettingsClick = useCallback(
    (tab?: AppSettingsTab) => {
      dialogActions.preferences.open(tab);
    },
    [dialogActions.preferences],
  );
  const organizationItems = useOrganizationMenuItems();
  return (
    <>
      <Menu
        anchorEl={anchorEl}
        anchorReference={anchorReference}
        anchorPosition={anchorPosition}
        disablePortal={disablePortal}
        id="user-menu"
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        slotProps={{
          list: {
            className: classes.menuList,
            dense: true,
          },
          paper: {
            "data-tourid": "user-menu",
          } as Partial<PaperProps & { "data-tourid"?: string }>,
        }}
      >
        {organizationItems}
        <MenuItem
          onClick={() => {
            onSettingsClick();
          }}
        >
          {t("settings")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onSettingsClick("extensions");
          }}
        >
          {t("extensions")}
        </MenuItem>
      </Menu>
    </>
  );
}

/** Login, the signed-in user, the server's links and logout, when an organization API is set. */
function useOrganizationMenuItems(): React.JSX.Element[] {
  const organization = useOrganization();
  switch (organization.status) {
    case "disabled":
    case "loading":
      return [];
    case "unavailable":
      return [
        <MenuItem key="unavailable" disabled>
          Organization server unavailable
        </MenuItem>,
        <Divider key="divider" />,
      ];
    case "unauthenticated": {
      const { login } = organization;
      if (!login) {
        return [];
      }
      return [
        <MenuItem key="login" onClick={() => void login()}>
          Log in
        </MenuItem>,
        <Divider key="divider" />,
      ];
    }
    case "authenticated": {
      const { session, logout } = organization;
      const organizationNames = new Map(
        session.organizations.map((org) => [org.id, org.displayName]),
      );
      const links = session.links.filter((link) => isSafeUrl(link.url));
      return [
        <ListSubheader key="user">{session.user.displayName}</ListSubheader>,
        ...links.map((link) => {
          const organizationName =
            link.organizationId != undefined
              ? organizationNames.get(link.organizationId)
              : undefined;
          return (
            <MenuItem
              key={`link-${link.id}`}
              component="a"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {organizationName != undefined ? `${organizationName}: ${link.label}` : link.label}
            </MenuItem>
          );
        }),
        <MenuItem key="logout" onClick={logout}>
          Log out
        </MenuItem>,
        <Divider key="divider" />,
      ];
    }
  }
}
