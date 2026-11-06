// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ListSubheader, Menu, MenuItem, PaperProps } from "@mui/material";
import { makeStyles } from "tss-react/mui";

import { isSafeUrl } from "@lichtblick/suite-base/api/organization/client";
import {
  OrganizationState,
  useOrganization,
} from "@lichtblick/suite-base/context/OrganizationContext";

const useStyles = makeStyles()({
  menuList: {
    minWidth: 200,
  },
});

/** Whether the account menu has anything to show; without it the avatar button is hidden. */
export function hasUserMenu(organization: OrganizationState): boolean {
  return (
    organization.status === "authenticated" ||
    organization.status === "unavailable" ||
    (organization.status === "unauthenticated" && organization.login != undefined)
  );
}

type UserMenuProps = {
  handleClose: () => void;
  anchorEl?: HTMLElement;
  open: boolean;
};

/** The account menu: login, the signed-in user, the server's links and logout. */
export function UserMenu({ anchorEl, handleClose, open }: UserMenuProps): React.JSX.Element {
  const { classes } = useStyles();
  const organizationItems = useOrganizationMenuItems();
  return (
    <Menu
      anchorEl={anchorEl}
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
    </Menu>
  );
}

/** Menu items for the organization status; empty when there is nothing to show. */
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
      ];
    }
  }
}
