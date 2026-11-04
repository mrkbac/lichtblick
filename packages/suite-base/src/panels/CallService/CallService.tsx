// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ReplayIcon from "@mui/icons-material/Replay";
import UndoIcon from "@mui/icons-material/Undo";
import {
  Button,
  IconButton,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
  inputBaseClasses,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import { MessageEditor } from "@lichtblick/suite-base/components/MessageEditor/MessageEditor";
import {
  isEditedMessage,
  parseMessageJson,
  sampleMessageJson,
  stringifyMessage,
} from "@lichtblick/suite-base/components/MessageEditor/messageJson";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useConfirm } from "@lichtblick/suite-base/hooks/useConfirm";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { useDefaultPanelTitle } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { customTypography } from "@lichtblick/theme";

import { useCallServiceSettings } from "./settings";
import { Config } from "./types";

const MAX_HISTORY = 20;

type Props = {
  config: Config;
  saveConfig: SaveConfig<Config>;
};

/** One service call, kept in the panel's history for the session. */
type CallRecord = {
  id: number;
  serviceName: string;
  request: string;
  startedAt: Date;
  status: "requesting" | "success" | "error";
  latencyMs?: number;
  response?: string;
};

const useStyles = makeStyles<{ buttonColor?: string }>()((theme, { buttonColor }) => {
  const augmentedButtonColor = buttonColor
    ? theme.palette.augmentColor({ color: { main: buttonColor } })
    : undefined;

  return {
    button: {
      backgroundColor: augmentedButtonColor?.main,
      color: augmentedButtonColor?.contrastText,

      "&:hover": {
        backgroundColor: augmentedButtonColor?.dark,
      },
    },
    history: {
      minWidth: 0,
      fontSize: theme.typography.caption.fontSize,
    },
    response: {
      flex: "auto",
      minHeight: 0,

      [`.${inputBaseClasses.root}`]: {
        height: "100%",
        alignItems: "stretch",
        backgroundColor: theme.palette.background.paper,
        padding: theme.spacing(1, 0.5),

        [`.${inputBaseClasses.input}`]: {
          height: "100% !important",
          lineHeight: 1.4,
          fontFamily: customTypography.fontMonospace,
          overflow: "auto !important",
          resize: "none",
        },
      },
    },
  };
});

const selectCallService = (ctx: MessagePipelineContext) => ctx.callService;
const selectServices = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.services;
const selectServiceTypes = (ctx: MessagePipelineContext) =>
  ctx.playerState.activeData?.serviceTypes;

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function recordLabel(record: CallRecord): string {
  const status =
    record.status === "requesting"
      ? "…"
      : record.status === "error"
        ? "failed"
        : `${record.latencyMs ?? 0} ms`;
  return `${formatTime(record.startedAt)} · ${record.serviceName} · ${status}`;
}

export function CallService({ config, saveConfig }: Props): React.JSX.Element {
  const { classes } = useStyles({ buttonColor: config.buttonColor });
  const { datatypes, capabilities } = useDataSourceInfo();
  const callService = useMessagePipeline(selectCallService);
  const servicesWithProviders = useMessagePipeline(selectServices);
  const serviceTypes = useMessagePipeline(selectServiceTypes);
  const [confirm, confirmModal] = useConfirm();
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number>();
  const nextId = useRef(1);

  // Data sources may know services from the node graph, from their types, or both
  const services = useMemo(
    () =>
      [
        ...new Set([...(servicesWithProviders?.keys() ?? []), ...(serviceTypes?.keys() ?? [])]),
      ].sort(),
    [serviceTypes, servicesWithProviders],
  );
  const requestSchemaOf = useCallback(
    (serviceName: string | undefined) =>
      serviceName != undefined ? serviceTypes?.get(serviceName)?.requestSchemaName : undefined,
    [serviceTypes],
  );
  const requestSchema = requestSchemaOf(config.serviceName);

  const confirmReplace = useCallback(
    async (schemaName: string) =>
      (await confirm({
        title: "Replace request?",
        prompt: `The request was edited. Replace it with an empty ${schemaName} template?`,
        ok: "Replace",
        cancel: "Keep request",
      })) === "ok",
    [confirm],
  );

  useCallServiceSettings({
    config,
    saveConfig,
    services,
    datatypes,
    requestSchemaOf,
    confirmReplace,
  });

  // The request type may only become known after the service was picked (e.g. once the data source
  // has looked it up). Fill in the template then, unless the user already typed a request.
  // Fill once per schema, so clearing the request afterwards doesn't bring the template back.
  const filledSchema = useRef<string>();
  useEffect(() => {
    if (requestSchema == undefined || filledSchema.current === requestSchema) {
      return;
    }
    const template = sampleMessageJson(datatypes, requestSchema);
    if (template == undefined) {
      return; // definitions not loaded yet, retry when datatypes change
    }
    filledSchema.current = requestSchema;
    if (!isEditedMessage(config.requestPayload, datatypes, undefined)) {
      saveConfig({ requestPayload: template });
    }
  }, [config.requestPayload, datatypes, requestSchema, saveConfig]);

  const [, setDefaultPanelTitle] = useDefaultPanelTitle();
  useEffect(() => {
    setDefaultPanelTitle(
      config.serviceName ? `Call service ${config.serviceName}` : "Call service",
    );
  }, [config.serviceName, setDefaultPanelTitle]);

  const parsed = useMemo(
    () => parseMessageJson(config.requestPayload ?? ""),
    [config.requestPayload],
  );

  const canCall = capabilities.includes(PLAYER_CAPABILITIES.callServices);
  let statusMessage: string | undefined;
  if (!canCall) {
    statusMessage = "Connect to a data source that supports calling services";
  } else if (!config.serviceName) {
    statusMessage = "Configure a service in the panel settings";
  }

  const runCall = useCallback(
    async (serviceName: string, requestText: string) => {
      const request = parseMessageJson(requestText);
      const id = nextId.current++;
      const startedAt = new Date();
      const update = (patch: Partial<CallRecord>) => {
        setHistory((old) => old.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      };
      setHistory((old) =>
        [
          { id, serviceName, request: requestText, startedAt, status: "requesting" as const },
          ...old,
        ].slice(0, MAX_HISTORY),
      );
      setSelectedId(id);

      if (request.value == undefined) {
        update({ status: "error", response: request.error, latencyMs: 0 });
        return;
      }
      const start = performance.now();
      try {
        const response = await callService(serviceName, request.value);
        update({
          status: "success",
          response: stringifyMessage(response),
          latencyMs: Math.round(performance.now() - start),
        });
      } catch (err) {
        update({
          status: "error",
          response: (err as Error).message,
          latencyMs: Math.round(performance.now() - start),
        });
      }
    },
    [callService],
  );

  const canSend = canCall && Boolean(config.serviceName) && parsed.value != undefined;
  const send = () => {
    if (canSend) {
      void runCall(config.serviceName!, config.requestPayload!);
    }
  };

  const selected = history.find((r) => r.id === selectedId) ?? history[0];

  const requestPane = (
    <Stack flex="1 1 0" overflow="hidden" gap={0.5}>
      <Typography variant="overline" lineHeight={1}>
        Request
      </Typography>
      <MessageEditor
        datatypes={datatypes}
        schemaName={requestSchema}
        value={config.requestPayload ?? ""}
        parsed={parsed}
        onChange={(requestPayload) => {
          saveConfig({ requestPayload });
        }}
        mode={config.editorMode ?? "form"}
        onModeChange={(editorMode) => {
          saveConfig({ editorMode });
        }}
        presets={config.presets ?? []}
        onPresetsChange={(presets) => {
          saveConfig({ presets });
        }}
      />
      {parsed.error != undefined && (
        <Typography variant="caption" noWrap color="error" title={parsed.error}>
          {parsed.error}
        </Typography>
      )}
    </Stack>
  );

  const responsePane = (
    <Stack flex="1 1 0" overflow="hidden" gap={0.5}>
      <Stack direction="row" alignItems="center" gap={0.5}>
        <Typography variant="overline" lineHeight={1} flex="none">
          Response
        </Typography>
        <Stack flex="auto" />
        {selected && (
          <>
            <Select
              size="small"
              variant="standard"
              disableUnderline
              SelectDisplayProps={{ "aria-label": "Call history" }}
              value={selected.id}
              className={classes.history}
              onChange={(event) => {
                setSelectedId(Number(event.target.value));
              }}
            >
              {history.map((record) => (
                <MenuItem key={record.id} value={record.id} dense>
                  <Typography
                    variant="caption"
                    color={record.status === "error" ? "error" : undefined}
                  >
                    {recordLabel(record)}
                  </Typography>
                </MenuItem>
              ))}
            </Select>
            <Tooltip title="Copy this call's request into the editor">
              <IconButton
                size="small"
                aria-label="Restore request"
                onClick={() => {
                  saveConfig({
                    serviceName: selected.serviceName,
                    requestPayload: selected.request,
                  });
                }}
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Call again with this request">
              <span>
                <IconButton
                  size="small"
                  aria-label="Re-run call"
                  disabled={!canCall}
                  onClick={() => void runCall(selected.serviceName, selected.request)}
                >
                  <ReplayIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Stack>
      <TextField
        variant="outlined"
        className={classes.response}
        multiline
        size="small"
        placeholder="Response"
        value={
          selected?.status === "requesting"
            ? `Calling ${selected.serviceName}…`
            : (selected?.response ?? "")
        }
        error={selected?.status === "error"}
        slotProps={{ htmlInput: { readOnly: true } }}
      />
    </Stack>
  );

  return (
    // `display: contents` keeps the layout while catching the call shortcut from any input
    <div
      style={{ display: "contents" }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          send();
        }
      }}
    >
      <Stack fullHeight>
        <PanelToolbar />
        <Stack flex="auto" gap={1} padding={1.5} overflow="hidden">
          <Stack
            flex="auto"
            overflow="hidden"
            gap={1.5}
            direction={config.layout === "horizontal" ? "row" : "column"}
          >
            {requestPane}
            {responsePane}
          </Stack>
          <Stack direction="row" justifyContent="flex-end" alignItems="center" gap={1.5}>
            {statusMessage && (
              <Typography variant="caption" noWrap color="text.secondary">
                {statusMessage}
              </Typography>
            )}
            <Tooltip
              title={
                (config.buttonTooltip ?? "") !== ""
                  ? config.buttonTooltip
                  : canSend
                    ? "Ctrl/Cmd+Enter"
                    : ""
              }
            >
              <span>
                <Button
                  className={classes.button}
                  variant="contained"
                  disabled={!canSend}
                  onClick={send}
                  data-testid="call-service-button"
                >
                  {config.buttonText ?? `Call service ${config.serviceName ?? ""}`}
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Stack>
      {confirmModal}
    </div>
  );
}
