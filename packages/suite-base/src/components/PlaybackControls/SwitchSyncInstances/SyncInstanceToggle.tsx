// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { WindowMultiple20Regular, WindowMultipleOff20Regular } from "@fluentui/react-icons";
import { Tooltip, Typography, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useOtherTabCount } from "@lichtblick/suite-base/util/broadcast/useOtherTabCount";

const SyncInstanceToggle = (): React.JSX.Element => {
  const { t } = useTranslation("syncTabs");
  const theme = useTheme();
  const syncInstances = useWorkspaceStore((store) => store.playbackControls.syncInstances);
  const otherTabs = useOtherTabCount();

  const {
    playbackControlActions: { setSyncInstances },
  } = useWorkspaceActions();

  // Alone: keep showing the real setting, but there is nothing to sync with yet.
  const alone = otherTabs === 0;

  let description: string;
  if (alone) {
    description = syncInstances ? t("aloneWhileOn") : t("alone");
  } else {
    description = syncInstances ? t("on") : t("off");
    if (otherTabs != undefined) {
      description += ` ${t("otherTabs", { count: otherTabs })}`;
    }
  }

  return (
    <Tooltip
      title={
        <Stack gap={0.5} paddingY={0.5}>
          <Typography variant="subtitle2">
            {syncInstances ? t("titleOn") : t("titleOff")}
          </Typography>
          <Typography variant="body2">{description}</Typography>
          {!alone && (
            <Typography variant="caption" color="text.secondary">
              {t("timestampHint")}
            </Typography>
          )}
        </Stack>
      }
    >
      {/* aria-disabled, not disabled: the button stays focusable and hoverable, so the tooltip
          explaining why it is unavailable reaches mouse, keyboard and screen-reader users. */}
      <HoverableIconButton
        size="small"
        aria-label={syncInstances ? t("turnOff") : t("turnOn")}
        aria-pressed={syncInstances}
        aria-disabled={alone}
        color={syncInstances ? "primary" : "inherit"}
        style={alone ? { color: theme.palette.text.disabled } : undefined}
        icon={syncInstances ? <WindowMultiple20Regular /> : <WindowMultipleOff20Regular />}
        onClick={() => {
          if (!alone) {
            setSyncInstances(!syncInstances);
          }
        }}
        data-testid="sync-tabs-button"
      />
    </Tooltip>
  );
};

export default SyncInstanceToggle;
