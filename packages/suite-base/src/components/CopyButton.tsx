// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Button,
  ButtonProps,
  IconButton,
  IconButtonProps,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import React, { useCallback, useState, PropsWithChildren, useMemo } from "react";

import clipboard from "@lichtblick/suite-base/util/clipboard";

function CopyButtonComponent(
  props: PropsWithChildren<{
    getText: () => string;
    size?: "small" | "medium" | "large";
    iconSize?: "small" | "medium" | "large";
    color?: ButtonProps["color"];
    className?: string;
    edge?: IconButtonProps["edge"];
    "aria-label"?: string;
    /** Tooltip (and default accessible name) of the icon button. Defaults to "Copy to clipboard". */
    title?: string;
  }>,
): React.JSX.Element {
  const {
    children,
    className,
    color = "primary",
    edge,
    size = "medium",
    iconSize = "medium",
    getText,
    "aria-label": ariaLabel,
    title = "Copy to clipboard",
  } = props;
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const checkIcon = useMemo(() => {
    switch (iconSize) {
      case "small":
        return <CheckIcon style={{ fontSize: 16 }} htmlColor={theme.palette.success.main} />;
      case "medium":
        return <CheckIcon fontSize="small" htmlColor={theme.palette.success.main} />;
      case "large":
        return <CheckIcon htmlColor={theme.palette.success.main} />;
    }
  }, [iconSize, theme.palette.success.main]);

  const copyIcon = useMemo(() => {
    switch (iconSize) {
      case "small":
        return <ContentCopyIcon style={{ fontSize: 16 }} />;
      case "medium":
        return <ContentCopyIcon fontSize="small" />;
      case "large":
        return <ContentCopyIcon />;
    }
  }, [iconSize]);

  const handleCopy = useCallback(() => {
    clipboard
      .copy(getText())
      .then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1500);
      })
      .catch((err: unknown) => {
        console.warn(err);
      });
  }, [getText]);

  if (children == undefined) {
    return (
      <Tooltip arrow title={copied ? "Copied" : title}>
        <IconButton
          edge={edge}
          className={className}
          size={size}
          onClick={handleCopy}
          color={copied ? "success" : color}
          aria-label={ariaLabel ?? title}
        >
          {copied ? checkIcon : copyIcon}
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Button
      size={size}
      className={className}
      onClick={handleCopy}
      color="inherit"
      startIcon={copied ? checkIcon : copyIcon}
    >
      <Typography color={copied ? "textPrimary" : color} variant="body2">
        {children}
      </Typography>
    </Button>
  );
}

export default React.memo(CopyButtonComponent);
