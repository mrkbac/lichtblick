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

import { Copy16Regular } from "@fluentui/react-icons";
import * as _ from "lodash-es";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import useLogStyles from "@lichtblick/suite-base/panels/Log/useLogStyles";
import { TimeDisplayMethod } from "@lichtblick/suite-base/types/panels";
import { customTypography } from "@lichtblick/theme";

import LevelToString from "./LevelToString";
import Stamp from "./Stamp";
import { NormalizedLogMessage } from "./types";

const useStyles = makeStyles()((theme) => ({
  root: {
    position: "relative",
    // Subsequent lines are indented bu using left padding, so we undo the padding for the first line
    // with textIndent
    textIndent: -20,
    paddingLeft: 20,
    paddingRight: 20,
    whiteSpace: "pre-wrap",
    paddingTop: 1,
    paddingBottom: 1,
    lineHeight: 1,
    fontFamily: customTypography.fontMonospace,
    wordBreak: "break-word",
    borderLeft: "2px solid transparent",

    "&:hover": {
      backgroundColor: theme.palette.action.hover,
    },
    "&:hover .copy-button": {
      visibility: "visible",
    },
  },
  seekable: {
    cursor: "pointer",
  },
  current: {
    backgroundColor: theme.palette.action.selected,
    borderLeftColor: theme.palette.primary.main,
  },
  future: {
    opacity: 0.5,
  },
  copyButton: {
    visibility: "hidden",
    position: "absolute",
    top: 0,
    right: 2,
    textIndent: 0,
    padding: 0,
    border: "none",
    background: "none",
    color: theme.palette.text.secondary,
    cursor: "pointer",
    lineHeight: 0,

    "&:hover": {
      color: theme.palette.text.primary,
    },
  },
}));

export default React.memo(function LogMessage(props: {
  value: NormalizedLogMessage;
  timestampFormat: TimeDisplayMethod;
  timeZone: string | undefined;
  /** Row nearest the playhead */
  current?: boolean;
  /** Row after the playhead */
  future?: boolean;
  onClick?: (value: NormalizedLogMessage) => void;
  onCopy?: (value: NormalizedLogMessage) => void;
}) {
  const { value: msg, timestampFormat, timeZone, current, future, onClick, onCopy } = props;

  const { classes, cx } = useStyles();
  const { classes: logClasses } = useLogStyles();
  const { t } = useTranslation("log");

  const strLevel = LevelToString(msg.level);
  const stamp = msg.stamp;

  // the first message line is rendered with the info/stamp/name
  // following newlines are rendered on their own line
  const lines = msg.message.split("\n");

  return (
    <div
      className={cx(classes.root, {
        [logClasses.fatal]: strLevel === "FATAL",
        [logClasses.error]: strLevel === "ERROR",
        [logClasses.warn]: strLevel === "WARN",
        [logClasses.info]: strLevel === "INFO",
        [logClasses.debug]: strLevel === "DEBUG",
        [classes.seekable]: onClick != undefined,
        [classes.current]: current === true,
        [classes.future]: future === true,
      })}
      onClick={
        onClick
          ? () => {
              // Don't seek when the user is selecting text
              if (window.getSelection()?.isCollapsed !== false) {
                onClick(msg);
              }
            }
          : undefined
      }
    >
      <div>
        <span>[{_.padStart(strLevel, 5, " ")}]</span>
        <span>
          [
          <Stamp stamp={stamp} timestampFormat={timestampFormat} timeZone={timeZone} />]
        </span>
        {msg.name != undefined && <span>[{msg.name}]:</span>}
        <span>&nbsp;</span>
        <span>{lines[0]}</span>
      </div>
      {/* extra lines */}
      <div>
        {/* using array index as key is desired here since the index does not change */}
        {lines.slice(1).map((line, idx) => {
          return (
            <div key={idx}>
              &nbsp;&nbsp;&nbsp;&nbsp;
              {line}
            </div>
          );
        })}
      </div>
      {onCopy && (
        <button
          type="button"
          className={cx(classes.copyButton, "copy-button")}
          title={t("copyMessage")}
          aria-label={t("copyMessage")}
          onClick={(event) => {
            event.stopPropagation();
            onCopy(msg);
          }}
        >
          <Copy16Regular />
        </button>
      )}
    </div>
  );
});
