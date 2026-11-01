// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChevronDown12Filled, ChevronRight12Filled, Warning16Filled } from "@fluentui/react-icons";
import { Tooltip } from "@mui/material";
import { memo, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { toSec } from "@lichtblick/rostime";
import { Immutable } from "@lichtblick/suite";
import {
  useBlocksSubscriptions,
  useDataSourceInfo,
  useMessageReducer,
} from "@lichtblick/suite-base/PanelAPI";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { MessageEvent, SubscribePayload } from "@lichtblick/suite-base/players/types";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { useStyles } from "./TransformTree.style";
import { isStaticTopic, isTransformSchema, quaternionToRpy } from "./transforms";
import { addTransformEvents, buildRows, mergeEntries } from "./tree";
import { FrameEntries, FrameRow, TransformTreeConfig } from "./types";

type Props = {
  config: TransformTreeConfig;
  saveConfig: SaveConfig<TransformTreeConfig>;
};

const EMPTY_ENTRIES: FrameEntries = new Map();

const restoreEntries = (prev: FrameEntries | undefined): FrameEntries => prev ?? EMPTY_ENTRIES;
const addEntries = (prev: FrameEntries, events: Immutable<MessageEvent[]>): FrameEntries =>
  addTransformEvents(prev, events);

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;

const RAD_TO_DEG = 180 / Math.PI;

const formatNumbers = (values: number[], digits: number): string =>
  values.map((value) => value.toFixed(digits).padStart(digits + 4)).join(" ");

function formatDuration(seconds: number): string {
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`;
}

export function TransformTree({ config, saveConfig }: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("transformTree");
  const { topics, playerId } = useDataSourceInfo();

  const transformTopics = useMemo(
    () => topics.filter((topic) => isTransformSchema(topic.schemaName)).map(({ name }) => name),
    [topics],
  );

  // Dynamic and static transforms around the current playback position.
  const streamed = useMessageReducer<FrameEntries>({
    topics: transformTopics,
    restore: restoreEntries,
    addMessages: addEntries,
  });

  // Static transforms are published once, usually at the start of a recording, so a seek would
  // lose them. Preload them from the whole recording when the data source supports it.
  const staticSubscriptions = useMemo<SubscribePayload[]>(
    () =>
      transformTopics.filter(isStaticTopic).map((topic) => ({ topic, preloadType: "full" })),
    [transformTopics],
  );
  const staticBlocks = useBlocksSubscriptions(staticSubscriptions);
  const preloadedStatic = useMemo(
    () =>
      addTransformEvents(
        EMPTY_ENTRIES,
        staticBlocks.flatMap((block) => Object.values(block).flat()),
      ),
    [staticBlocks],
  );

  const current = useMemo(
    () => mergeEntries(preloadedStatic, streamed),
    [preloadedStatic, streamed],
  );

  // Every frame seen for this data source, so the tree keeps its shape across seeks.
  const knownRef = useRef({ playerId, entries: EMPTY_ENTRIES });
  const known = useMemo(() => {
    const previous = knownRef.current.playerId === playerId ? knownRef.current.entries : undefined;
    const entries = mergeEntries(previous ?? EMPTY_ENTRIES, current);
    knownRef.current = { playerId, entries };
    return entries;
  }, [current, playerId]);

  const currentTime = useMessagePipeline(selectCurrentTime);
  const now = currentTime ? toSec(currentTime) : undefined;

  const collapsed = useMemo(() => new Set(config.collapsed), [config.collapsed]);
  const rows = useMemo(
    () => buildRows({ current, known, now, collapsed }),
    [current, known, now, collapsed],
  );

  const toggleCollapsed = useCallback(
    (frame: string) => {
      saveConfig({
        collapsed: collapsed.has(frame)
          ? [...collapsed].filter((other) => other !== frame)
          : [...collapsed, frame],
      });
    },
    [collapsed, saveConfig],
  );

  const staticCount = [...known.values()].filter((entry) => entry.isStatic).length;
  const rootCount = rows.filter((row) => row.depth === 0).length;
  const warningCount = rows.filter((row) => row.warnings.length > 0).length;

  let body: React.ReactNode;
  if (transformTopics.length === 0) {
    body = <EmptyState>{t("noTransformTopics")}</EmptyState>;
  } else if (rows.length === 0) {
    body = <EmptyState>{t("waitingForTransforms")}</EmptyState>;
  } else {
    body = (
      <>
        <div className={classes.summary}>
          <span>{t("frameCount", { count: known.size })}</span>
          <span>{t("staticCount", { count: staticCount })}</span>
          {rootCount > 1 && (
            <span className={classes.warningText}>
              <Warning16Filled /> {t("multipleRoots", { count: rootCount })}
            </span>
          )}
          {warningCount > 0 && (
            <span className={classes.warningText}>
              <Warning16Filled /> {t("warningCount", { count: warningCount })}
            </span>
          )}
        </div>
        <div className={classes.scroll}>
          <table className={classes.table}>
            <thead>
              <tr>
                <th>{t("frame")}</th>
                <th>{t("translation")}</th>
                <th>{t("rotation")}</th>
                <th>{t("age")}</th>
                <th>{t("rate")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FrameTableRow
                  key={row.frame}
                  row={row}
                  collapsed={collapsed.has(row.frame)}
                  onToggle={toggleCollapsed}
                  className={cx({ [classes.warningRow]: row.warnings.length > 0 })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <Stack fullHeight overflow="hidden">
      <PanelToolbar />
      {body}
    </Stack>
  );
}

const FrameTableRow = memo(function FrameTableRowImpl({
  row,
  collapsed,
  onToggle,
  className,
}: {
  row: FrameRow;
  collapsed: boolean;
  onToggle: (frame: string) => void;
  className?: string;
}) {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("transformTree");
  const { entry, age, rate } = row;
  const hasData = !row.warnings.includes("noData");

  const details = entry
    ? [
        t("parent", { parent: entry.parent }),
        t("topic", { topic: entry.topic }),
        t("quaternion", {
          value: [entry.rotation.x, entry.rotation.y, entry.rotation.z, entry.rotation.w]
            .map((value) => value.toFixed(4))
            .join(", "),
        }),
        ...row.warnings.map((warning) => {
          switch (warning) {
            case "multipleParents":
              return t("warnings.multipleParents", { parents: entry.parents.join(", ") });
            case "stale":
              return t("warnings.stale", {
                age: formatDuration(age ?? 0),
                period: formatDuration(rate != undefined ? 1 / rate : 0),
              });
            case "noData":
              return t("warnings.noData");
          }
        }),
      ].join("\n")
    : undefined;

  const rpy = entry ? quaternionToRpy(entry.rotation) : undefined;
  const valueClass = cx({ [classes.muted]: !hasData });

  return (
    <tr className={className}>
      <td>
        <div className={classes.frameCell} style={{ paddingLeft: row.depth * 12 }}>
          {row.hasChildren ? (
            <button
              type="button"
              className={classes.toggle}
              aria-label={collapsed ? t("expand") : t("collapse")}
              onClick={() => {
                onToggle(row.frame);
              }}
            >
              {collapsed ? <ChevronRight12Filled /> : <ChevronDown12Filled />}
            </button>
          ) : (
            <span className={classes.togglePlaceholder} />
          )}
          <Tooltip
            title={details ? <span style={{ whiteSpace: "pre-line" }}>{details}</span> : ""}
            placement="right"
          >
            <span className={cx({ [classes.root]: !entry, [classes.muted]: !hasData })}>
              {row.frame}
            </span>
          </Tooltip>
          {row.warnings.length > 0 && <Warning16Filled className={classes.warningIcon} />}
        </div>
      </td>
      <td className={valueClass}>
        {entry &&
          formatNumbers([entry.translation.x, entry.translation.y, entry.translation.z], 3)}
      </td>
      <td className={valueClass}>
        {rpy && formatNumbers([rpy.x * RAD_TO_DEG, rpy.y * RAD_TO_DEG, rpy.z * RAD_TO_DEG], 1)}
      </td>
      <td className={valueClass}>
        {entry?.isStatic === true ? (
          <span className={classes.staticBadge}>{t("static")}</span>
        ) : (
          age != undefined && formatDuration(age)
        )}
      </td>
      <td className={valueClass}>
        {entry?.isStatic !== true && rate != undefined && `${rate.toFixed(1)} Hz`}
      </td>
    </tr>
  );
});
