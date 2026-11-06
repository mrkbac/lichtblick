// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromSec } from "@foxglove/rostime";
import { IconButton, ListItem, ListItemButton, ListItemText, Typography } from "@mui/material";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import PublishPointIcon from "@lichtblick/suite-base/components/PublishPointIcon";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { DiagnosticInfo } from "@lichtblick/suite-base/panels/DiagnosticStatus/types";
import { useStyles } from "@lichtblick/suite-base/panels/DiagnosticSummary/DiagnosticSummary.style";
import DiagnosticTimeline from "@lichtblick/suite-base/panels/DiagnosticSummary/DiagnosticTimeline";
import {
  LEVEL_NAMES,
  MESSAGE_COLORS,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";
import { TimelineRange } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticsPanelData";
import {
  CheckHistory,
  formatElapsed,
  levelAt,
} from "@lichtblick/suite-base/panels/DiagnosticSummary/utils/history";

export type NodeRowProps = {
  info: DiagnosticInfo;
  isPinned: boolean;
  onClick: (info: DiagnosticInfo) => void;
  onClickPin: (info: DiagnosticInfo) => void;
  history?: CheckHistory;
  range?: TimelineRange;
  staleSec?: number;
  showHistory?: boolean;
  onSeek?: (seconds: number) => void;
};

/** How long the check has been in its current level, if the history agrees with it. */
export function useLevelSince(
  info: DiagnosticInfo,
  history: CheckHistory | undefined,
  range: TimelineRange | undefined,
  staleSec: number,
): { text: string; title: string } | undefined {
  const { t } = useTranslation("diagnostics");
  const { formatTime } = useAppTimeFormat();
  const current = range?.current;
  if (!history || current == undefined) {
    return undefined;
  }
  const since = levelAt(history, current, staleSec);
  if (since?.level !== info.status.level) {
    return undefined;
  }
  return {
    text: formatElapsed(current - since.t),
    title: t("levelSince", {
      level: LEVEL_NAMES[since.level]?.toUpperCase() ?? since.level,
      time: formatTime(fromSec(since.t)),
    }),
  };
}

function DiagnosticNodeRow(props: Readonly<NodeRowProps>) {
  const {
    info,
    isPinned,
    onClick,
    onClickPin,
    history,
    range,
    staleSec = 0,
    showHistory = false,
    onSeek,
  } = props;
  const { classes } = useStyles();
  const levelSince = useLevelSince(info, history, range, staleSec);

  const handleClick = useCallback(() => {
    onClick(info);
  }, [onClick, info]);

  const handleClickPin = useCallback(() => {
    onClickPin(info);
  }, [onClickPin, info]);

  return (
    <ListItem dense disablePadding data-testid="diagnostic-row">
      <ListItemButton
        className={classes.listItemButton}
        disableGutters
        onClick={handleClick}
        data-testid="diagnostic-row-button"
      >
        <IconButton
          size="small"
          onClick={(event) => {
            handleClickPin();
            event.stopPropagation();
          }}
          style={isPinned ? { visibility: "visible" } : undefined}
          data-testid="diagnostic-row-icon"
        >
          <PublishPointIcon fontSize="small" color={isPinned ? "inherit" : "disabled"} />
        </IconButton>
        <ListItemText
          primary={info.displayName}
          secondary={info.status.message}
          slotProps={{
            secondary: {
              color: MESSAGE_COLORS[info.status.level],
            },
          }}
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        />
        {levelSince && (
          <Typography
            variant="caption"
            className={classes.levelSince}
            title={levelSince.title}
            data-testid="diagnostic-row-level-since"
            color="textSecondary"
          >
            {levelSince.text}
          </Typography>
        )}
        {showHistory && range && (
          <DiagnosticTimeline
            history={history}
            start={range.start}
            end={range.end}
            current={range.current}
            staleSec={staleSec}
            width="30%"
            onSeek={onSeek}
          />
        )}
      </ListItemButton>
    </ListItem>
  );
}

export default React.memo(DiagnosticNodeRow);
