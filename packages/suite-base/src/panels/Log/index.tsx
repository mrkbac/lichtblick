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

import {
  ArrowDown16Regular,
  ArrowUp16Regular,
  Copy20Filled,
  TextCaseTitle16Regular,
} from "@fluentui/react-icons";
import { Divider, IconButton, LinearProgress, Tooltip, Typography } from "@mui/material";
import { produce } from "immer";
import * as _ from "lodash-es";
import { useSnackbar } from "notistack";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useDeepMemo } from "@lichtblick/hooks";
import { SettingsTreeAction, Time } from "@lichtblick/suite";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import {
  MessagePipelineContext,
  useMessagePipeline,
  useMessagePipelineGetter,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import ToolbarIconButton from "@lichtblick/suite-base/components/PanelToolbar/ToolbarIconButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks/useAppTimeFormat";
import { FilterTagInput } from "@lichtblick/suite-base/panels/Log/FilterTagInput";
import formatMessages from "@lichtblick/suite-base/panels/Log/formatMessages";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import clipboard from "@lichtblick/suite-base/util/clipboard";

import LogList, { LogListApi, LogListProps } from "./LogList";
import { SeverityTimeline } from "./SeverityTimeline";
import { SUPPORTED_DATATYPES } from "./conversion";
import filterMessages, { compileSearch } from "./filterMessages";
import { buildSettingsTree, isTopicVisible } from "./settings";
import { findLevel, lastIndexAtOrBefore } from "./timeIndex";
import { Config, LogLevel, NormalizedLogMessage } from "./types";
import { useLogMessages } from "./useLogMessages";

export function createActionHandler(
  saveConfig: SaveConfig<Config>,
  seenNodeNames: ReadonlySet<string>,
  availableTopics: readonly string[] = [],
): (action: SettingsTreeAction) => void {
  // Turn the implicit topic selection (all, or legacy `topicToRender`) into explicit settings
  const materializeTopics = (draft: Config, { visible }: { visible?: boolean } = {}) => {
    const topics = { ...draft.topics };
    for (const topic of availableTopics) {
      topics[topic] = { visible: visible ?? isTopicVisible(draft, topic) };
    }
    draft.topics = topics;
    delete draft.topicToRender;
  };

  return (action: SettingsTreeAction) => {
    if (action.action === "update") {
      const { path, value } = action.payload;
      saveConfig(
        produce<Config>((draft) => {
          if (path[0] === "topics") {
            materializeTopics(draft);
            _.set(draft, path, value);
          } else {
            _.set(draft, path[0] === "nameFilter" ? path : path.slice(1), value);
          }
        }),
      );
      return;
    }

    if (action.action !== "perform-node-action") {
      return;
    }

    if (!["show-all", "hide-all"].includes(action.payload.id)) {
      return;
    }

    const visible = action.payload.id === "show-all";
    if (action.payload.path[0] === "topics") {
      saveConfig(
        produce<Config>((draft) => {
          materializeTopics(draft, { visible });
        }),
      );
      return;
    }
    saveConfig(
      produce<Config>((draft) => {
        const newNameFilter = Object.fromEntries(
          Object.entries(draft.nameFilter ?? {}).map(([k, _v]) => [k, { visible }]),
        );
        seenNodeNames.forEach((name) => (newNameFilter[name] = { visible }));
        return _.set(draft, ["nameFilter"], newNameFilter);
      }),
    );
  };
}

type Props = {
  config: Config;
  saveConfig: SaveConfig<Config>;
};

const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;

/** Subscribes to the playhead so that the panel itself doesn't re-render every frame. */
function PlayheadLogList(props: Omit<LogListProps, "currentTime">): React.JSX.Element {
  const currentTime = useMessagePipeline(selectCurrentTime);
  // Without seeking (live data) the newest message is the playhead
  return <LogList {...props} currentTime={props.onSeek ? currentTime : undefined} />;
}

function ToggleButton(props: {
  title: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip title={props.title}>
      <IconButton
        size="small"
        color={props.active ? "primary" : "default"}
        aria-pressed={props.active}
        aria-label={props.title}
        onClick={props.onClick}
      >
        {props.children}
      </IconButton>
    </Tooltip>
  );
}

const LogPanel = React.memo(({ config, saveConfig }: Props) => {
  const { enqueueSnackbar } = useSnackbar();
  const { topics } = useDataSourceInfo();
  const { minLogLevel, searchTerms, nameFilter, regex = false, caseSensitive = false } = config;
  const { timeZone } = useAppTimeFormat();
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("log");
  const seekPlayback = useMessagePipeline(selectSeek);
  const getMessagePipeline = useMessagePipelineGetter();
  const listApi = useRef<LogListApi>(ReactNull);

  const availableTopics = useMemo(
    () =>
      topics
        .filter(
          (topic) => topic.schemaName != undefined && SUPPORTED_DATATYPES.has(topic.schemaName),
        )
        .map((topic) => topic.name),
    [topics],
  );

  const visibleTopics = useMemo(
    () => availableTopics.filter((topic) => isTopicVisible(config, topic)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableTopics, config.topics, config.topicToRender],
  );

  const { items, loading } = useLogMessages(visibleTopics);

  // Node names of all loaded messages, plus any the user configured. Deep-memoized so live
  // data doesn't rebuild the settings tree for every message.
  const sortedNodeNames = useDeepMemo(
    useMemo(() => {
      const names = new Set<string>(Object.keys(nameFilter ?? {}));
      for (const item of items) {
        if (item.name != undefined) {
          names.add(item.name);
        }
      }
      return [...names].sort();
    }, [items, nameFilter]),
  );
  const seenNodeNames = useMemo(() => new Set(sortedNodeNames), [sortedNodeNames]);

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler: createActionHandler(saveConfig, seenNodeNames, availableTopics),
      enableFilter: true,
      nodes: buildSettingsTree(config, availableTopics, sortedNodeNames, t),
    });
  }, [
    availableTopics,
    config,
    saveConfig,
    seenNodeNames,
    sortedNodeNames,
    updatePanelSettingsTree,
    t,
  ]);

  const search = useMemo(
    () => compileSearch(searchTerms, { regex, caseSensitive }),
    [searchTerms, regex, caseSensitive],
  );

  const filteredItems = useMemo(
    () =>
      filterMessages(items, {
        minLogLevel,
        search,
        nameFilter: nameFilter ?? {},
      }),
    [items, minLogLevel, search, nameFilter],
  );

  const copy = useCallback(
    async (lines: string[]) => {
      if (lines.length === 0) {
        enqueueSnackbar(t("nothingToCopy"), { variant: "warning" });
        return;
      }
      try {
        await clipboard.copy(lines.join("\n"));
        enqueueSnackbar(t("logsCopied"), { variant: "success" });
      } catch (error) {
        console.warn(error);
      }
    },
    [enqueueSnackbar, t],
  );

  const copyRow = useCallback(
    (item: NormalizedLogMessage) => {
      void copy(formatMessages([item], timeZone));
    },
    [copy, timeZone],
  );

  // Time of the last jump target when seeking isn't possible (live data)
  const jumpAnchor = useRef<Time | undefined>(undefined);

  // Seek, or for sources that can't seek, scroll to the matching row
  const goTo = useCallback(
    (time: Time, index = lastIndexAtOrBefore(filteredItems, time)) => {
      if (seekPlayback) {
        listApi.current?.follow();
        seekPlayback(time);
      } else {
        jumpAnchor.current = time;
        listApi.current?.scrollToIndex(Math.max(index, 0));
      }
    },
    [filteredItems, seekPlayback],
  );

  const jump = useCallback(
    (direction: 1 | -1) => {
      const anchor = seekPlayback
        ? getMessagePipeline().playerState.activeData?.currentTime ?? undefined
        : jumpAnchor.current;
      const index = findLevel(filteredItems, anchor, direction, LogLevel.WARN);
      const target = filteredItems[index];
      if (target) {
        goTo(target.receiveTime, index);
      }
    },
    [filteredItems, getMessagePipeline, goTo, seekPlayback],
  );

  const hasProblems = useMemo(
    () => filteredItems.some((item) => item.level >= LogLevel.WARN),
    [filteredItems],
  );

  const onFilterChange = useCallback(
    (newTerms: string[]) => {
      saveConfig({ searchTerms: newTerms });
    },
    [saveConfig],
  );

  const searchError =
    search.invalidTerms.length > 0
      ? t("invalidRegex", { terms: search.invalidTerms.join(", ") })
      : undefined;

  return (
    <Stack fullHeight data-testid="log-panel-root">
      <PanelToolbar
        additionalIcons={
          <ToolbarIconButton
            title={t("copyLogs")}
            onClick={() => void copy(formatMessages(filteredItems, timeZone))}
          >
            <Copy20Filled />
          </ToolbarIconButton>
        }
      />
      <Stack direction="row" flexGrow={0} padding={0.5} gap={0.25} alignItems="center">
        <FilterTagInput
          items={searchTerms}
          suggestions={sortedNodeNames}
          onChange={onFilterChange}
          error={searchError}
        />
        <ToggleButton
          title={t("matchCase")}
          active={caseSensitive}
          onClick={() => {
            saveConfig({ caseSensitive: !caseSensitive });
          }}
        >
          <TextCaseTitle16Regular />
        </ToggleButton>
        <ToggleButton
          title={t("useRegex")}
          active={regex}
          onClick={() => {
            saveConfig({ regex: !regex });
          }}
        >
          <Typography variant="caption" fontFamily="monospace" lineHeight={1}>
            .*
          </Typography>
        </ToggleButton>
        <Tooltip title={t("previousProblem")}>
          <span>
            <IconButton
              size="small"
              aria-label={t("previousProblem")}
              disabled={!hasProblems}
              onClick={() => {
                jump(-1);
              }}
            >
              <ArrowUp16Regular />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("nextProblem")}>
          <span>
            <IconButton
              size="small"
              aria-label={t("nextProblem")}
              disabled={!hasProblems}
              onClick={() => {
                jump(1);
              }}
            >
              <ArrowDown16Regular />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          flex="none"
          data-testid="log-count"
        >
          {filteredItems.length === items.length
            ? items.length.toLocaleString()
            : `${filteredItems.length.toLocaleString()} / ${items.length.toLocaleString()}`}
        </Typography>
      </Stack>
      <SeverityTimeline items={filteredItems} onSeek={goTo} />
      {loading ? <LinearProgress style={{ height: 2 }} /> : <Divider />}
      <Stack flexGrow={1}>
        <PlayheadLogList
          items={filteredItems}
          onSeek={seekPlayback ? goTo : undefined}
          onCopy={copyRow}
          apiRef={listApi}
        />
      </Stack>
    </Stack>
  );
});

LogPanel.displayName = "Log";

const defaultConfig: Config = { searchTerms: [], minLogLevel: 1 };

export default Panel(
  Object.assign(LogPanel, {
    defaultConfig,
    panelType: "RosOut", // The legacy RosOut name is used for backwards compatibility
  }),
);
