// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import { MessageDefinition } from "@foxglove/message-definition";
import CommonRosTypes from "@foxglove/rosmsg-msgs-common";
import RepeatIcon from "@mui/icons-material/Repeat";
import StopIcon from "@mui/icons-material/Stop";
import { Button, Tooltip, Typography } from "@mui/material";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";

import { Immutable } from "@lichtblick/suite";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import { MessageEditor } from "@lichtblick/suite-base/components/MessageEditor/MessageEditor";
import { parseMessageJson } from "@lichtblick/suite-base/components/MessageEditor/messageJson";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import useCallbackWithToast from "@lichtblick/suite-base/hooks/useCallbackWithToast";
import { useConfirm } from "@lichtblick/suite-base/hooks/useConfirm";
import usePublisher from "@lichtblick/suite-base/hooks/usePublisher";
import { formatTime, useActionButtonStyles } from "@lichtblick/suite-base/panels/shared/actionButton";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { useDefaultPanelTitle } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { ros2CommonDatatypes } from "@lichtblick/suite-base/util/ros2CommonDatatypes";

import { defaultConfig, usePublishPanelSettings } from "./settings";
import { PublishConfig } from "./types";

type Props = {
  config: PublishConfig;
  saveConfig: SaveConfig<PublishConfig>;
};

function selectDataSourceProfile(ctx: MessagePipelineContext) {
  return ctx.playerState.profile;
}

function selectPlayerPresence(ctx: MessagePipelineContext) {
  return ctx.playerState.presence;
}

function Publish(props: Props) {
  const { saveConfig, config } = props;
  const { topics, datatypes: dataSourceDatatypes, capabilities } = useDataSourceInfo();
  const { classes } = useActionButtonStyles({ buttonColor: config.buttonColor });
  const [debouncedTopicName] = useDebounce(config.topicName ?? "", 500);
  const dataSourceProfile = useMessagePipeline(selectDataSourceProfile);
  const presence = useMessagePipeline(selectPlayerPresence);
  const [invalidFieldCount, setInvalidFieldCount] = useState(0);
  const formInvalid = invalidFieldCount > 0;
  const [confirm, confirmModal] = useConfirm();
  const [repeating, setRepeating] = useState(false);
  const [lastPublished, setLastPublished] = useState<Date>();

  const datatypes = useMemo(() => {
    // Add common ROS datatypes, depending on the data source profile. The distro is unknown here;
    // the player's own datatypes (distro-specific for a ROS 2 WebSocket connection) take precedence.
    const commonTypes: Record<string, MessageDefinition> | undefined = {
      ros1: CommonRosTypes.ros1,
      ros2: ros2CommonDatatypes(),
    }[dataSourceProfile ?? ""];

    if (commonTypes == undefined) {
      return dataSourceDatatypes;
    }

    // dataSourceDatatypes is added after commonTypes to take precedence (override) any commonTypes of the same name
    return new Map<string, Immutable<MessageDefinition>>([
      ...Object.entries(commonTypes),
      ...dataSourceDatatypes,
    ]);
  }, [dataSourceProfile, dataSourceDatatypes]);

  const publish = usePublisher({
    name: "Publish",
    topic: debouncedTopicName,
    schemaName: config.datatype,
    datatypes,
  });

  const parsed = useMemo(() => parseMessageJson(config.value ?? ""), [config.value]);

  const confirmReplace = useCallback(
    async (schemaName: string) =>
      (await confirm({
        title: "Replace message?",
        prompt: `The message was edited. Replace it with an empty ${schemaName} template?`,
        ok: "Replace",
        cancel: "Keep message",
      })) === "ok",
    [confirm],
  );

  usePublishPanelSettings(config, saveConfig, topics, datatypes, confirmReplace);

  const canAdvertise = capabilities.includes(PLAYER_CAPABILITIES.advertise);
  const isConfigured = Boolean(config.topicName && config.datatype);
  const canPublish = canAdvertise && isConfigured && parsed.value != undefined && !formInvalid;

  const onPublishClicked = useCallbackWithToast(() => {
    if (!canPublish) {
      // Reached through the keyboard shortcut; the button is disabled in this state
      throw new Error(
        parsed.error ??
          (formInvalid
            ? "Fix the invalid field before publishing"
            : "Configure a topic and message schema before publishing"),
      );
    }
    publish(parsed.value);
    setLastPublished(new Date());
  }, [canPublish, formInvalid, parsed, publish]);

  // Repeated publishing always sends the latest valid message, so edits apply while it runs.
  const latestMessage = useRef(parsed.value);
  useEffect(() => {
    if (parsed.value != undefined) {
      latestMessage.current = parsed.value;
    }
  }, [parsed.value]);
  const publishRepeated = useCallbackWithToast(() => {
    if (!latestMessage.current) {
      return;
    }
    try {
      publish(latestMessage.current);
    } catch (err) {
      setRepeating(false);
      throw err;
    }
  }, [publish]);
  const rate = config.publishRate ?? defaultConfig.publishRate ?? 1;
  // Stops on disconnect: some players keep the advertise capability while reconnecting
  const canRepeat = canAdvertise && isConfigured && rate > 0 && presence === PlayerPresence.PRESENT;
  useEffect(() => {
    // Stop when the data source disconnects or the topic is cleared
    if (repeating && !canRepeat) {
      setRepeating(false);
    }
  }, [canRepeat, repeating]);
  useEffect(() => {
    if (!repeating || !canRepeat) {
      return;
    }
    const interval = setInterval(() => void publishRepeated(), 1000 / rate);
    return () => {
      clearInterval(interval);
    };
  }, [canRepeat, publishRepeated, rate, repeating]);

  const [, setDefaultPanelTitle] = useDefaultPanelTitle();

  useEffect(() => {
    if (config.topicName != undefined && config.topicName.length > 0) {
      setDefaultPanelTitle(`Publish ${config.topicName}`);
    } else {
      setDefaultPanelTitle("Publish");
    }
  }, [config.topicName, setDefaultPanelTitle]);

  let statusMessage: string | undefined;
  if (!canAdvertise) {
    statusMessage = "Connect to a data source that supports publishing";
  } else if (!isConfigured) {
    statusMessage = "Configure a topic and message schema in the panel settings";
  } else if (repeating) {
    statusMessage = `Publishing at ${rate} Hz`;
  } else if (lastPublished) {
    statusMessage = `Published at ${formatTime(lastPublished)}`;
  }
  const error = config.advancedView
    ? (parsed.error ?? (formInvalid ? "Fix the invalid field before publishing" : undefined))
    : undefined;

  return (
    // `display: contents` keeps the layout while catching the publish shortcut from any input
    <div
      className={classes.wrapper}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void onPublishClicked();
        }
      }}
    >
      <Stack fullHeight>
        <PanelToolbar />
        <Stack flex="auto" gap={1} padding={1.5} position="relative" overflow="hidden">
          {config.advancedView && (
            <MessageEditor
              datatypes={datatypes}
              schemaName={config.datatype}
              value={config.value ?? ""}
              parsed={parsed}
              onChange={(value) => {
                saveConfig({ value });
              }}
              mode={config.editorMode ?? "form"}
              onModeChange={(editorMode) => {
                saveConfig({ editorMode });
              }}
              presets={config.presets ?? []}
              onPresetsChange={(presets) => {
                saveConfig({ presets });
              }}
              onInvalidFieldsChange={setInvalidFieldCount}
            />
          )}
          <Stack
            direction={config.advancedView ? "row" : "column-reverse"}
            justifyContent={config.advancedView ? "flex-end" : "center"}
            alignItems="center"
            overflow="hidden"
            flex={config.advancedView ? "none" : "auto"}
            gap={1.5}
          >
            {(error != undefined || statusMessage != undefined) && (
              <Typography
                variant="caption"
                noWrap
                title={error ?? statusMessage}
                color={error ? "error" : "textSecondary"}
              >
                {error ?? statusMessage}
              </Typography>
            )}
            {config.advancedView && (
              <Tooltip title={repeating ? "Stop publishing" : `Publish repeatedly at ${rate} Hz`}>
                <span>
                  <Button
                    variant="outlined"
                    color={repeating ? "error" : "inherit"}
                    disabled={!repeating && !canPublish}
                    startIcon={repeating ? <StopIcon /> : <RepeatIcon />}
                    onClick={() => {
                      setRepeating(!repeating);
                    }}
                  >
                    {repeating ? "Stop" : `${rate} Hz`}
                  </Button>
                </span>
              </Tooltip>
            )}
            <Tooltip
              placement={config.advancedView ? "left" : undefined}
              title={
                (config.buttonTooltip ?? "") !== ""
                  ? config.buttonTooltip
                  : canPublish
                    ? "Ctrl/Cmd+Enter"
                    : ""
              }
            >
              <span>
                <Button
                  className={classes.button}
                  variant="contained"
                  disabled={!canPublish}
                  onClick={onPublishClicked}
                >
                  {config.buttonText}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
        {confirmModal}
      </Stack>
    </div>
  );
}

export default Panel(
  Object.assign(React.memo(Publish), {
    panelType: "Publish",
    defaultConfig,
  }),
);
