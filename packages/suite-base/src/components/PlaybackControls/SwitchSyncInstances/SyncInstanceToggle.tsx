// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { WindowMultiple20Regular, WindowMultipleOff20Regular } from "@fluentui/react-icons";
import { Tooltip, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useOtherTabCount } from "@lichtblick/suite-base/util/broadcast/useOtherTabCount";

const SyncInstanceToggle = (): React.JSX.Element => {
  const { t } = useTranslation("syncTabs");
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
      {/* span so the tooltip still shows (on hover and keyboard focus) while the button is disabled */}
      <span tabIndex={alone ? 0 : undefined}>
        <HoverableIconButton
          size="small"
          aria-label={syncInstances ? t("turnOff") : t("turnOn")}
          aria-pressed={syncInstances}
          disabled={alone}
          color={syncInstances ? "primary" : "inherit"}
          icon={syncInstances ? <WindowMultiple20Regular /> : <WindowMultipleOff20Regular />}
          onClick={() => {
            setSyncInstances(!syncInstances);
          }}
          data-testid="sync-tabs-button"
        />
      </span>
    </Tooltip>
  );
};

export default SyncInstanceToggle;
