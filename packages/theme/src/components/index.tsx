// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  alertClasses,
  alpha,
  autocompleteClasses,
  buttonClasses,
  Components,
  dialogActionsClasses,
  Fade,
  filledInputClasses,
  inputAdornmentClasses,
  inputBaseClasses,
  inputClasses,
  listSubheaderClasses,
  outlinedInputClasses,
  selectClasses,
  tableCellClasses,
  Theme,
} from "@mui/material";
import { dividerClasses } from "@mui/material/Divider";
import { listClasses } from "@mui/material/List";
import { listItemClasses } from "@mui/material/ListItem";
import { tabsClasses } from "@mui/material/Tabs";

import { customTypography } from "../typography";

export const components: Components<Theme> = {
  MuiAlert: {
    defaultProps: {
      iconMapping: {
        error: <ErrorOutlineOutlinedIcon fontSize="small" />,
        info: <InfoOutlinedIcon fontSize="small" />,
        success: <CheckCircleOutlineOutlinedIcon fontSize="small" />,
        warning: <WarningAmberIcon fontSize="small" />,
      },
    },
    styleOverrides: {
      message: {
        lineHeight: "1.5",
      },
      standard: ({ theme }) => ({
        border: "1px solid",
        [`&.${alertClasses.colorWarning}`]: { borderColor: theme.palette.warning.main },
        [`&.${alertClasses.colorError}`]: { borderColor: theme.palette.error.main },
        [`&.${alertClasses.colorInfo}`]: { borderColor: theme.palette.info.main },
        [`&.${alertClasses.colorSuccess}`]: { borderColor: theme.palette.success.main },
      }),
    },
  },
  MuiAutocomplete: {
    defaultProps: {
      clearIcon: <CancelIcon fontSize="inherit" />,
      slotProps: {
        clearIndicator: {
          size: "small",
        },
      },
    },
    styleOverrides: {
      root: {
        minWidth: 144,
      },
      inputRoot: ({ theme }) => ({
        [`&.${inputBaseClasses.root}`]: {
          padding: theme.spacing(1, 1.25),

          [`.${autocompleteClasses.input}`]: {
            padding: 0,
          },
          [`&.${inputBaseClasses.sizeSmall}`]: {
            padding: theme.spacing(0.75, 1),
          },
        },
        [`.${autocompleteClasses.input}.${inputClasses.input}.MuiInputBase-adornedEnd`]: {
          paddingRight: theme.spacing(2),
        },
      }),
      clearIndicator: ({ theme }) => ({
        marginRight: theme.spacing(-0.5),
        opacity: theme.palette.action.disabledOpacity,

        ":hover": {
          background: "transparent",
          opacity: 1,
        },
      }),
    },
  },
  MuiAvatar: {
    defaultProps: {
      variant: "rounded",
    },
    styleOverrides: {
      colorDefault: ({ theme }) => ({
        color: "currentColor",
        backgroundColor: theme.palette.action.hover,
      }),
    },
  },
  MuiBadge: {
    styleOverrides: {
      badge: ({ theme }) => ({
        height: 16,
        minWidth: 16,
        padding: theme.spacing(0, 0.25),
        fontFeatureSettings: "normal",
      }),
    },
  },
  MuiBackdrop: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: alpha(theme.palette.common.black, 0.4),
      }),
      invisible: {
        backgroundColor: "transparent",
      },
    },
  },
  MuiButton: {
    defaultProps: {
      disableElevation: true,
    },
    styleOverrides: {
      root: {
        transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease",
      },
      contained: ({ theme }) => ({
        [`&.${buttonClasses.colorInherit}`]: {
          backgroundColor: theme.palette.action.focus,
        },
      }),
      sizeSmall: {
        [`&.${buttonClasses.text}`]: {
          fontSize: "0.625rem",
        },
        [`&.${buttonClasses.contained}`]: {
          fontSize: "0.625rem",
        },
        [`&.${buttonClasses.outlined}`]: {
          fontSize: "0.625rem",
        },
      },
      sizeLarge: {
        [`&.${buttonClasses.text}`]: {
          fontSize: "0.875rem",
        },
        [`&.${buttonClasses.contained}`]: {
          fontSize: "0.875rem",
        },
        [`&.${buttonClasses.outlined}`]: {
          fontSize: "0.875rem",
        },
      },
    },
  },
  MuiButtonGroup: {
    defaultProps: {
      disableRipple: true,
      disableFocusRipple: true,
    },
    styleOverrides: {},
  },
  MuiButtonBase: {
    defaultProps: {
      disableRipple: true,
    },
  },
  MuiCard: {
    defaultProps: {
      variant: "outlined",
      square: false,
    },
  },
  MuiCardActionArea: {
    defaultProps: {
      disableRipple: true,
    },
    styleOverrides: {
      focusHighlight: {
        transition: "none",
      },
    },
  },
  MuiCardContent: {
    styleOverrides: {
      root: ({ theme }) => ({
        "&:last-child": {
          paddingBottom: theme.spacing(2),
        },
      }),
    },
  },
  MuiCardHeader: {
    defaultProps: {
      slotProps: {
        title: { variant: "h4" },
      },
    },
    styleOverrides: {
      avatar: {
        marginRight: 0,
      },
      action: {
        alignSelf: "auto",
        marginTop: 0,
        marginRight: 0,
      },
      root: ({ theme }) => ({
        gap: theme.spacing(2),
      }),
    },
  },
  MuiCheckbox: {
    defaultProps: {
      disableRipple: true,
    },
    styleOverrides: {},
  },
  MuiChip: {
    styleOverrides: {
      sizeSmall: {
        height: 22,
      },
    },
  },
  MuiCssBaseline: {
    styleOverrides: (theme) => ({
      svg: {
        display: "block",
        maxWidth: "100%",
      },
      a: {
        color: "inherit",
        textDecoration: "none",
      },
      pre: {
        fontFamily: customTypography.fontMonospace,
        backgroundColor: theme.palette.background.default,
        borderRadius: theme.shape.borderRadius,
        padding: theme.spacing(2),
        overflow: "auto",
        color: theme.palette.text.secondary,
        margin: 0,
      },
      code: {
        fontFamily: customTypography.fontMonospace,
      },
    }),
  },
  MuiDialog: {
    defaultProps: {
      slotProps: {
        paper: { elevation: 4 },
      },
    },
    styleOverrides: {
      paper: ({ theme }) => ({
        borderRadius: 12,
        border: `1px solid ${theme.palette.divider}`,
        // Prevent dialog from going underneath window title bar controls on Windows
        maxHeight: `calc(100% - 2 * (env(titlebar-area-height, ${theme.spacing(2)}) + ${theme.spacing(
          2,
        )}))`,
      }),
    },
  },
  MuiDialogActions: {
    styleOverrides: {
      root: ({ theme }) => ({
        gap: theme.spacing(1),
        padding: theme.spacing(3),

        "& > :not(:first-of-type)": {
          marginLeft: "inherit",
        },
      }),
    },
  },
  MuiDialogContent: {
    styleOverrides: {
      root: ({ theme }) => ({
        ...theme.typography.body1,

        [`& + .${dialogActionsClasses.root}`]: {
          paddingTop: 0,
        },
      }),
    },
  },
  MuiDialogTitle: {
    styleOverrides: {
      root: ({ theme }) => theme.typography.h4,
    },
  },
  MuiFab: {
    defaultProps: {
      color: "inherit",
    },
    styleOverrides: {
      root: ({ theme }) => ({
        boxShadow: theme.shadows[2],
      }),
      colorInherit: ({ theme }) => ({
        backgroundColor: theme.palette.background.paper,
      }),
      extended: ({ theme }) => ({
        gap: theme.spacing(1),
      }),
    },
  },
  MuiFilledInput: {
    defaultProps: {
      disableUnderline: true,
    },
    styleOverrides: {
      input: ({ theme }) => ({
        padding: theme.spacing(1, 1.125),
        "&.MuiInputBase-sizeSmall": {
          padding: theme.spacing(0.75, 1),
        },
      }),
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,

        "&.Mui-focused": {
          backgroundColor: theme.palette.action.focus,

          [`&.${filledInputClasses.error}`]: {
            backgroundColor: alpha(theme.palette.error.main, theme.palette.action.focusOpacity),
          },
        },
        "&.Mui-disabled": {
          opacity: 0.5,
        },
        "&.Mui-error": {
          backgroundColor: alpha(theme.palette.error.main, theme.palette.action.hoverOpacity),
        },
      }),
    },
  },
  MuiFormControl: {
    defaultProps: {
      variant: "standard",
    },
    styleOverrides: {
      root: {
        [`label[data-shrink=false] + .${inputBaseClasses.formControl}`]: {
          [`.${inputBaseClasses.input}::placeholder`]: {
            opacity: "0.6 !important",
          },
        },
      },
    },
  },
  MuiFormLabel: {
    styleOverrides: {
      root: ({ theme }) => ({
        marginBottom: theme.spacing(0.5),
        fontSize: "0.75rem",
        padding: theme.spacing(0.325, 0),

        [`& + .${inputBaseClasses.root}.${inputClasses.root}`]: {
          marginTop: 0,
        },
      }),
    },
  },
  MuiIconButton: {
    defaultProps: {
      centerRipple: false,
      disableRipple: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,
        transition: "background-color 120ms ease, color 120ms ease",

        "&:hover": {
          backgroundColor: theme.palette.action.hover,
        },
        "&:focus-visible": {
          outline: "1px solid currentColor",
          outlineOffset: -1,
        },
      }),
    },
  },
  MuiInput: {
    defaultProps: {
      disableUnderline: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius: theme.shape.borderRadius,

        ":hover": {
          backgroundColor: theme.palette.action.hover,
        },
        "&.Mui-focused": {
          backgroundColor: theme.palette.action.focus,

          [`&.${inputClasses.error}`]: {
            backgroundColor: alpha(theme.palette.error.main, theme.palette.action.focusOpacity),
          },
        },
        "&.Mui-error": {
          backgroundColor: alpha(theme.palette.error.main, theme.palette.action.hoverOpacity),
        },
      }),
      input: ({ theme }) => ({
        padding: theme.spacing(1, 1.125),
      }),
      sizeSmall: ({ theme }) => ({
        [`& > .${inputClasses.input}`]: {
          padding: theme.spacing(0.75, 1),
        },
      }),
    },
  },
  MuiInputAdornment: {
    defaultProps: {},
    styleOverrides: {
      root: {
        [`&.${inputAdornmentClasses.filled}`]: {
          [`&.${inputAdornmentClasses.positionStart}, &.${inputAdornmentClasses.positionEnd}`]: {
            [`:not(.${inputAdornmentClasses.hiddenLabel})`]: {
              marginTop: 0,
            },
          },
        },
      },
      positionStart: {
        marginRight: 0,
      },
      positionEnd: {
        marginLeft: 0,
      },
    },
  },
  MuiInputBase: {
    styleOverrides: {
      root: ({ theme }) => ({
        [`&.${inputBaseClasses.adornedStart}`]: {
          paddingInlineStart: theme.spacing(1.25),
        },
        [`&.${inputBaseClasses.adornedEnd}`]: {
          paddingInlineEnd: theme.spacing(1.25),
        },
        [`.${inputBaseClasses.input}.MuiInputBase-adornedStart`]: {
          paddingInlineStart: theme.spacing(1),
        },
        [`.${inputBaseClasses.input}.MuiInputBase-adornedEnd`]: {
          paddingInlineEnd: theme.spacing(1),
        },
      }),
      sizeSmall: ({ theme }) => ({
        [`& > .${inputBaseClasses.input}`]: {
          fontSize: theme.typography.body2.fontSize,
        },
        [`&.${inputBaseClasses.adornedStart}`]: {
          paddingInlineStart: theme.spacing(1),
        },
        [`&.${inputBaseClasses.adornedEnd}`]: {
          paddingInlineEnd: theme.spacing(1),
        },
        [`.${inputBaseClasses.input}.MuiInputBase-adornedStart`]: {
          paddingInlineStart: theme.spacing(0.75),
        },
        [`.${inputBaseClasses.input}.MuiInputBase-adornedEnd`]: {
          paddingInlineEnd: theme.spacing(0.75),
        },
      }),
      input: {
        "::placeholder": {
          transition: "none",
          opacity: 0.6,
        },
      },
    },
  },
  MuiInputLabel: {
    defaultProps: {
      disableAnimation: true,
      variant: "standard",
      shrink: false,
    },
    styleOverrides: {
      standard: ({ theme }) => ({
        position: "relative",
        transform: "none",
        fontSize: "0.75rem",
        padding: theme.spacing(0.325, 0),

        [`& + .${inputBaseClasses.root}.${inputClasses.root}`]: {
          marginTop: 0,
        },
      }),
    },
  },
  MuiLink: {
    defaultProps: {
      color: "primary",
    },
    styleOverrides: {
      root: {
        cursor: "pointer",
      },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      colorPrimary: ({ theme }) => ({ backgroundColor: theme.palette.divider }),
      colorSecondary: ({ theme }) => ({ backgroundColor: theme.palette.divider }),
    },
  },
  MuiListItemButton: {
    defaultProps: {
      disableRipple: true,
    },
    styleOverrides: {
      root: {
        transition: "none",
      },
    },
  },
  MuiListItemText: {
    styleOverrides: {
      dense: ({ theme }) => ({
        marginTop: theme.spacing(0.25),
        marginBottom: theme.spacing(0.25),
      }),
    },
  },
  MuiListSubheader: {
    defaultProps: {
      disableSticky: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        fontFamily: theme.typography.overline.fontFamily,
        fontWeight: 400,
        fontSize: theme.typography.overline.fontSize,
        lineHeight: 3,
        letterSpacing: theme.typography.overline.letterSpacing,
        textTransform: "uppercase",
      }),
      sticky: ({ theme }) => ({
        backgroundColor: theme.palette.background.paper,
      }),
    },
  },
  MuiMenu: {
    defaultProps: {
      slots: { transition: Fade },
    },
    styleOverrides: {
      paper: ({ theme }) => ({
        borderRadius: 8,
        backgroundColor: theme.palette.background.menu,
        border: `1px solid ${theme.palette.divider}`,
        boxShadow:
          theme.palette.mode === "dark"
            ? "0 12px 32px -8px rgb(0 0 0 / 0.6), 0 2px 6px rgb(0 0 0 / 0.3)"
            : "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 2px 6px rgb(16 24 40 / 0.06)",
      }),
      list: ({ theme }) => ({
        ...theme.typography.body1,
        padding: theme.spacing(0.5),

        [`.${listItemClasses.root}, .MuiMenuItem-root`]: {
          borderRadius: theme.shape.borderRadius,
        },

        [`&.${listClasses.dense}`]: {
          ...theme.typography.body2,
        },
        [`.${listItemClasses.root} + .${dividerClasses.root}`]: {
          marginTop: theme.spacing(1),
          marginBottom: theme.spacing(1),
        },
        [`.${listSubheaderClasses.sticky}`]: {
          backgroundColor: theme.palette.background.menu,
        },
      }),
    },
  },
  MuiMenuItem: {
    defaultProps: {
      disableRipple: true,
    },
    styleOverrides: {
      root: {
        minHeight: 32,
      },
    },
  },
  MuiOutlinedInput: {
    defaultProps: {
      notched: false,
    },
    styleOverrides: {
      input: ({ theme }) => ({
        boxSizing: "content-box",
        padding: theme.spacing(1, 1.25),
      }),
      sizeSmall: ({ theme }) => ({
        [`& > .${outlinedInputClasses.input}`]: {
          padding: theme.spacing(0.75, 1),
        },
      }),
    },
  },
  MuiPaper: {
    defaultProps: {
      elevation: 2,
    },
    styleOverrides: {
      elevation: {
        backgroundImage: "none !important",
      },
    },
  },
  MuiPopover: {
    defaultProps: {
      marginThreshold: 8,
    },
  },
  MuiRadio: {
    defaultProps: {
      disableRipple: true,
      size: "small",
    },
  },
  MuiSelect: {
    defaultProps: {
      variant: "outlined",
    },
    styleOverrides: {
      standard: ({ theme }) => ({
        [`&.${selectClasses.select}`]: {
          paddingInlineEnd: theme.spacing(4),
        },
        [`& ~ .${selectClasses.icon}`]: {
          right: theme.spacing(0.75),
        },
      }),
    },
  },
  // MUI's default value label uses grey[600], which in the dark palette is the same
  // colour as the sidebar background. Invert text/background so it reads in both themes.
  MuiSlider: {
    styleOverrides: {
      valueLabel: ({ theme }) => ({
        backgroundColor: theme.palette.text.primary,
        color: theme.palette.background.paper,
        fontSize: theme.typography.caption.fontSize,
      }),
    },
  },
  MuiTab: {
    styleOverrides: {
      root: ({ theme }) => ({
        opacity: 0.8,

        "&.Mui-selected": {
          opacity: 1,
        },

        "&:not(.Mui-selected):hover": {
          opacity: 1,
          color: theme.palette.text.primary,
        },
      }),
      selected: {},
    },
  },
  MuiTableCell: {
    styleOverrides: {
      head: {
        fontWeight: 700,
      },
      stickyHeader: ({ theme }) => ({
        backgroundColor: theme.palette.background.paper,
      }),
    },
  },
  MuiTableRow: {
    styleOverrides: {
      root: ({ theme }) => ({
        "&.Mui-disabled": {
          [`.${tableCellClasses.root}`]: {
            color: theme.palette.text.disabled,
          },
        },
      }),
    },
  },
  MuiTabs: {
    styleOverrides: {
      vertical: {
        [`.${tabsClasses.indicator}`]: {
          left: 0,
          right: "auto",
        },
      },
    },
  },
  MuiTextField: {
    defaultProps: {
      variant: "outlined",
      color: "primary",
      slotProps: {
        formHelperText: { variant: "standard" },
      },
    },
  },
  MuiToggleButton: {
    defaultProps: {
      disableRipple: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        "&:active": {
          backgroundColor: alpha(theme.palette.text.primary, theme.palette.action.activatedOpacity),
        },
        "&.Mui-selected:active": {
          backgroundColor: alpha(
            theme.palette.primary.main,
            theme.palette.action.selectedOpacity + theme.palette.action.activatedOpacity,
          ),
        },
      }),
    },
  },
  MuiToolbar: {
    styleOverrides: {
      root: {
        justifyContent: "space-between",
      },
    },
  },
  MuiTooltip: {
    defaultProps: {
      arrow: true,
      slots: { transition: Fade },
    },
    styleOverrides: {
      arrow: ({ theme }) => ({
        color: alpha(theme.palette.grey[700], 0.92),
        backdropFilter: "blur(3px)",
      }),
      tooltip: ({ theme }) => ({
        backgroundColor: alpha(theme.palette.grey[700], 0.92),
        backdropFilter: "blur(3px)",
        fontWeight: "normal",
        fontSize: theme.typography.caption.fontSize,
        borderRadius: theme.shape.borderRadius,
        padding: theme.spacing(0.5, 1),
        boxShadow: "0 4px 12px rgb(0 0 0 / 0.25)",
      }),
    },
  },
  MuiTypography: {
    defaultProps: {
      // Remap typography variants to be <div> elements to
      // avoid triggering react's validateDOMNesting error
      variantMapping: {
        h1: "div",
        h2: "div",
        h3: "div",
        h4: "div",
        h5: "div",
        h6: "div",
        subtitle1: "div",
        subtitle2: "div",
        body1: "div",
        body2: "div",
        inherit: "div",
      },
    },
  },
};
