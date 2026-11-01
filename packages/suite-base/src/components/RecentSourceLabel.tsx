// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Pin16Filled } from "@fluentui/react-icons";
import { Tooltip, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import { BuiltinIcon } from "@lichtblick/suite-base/components/BuiltinIcon";
import { useStyles } from "@lichtblick/suite-base/components/RecentSourceLabel.style";
import {
  RecentSource,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { formatTimeAgo, splitRecentTitle } from "@lichtblick/suite-base/util/recentSources";

type Props = {
  recent: RecentSource;
  /** Hide the pinned indicator, e.g. when a pin toggle is rendered next to the label */
  hidePinIndicator?: boolean;
};

/** Icon, identifying name and details (source type, location, last opened) for a recent source */
export function RecentSourceLabel({ recent, hidePinIndicator = false }: Props): React.JSX.Element {
  const { classes } = useStyles();
  const { i18n } = useTranslation();
  const { availableSources } = usePlayerSelection();

  const source = availableSources.find(
    (s) => s.id === recent.sourceId || (s.legacyIds?.includes(recent.sourceId ?? "") ?? false),
  );
  const { primary, location } = splitRecentTitle(recent.title);
  const secondary = [
    recent.label ?? source?.displayName,
    recent.lastOpened != undefined
      ? formatTimeAgo(recent.lastOpened, Date.now(), i18n.language)
      : undefined,
    location,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Tooltip title={recent.title} placement="top-start" enterDelay={500} disableInteractive>
      <div className={classes.root}>
        <span className={classes.icon}>
          <BuiltinIcon name={source?.iconName ?? (recent.type === "file" ? "OpenFile" : "Flow")} />
        </span>
        <div className={classes.text}>
          <Typography variant="body2" noWrap>
            {primary}
          </Typography>
          {secondary !== "" && (
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {secondary}
            </Typography>
          )}
        </div>
        {recent.pinned === true && !hidePinIndicator && <Pin16Filled className={classes.pin} />}
      </div>
    </Tooltip>
  );
}
