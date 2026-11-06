// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  ErrorCircle20Regular,
  Speaker220Regular,
  SpeakerMute20Regular,
} from "@fluentui/react-icons";
import { subtract, toSec } from "@foxglove/rostime";
import { Button, IconButton, Slider, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "tss-react";
import { makeStyles } from "tss-react/mui";

import { useShallowMemo } from "@lichtblick/hooks";
import { SettingsTreeAction } from "@lichtblick/suite";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
  useMessagePipelineSubscribe,
} from "@lichtblick/suite-base/components/MessagePipeline";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  useDefaultPanelTitle,
  usePanelSettingsTreeUpdate,
} from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { randomUUID } from "@lichtblick/suite-base/util/randomUUID";

import { AudioPlayer } from "./AudioPlayer";
import { Waveform } from "./Waveform";
import { AUDIO_SCHEMAS, extractAudioChunk } from "./decode";
import { buildSettingsTree, FORMAT_LABELS, settingsUpdate } from "./settings";
import { AudioConfig } from "./types";

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;

const useStyles = makeStyles()((theme) => ({
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(1),
    backgroundColor: theme.palette.background.paper,
    opacity: 0,
    // Playing resumes the audio clock within a few ms; only show this when the browser blocks it
    animation: `${fadeIn} 0.15s ease 0.4s forwards`,
  },
}));

const selectSetSubscriptions = (ctx: MessagePipelineContext) => ctx.setSubscriptions;

type Props = {
  config: AudioConfig;
  saveConfig: SaveConfig<AudioConfig>;
};

export function Audio({ config, saveConfig }: Props): React.JSX.Element {
  const { t } = useTranslation("audio");
  const { classes } = useStyles();
  const { topics } = useDataSourceInfo();
  const audioTopics = useMemo(
    () =>
      topics
        .filter((topic) => topic.schemaName != undefined && AUDIO_SCHEMAS.has(topic.schemaName))
        .map((topic) => topic.name),
    [topics],
  );
  const topic = config.topic ?? audioTopics[0];
  const schemaName = topics.find((info) => info.name === topic)?.schemaName;

  const [player, setPlayer] = useState<AudioPlayer>();
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [info, setInfo] = useState<string>();
  const [error, setError] = useState<string>();
  const webAudio = typeof AudioContext !== "undefined";

  useEffect(() => {
    if (!webAudio) {
      return;
    }
    const newPlayer = new AudioPlayer();
    newPlayer.onStateChange = () => {
      setRunning(newPlayer.isRunning());
    };
    newPlayer.onError = setError;
    setPlayer(newPlayer);
    return () => {
      newPlayer.close();
    };
  }, [webAudio]);

  useEffect(() => {
    player?.setVolume(config.muted ? 0 : config.volume);
  }, [player, config.muted, config.volume]);

  // Settings and title
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler: (action: SettingsTreeAction) => {
        const update = settingsUpdate(action);
        if (update) {
          saveConfig(update);
        }
      },
      nodes: buildSettingsTree(config, topic, audioTopics, t),
    });
  }, [audioTopics, config, saveConfig, t, topic, updatePanelSettingsTree]);
  const [, setDefaultPanelTitle] = useDefaultPanelTitle();
  useEffect(() => {
    setDefaultPanelTitle(topic);
  }, [setDefaultPanelTitle, topic]);

  // Subscribe
  const [subscriberId] = useState(() => randomUUID());
  const setSubscriptions = useMessagePipeline(selectSetSubscriptions);
  useEffect(() => {
    setSubscriptions(subscriberId, topic ? [{ topic, preloadType: "partial" }] : []);
  }, [setSubscriptions, subscriberId, topic]);
  useEffect(
    () => () => {
      setSubscriptions(subscriberId, []);
    },
    [setSubscriptions, subscriberId],
  );

  // Feed messages to the player without re-rendering the panel every frame
  const overrides = useShallowMemo({
    format: config.format,
    sampleRate: config.sampleRate,
    channels: config.channels,
  });
  const subscribePipeline = useMessagePipelineSubscribe();
  const getPipeline = useMessagePipelineGetter();
  useEffect(() => {
    setInfo(undefined);
    setError(undefined);
    if (!player || topic == undefined) {
      return;
    }
    player.cut();
    let prev: { events?: unknown; seek?: number; playing?: boolean } = {};
    const onPipelineState = (ctx: MessagePipelineContext) => {
      const active = ctx.playerState.activeData;
      const isPlaying = active?.isPlaying ?? false;
      if (isPlaying !== prev.playing) {
        if (isPlaying) {
          player.resume();
        } else {
          player.suspend();
        }
        setPlaying(isPlaying);
      }
      if (active?.lastSeekTime !== prev.seek) {
        player.cut();
      }
      const events = ctx.messageEventsBySubscriberId.get(subscriberId);
      const isNew = events != undefined && events !== prev.events;
      prev = { events, seek: active?.lastSeekTime, playing: isPlaying };
      if (!isNew || !active) {
        return;
      }
      for (const event of events) {
        if (event.topic !== topic) {
          continue;
        }
        const chunk = extractAudioChunk(event.message, overrides);
        if ("error" in chunk) {
          setError(chunk.error);
          continue;
        }
        setInfo(
          `${FORMAT_LABELS[chunk.format]} · ${chunk.sampleRate / 1000} kHz · ${chunk.channels} ch`,
        );
        if (isPlaying) {
          player.push(chunk, toSec(subtract(active.currentTime, event.receiveTime)), active.speed);
        }
      }
    };
    onPipelineState(getPipeline());
    return subscribePipeline(onPipelineState);
  }, [getPipeline, overrides, player, subscribePipeline, subscriberId, topic]);

  const toggleMute = () => {
    saveConfig({ muted: !config.muted });
  };

  let body: React.ReactNode;
  if (!webAudio) {
    body = <EmptyState>{t("noWebAudio")}</EmptyState>;
  } else if (topic == undefined) {
    body = <EmptyState>{t("noTopic")}</EmptyState>;
  } else {
    body = (
      <Stack flex="auto" position="relative" overflow="hidden">
        <Waveform player={player} />
        {error == undefined && info == undefined && (
          <Stack
            position="absolute"
            style={{ inset: 0 }}
            alignItems="center"
            justifyContent="center"
          >
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              {t("waiting", { topic })}
            </Typography>
          </Stack>
        )}
        {playing && !running && (
          <div className={classes.overlay}>
            <Button variant="contained" onClick={() => player?.resume()}>
              {t("enableAudio")}
            </Button>
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
              }}
            >
              {t("enableAudioHint")}
            </Typography>
          </div>
        )}
      </Stack>
    );
  }

  return (
    <Stack fullHeight>
      <PanelToolbar />
      {body}
      <Stack direction="row" alignItems="center" gap={1} paddingX={1} paddingY={0.5}>
        <Tooltip title={config.muted ? t("unmute") : t("mute")}>
          <IconButton
            size="small"
            aria-label={config.muted ? t("unmute") : t("mute")}
            aria-pressed={config.muted}
            onClick={toggleMute}
          >
            {config.muted ? <SpeakerMute20Regular /> : <Speaker220Regular />}
          </IconButton>
        </Tooltip>
        <Slider
          size="small"
          aria-label={t("volume")}
          min={0}
          max={1}
          step={0.01}
          value={config.volume}
          disabled={config.muted}
          onChange={(_event, value) => {
            saveConfig({ volume: value });
          }}
          style={{ maxWidth: 120, flexShrink: 0 }}
        />
        <Typography
          variant="caption"
          color={error == undefined ? "text.secondary" : "error"}
          noWrap
          title={error ?? info}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            minWidth: 0,
          }}
        >
          {error != undefined && <ErrorCircle20Regular style={{ flexShrink: 0 }} />}
          {error ?? [schemaName, info].filter(Boolean).join(" · ")}
        </Typography>
      </Stack>
    </Stack>
  );
}
