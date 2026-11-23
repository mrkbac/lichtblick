// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Grow, IconButton } from "@mui/material";
import {
  SnackbarProvider,
  SnackbarKey,
  useSnackbar,
  MaterialDesignContent,
  CustomContentProps,
} from "notistack";
import { PropsWithChildren, Ref } from "react";
import { makeStyles } from "tss-react/mui";

import { APP_BAR_HEIGHT } from "@lichtblick/suite-base/components/AppBar/constants";

const useStyles = makeStyles<void, "icon" | "dismissButton">()((theme, _params, classes) => ({
  icon: {},
  dismissButton: {
    color: theme.palette.common.white,

    "svg:not(.MuiSvgIcon-root)": {
      fontSize: 16,
    },
  },
  root: {
    "#notistack-snackbar": {
      padding: 0,
      gap: theme.spacing(0.75),
    },
    "&.notistack-MuiContent": {
      padding: theme.spacing(0.5, 1.5, 0.5, 1),
      fontSize: theme.typography.body2.fontSize,
    },
    "&.notistack-MuiContent-default": {
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,

      [`.${classes.icon}`]: { color: theme.palette.primary.main },
      [`.${classes.dismissButton}`]: { color: theme.palette.text.primary },
    },
    "&.notistack-MuiContent-success": {
      backgroundColor: theme.palette.success.main,
    },
    "&.notistack-MuiContent-error": {
      backgroundColor: theme.palette.error.main,
    },
    "&.notistack-MuiContent-info": {
      backgroundColor: theme.palette.info.main,
    },
    "&.notistack-MuiContent-warning": {
      backgroundColor: theme.palette.warning.main,
    },
  },
}));

const useContainerStyles = makeStyles()({
  // eslint-disable-next-line tss-unused-classes/unused-classes
  containerAnchorOriginTopCenter: {
    "&.notistack-SnackbarContainer": { top: APP_BAR_HEIGHT },
  },
});

const CloseSnackbarAction = ({ id }: { id: SnackbarKey }) => {
  const { closeSnackbar } = useSnackbar();
  const { classes } = useStyles();
  return (
    <IconButton
      size="small"
      className={classes.dismissButton}
      onClick={() => {
        closeSnackbar(id);
      }}
    >
      <CloseIcon style={{ fontSize: 16 }} />
    </IconButton>
  );
};

function Snackbar(props: CustomContentProps & { ref?: Ref<HTMLDivElement> }): React.JSX.Element {
  const { classes } = useStyles();
  return <MaterialDesignContent {...props} className={classes.root} />;
}

export default function StudioToastProvider({ children }: PropsWithChildren): React.JSX.Element {
  const { classes: containerClasses } = useContainerStyles();
  const { classes } = useStyles();

  return (
    <SnackbarProvider
      Components={{
        default: Snackbar,
        error: Snackbar,
        success: Snackbar,
        warning: Snackbar,
        info: Snackbar,
      }}
      action={(id) => <CloseSnackbarAction id={id} />}
      iconVariant={{
        default: <InfoOutlinedIcon fontSize="small" className={classes.icon} />,
        info: <InfoOutlinedIcon fontSize="small" className={classes.icon} />,
        error: <ErrorOutlineOutlinedIcon fontSize="small" className={classes.icon} />,
        warning: <WarningAmberIcon fontSize="small" className={classes.icon} />,
        success: <CheckCircleOutlineOutlinedIcon fontSize="small" className={classes.icon} />,
      }}
      anchorOrigin={{
        vertical: "top",
        horizontal: "center",
      }}
      maxSnack={5}
      preventDuplicate
      TransitionComponent={Grow}
      classes={containerClasses}
      domRoot={document.body}
    >
      {children}
    </SnackbarProvider>
  );
}
