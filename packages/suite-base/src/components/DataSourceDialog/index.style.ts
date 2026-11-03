// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { makeStyles } from "tss-react/mui";

export const useStyles = makeStyles()((theme) => ({
  page: {
    height: "100%",
    width: "100%",
    maxWidth: 1600,
    margin: "0 auto",
    overflow: "auto",
    gap: theme.spacing(3),
    padding: theme.spacing(4, 6, 1),

    [theme.breakpoints.down("md")]: {
      padding: theme.spacing(3, 2, 1),
    },
  },
  header: {
    display: "flex",
    alignItems: "center",
    // Room for the dialog's close button
    paddingRight: theme.spacing(6),
  },
  logo: {
    width: 180,
    height: "auto",
    marginLeft: theme.spacing(-1),
  },
  recents: {
    flex: "none",
    // Leave the rest of the page to the catalog
    maxHeight: "40%",
    minHeight: 0,
  },
  recentsFull: {
    flex: 1,
    minHeight: 0,
  },
  search: {
    flex: "1 1 320px",
  },
  recentList: {
    overflowY: "auto",
    marginInline: theme.spacing(-1),
  },
  showAllRecents: {
    alignSelf: "flex-start",
  },
  recentListItem: {
    // Show pin/remove actions on hover; pinned items always show their pin
    "& .recent-action": { opacity: 0 },
    "&:hover .recent-action, &:focus-within .recent-action": { opacity: 1 },
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing(1),
    borderTop: `1px solid ${theme.palette.divider}`,
    paddingTop: theme.spacing(0.5),
  },
  spacer: {
    flex: "auto",
  },
}));
