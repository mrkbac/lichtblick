// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import PushPinIcon from "@mui/icons-material/PushPin";
import { Tooltip, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/RecentSourceLabel.style";
import {
  RecentSource,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import ICONS from "@lichtblick/suite-base/theme/icons";
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
          {ICONS[source?.iconName ?? (recent.type === "file" ? "OpenFile" : "Flow")]}
        </span>
        <div className={classes.text}>
          <Typography variant="body2" noWrap>
            {recent.name ?? primary}
          </Typography>
          {secondary !== "" && (
            <Typography variant="caption" noWrap component="div" color="textSecondary">
              {secondary}
            </Typography>
          )}
        </div>
        {recent.pinned === true && !hidePinIndicator && (
          <PushPinIcon style={{ fontSize: 16 }} className={classes.pin} />
        )}
      </div>
    </Tooltip>
  );
}
