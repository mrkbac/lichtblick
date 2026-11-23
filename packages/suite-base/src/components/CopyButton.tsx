// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Button, ButtonProps, IconButton, IconButtonProps, Tooltip, useTheme } from "@mui/material";
import React, { useCallback, useState, PropsWithChildren } from "react";

import clipboard from "@lichtblick/suite-base/util/clipboard";

function CopyButtonComponent(
  props: PropsWithChildren<{
    getText: () => string;
    size?: "small" | "medium" | "large";
    iconSize?: "small" | "medium";
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

  const iconProps =
    iconSize === "small" ? { style: { fontSize: 16 } } : { fontSize: "small" as const };
  const icon = copied ? (
    <CheckIcon {...iconProps} htmlColor={theme.palette.success.main} />
  ) : (
    <ContentCopyIcon {...iconProps} />
  );

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
          {icon}
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Button
      size={size}
      className={className}
      onClick={handleCopy}
      color={copied ? "success" : color}
      startIcon={icon}
    >
      {children}
    </Button>
  );
}

export default React.memo(CopyButtonComponent);
