// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  alpha,
  iconButtonClasses,
  IconButton,
  Paper,
  PaperProps,
  Popover,
  Tooltip,
} from "@mui/material";
import { ReactNode, useEffect, useState } from "react";
import { makeStyles } from "tss-react/mui";

export const OVERLAY_TOOLBAR_BUTTON_SIZE = 32;

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    flexDirection: "column",
    pointerEvents: "auto",
    // A dark surface over a dark canvas has no shadow to tell it apart; outline it instead.
    ...(theme.palette.mode === "dark" && { border: `1px solid ${theme.palette.divider}` }),
    [`& .${iconButtonClasses.root}`]: {
      width: OVERLAY_TOOLBAR_BUTTON_SIZE,
      height: OVERLAY_TOOLBAR_BUTTON_SIZE,
      padding: theme.spacing(0.75),
      [`&[aria-pressed=true]:not(.${iconButtonClasses.disabled})`]: {
        color: theme.palette.primary.main,
        backgroundColor: alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity),
        "&:hover": {
          backgroundColor: alpha(
            theme.palette.primary.main,
            theme.palette.action.selectedOpacity + theme.palette.action.hoverOpacity,
          ),
        },
      },
    },
  },
  popup: { flexDirection: "row", marginLeft: -4 },
}));

/** Floating panel controls share a surface and fixed-size buttons, including text icons. */
export default function OverlayToolbar(props: PaperProps): React.JSX.Element {
  const { classes, cx } = useStyles();
  return (
    <Paper {...props} square={false} elevation={4} className={cx(classes.root, props.className)} />
  );
}

/** True while `element` is shorter than `minHeight` pixels. */
export function useIsShorterThan(element: Element | null | undefined, minHeight: number): boolean {
  const [shorter, setShorter] = useState(false);
  useEffect(() => {
    if (!element) {
      return;
    }
    const Observer = element.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(([entry]) => {
      if (entry) {
        setShorter(entry.contentRect.height < minHeight);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, minHeight]);
  return shorter;
}

/**
 * Buttons inside an OverlayToolbar that fold into one button with a pop-up when `collapsed`, so
 * small panels keep their canvas. Clicking a button in the pop-up closes it.
 */
export function OverlayToolGroup(props: {
  collapsed: boolean;
  /** Names the folded button. */
  label: string;
  /** Shown on the folded button, e.g. the active tool's icon. */
  icon: ReactNode;
  /** Marks the folded button as pressed, e.g. while one of its tools is on. */
  active?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const { collapsed, label, icon, active = false, children } = props;
  const { classes, cx } = useStyles();
  const [anchor, setAnchor] = useState<HTMLElement>();
  if (!collapsed) {
    // The folded button is gone; don't reopen against it on the next fold.
    if (anchor) {
      setAnchor(undefined);
    }
    return <>{children}</>;
  }
  return (
    <>
      <Tooltip title={label} placement="left">
        <IconButton
          size="small"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={anchor != undefined}
          aria-pressed={active}
          onClick={(event) => {
            setAnchor(event.currentTarget);
          }}
        >
          {icon}
        </IconButton>
      </Tooltip>
      <Popover
        open={anchor != undefined}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(undefined);
        }}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            className: cx(classes.root, classes.popup),
            elevation: 4,
            role: "dialog",
            "aria-label": label,
            onClick: (event: React.MouseEvent) => {
              // No instanceof: a popped-out panel's elements come from another window.
              if ((event.target as Partial<Element>).closest?.("button")) {
                setAnchor(undefined);
              }
            },
          },
        }}
      >
        {children}
      </Popover>
    </>
  );
}
