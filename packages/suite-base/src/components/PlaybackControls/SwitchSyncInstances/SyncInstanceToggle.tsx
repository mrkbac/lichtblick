// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { WindowMultiple20Regular, WindowMultipleOff20Regular } from "@fluentui/react-icons";
import { Tooltip, Typography } from "@mui/material";

import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useWorkspaceStore } from "@lichtblick/suite-base/context/Workspace/WorkspaceContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useOtherTabCount } from "@lichtblick/suite-base/util/broadcast/useOtherTabCount";

function tooltipText({
  syncInstances,
  otherTabs,
}: {
  syncInstances: boolean;
  otherTabs: number | undefined;
}): string {
  if (otherTabs === 0) {
    return "Open Lichtblick in another tab to play, pause and seek both together.";
  }
  const tabs =
    otherTabs == undefined ? "" : ` ${otherTabs} other tab${otherTabs === 1 ? "" : "s"} open.`;
  if (syncInstances) {
    return `Play, pause and seek here are mirrored in other tabs that have sync on.${tabs}`;
  }
  return `Turn on to mirror play, pause and seek in other tabs that have sync on.${tabs}`;
}

const SyncInstanceToggle = (): React.JSX.Element => {
  const syncInstances = useWorkspaceStore((store) => store.playbackControls.syncInstances);
  const otherTabs = useOtherTabCount();

  const {
    playbackControlActions: { setSyncInstances },
  } = useWorkspaceActions();

  const alone = otherTabs === 0;
  const active = syncInstances && !alone;

  return (
    <Tooltip
      title={
        <Stack gap={0.5} paddingY={0.5}>
          <Typography variant="subtitle2">
            {active ? "Playback synced across tabs" : "Sync playback across tabs"}
          </Typography>
          <Typography variant="body2">{tooltipText({ syncInstances, otherTabs })}</Typography>
          {!alone && (
            <Typography variant="caption" color="text.secondary">
              Tabs line up by timestamp, so use recordings from the same time span.
            </Typography>
          )}
        </Stack>
      }
    >
      {/* span so the tooltip still shows while the button is disabled */}
      <span>
        <HoverableIconButton
          size="small"
          aria-label={active ? "Turn off tab sync" : "Turn on tab sync"}
          aria-pressed={syncInstances}
          disabled={alone}
          color={active ? "primary" : "inherit"}
          icon={active ? <WindowMultiple20Regular /> : <WindowMultipleOff20Regular />}
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
