// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ChevronDown12Filled, ChevronRight12Filled, Warning16Filled } from "@fluentui/react-icons";
import { Tooltip } from "@mui/material";
import { TFunction } from "i18next";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { toSec } from "@lichtblick/rostime";
import { Immutable, SettingsTreeAction } from "@lichtblick/suite";
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
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { MessageEvent, SubscribePayload } from "@lichtblick/suite-base/players/types";
import { usePanelSettingsTreeUpdate } from "@lichtblick/suite-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

import { useStyles } from "./TransformTree.style";
import { buildSettingsTree, resolveTopics, settingsActionReducer } from "./settings";
import { isTransformSchema, quaternionToRpy } from "./transforms";
import { addTransformEvents, buildRows, mergeEntries } from "./tree";
import { FrameEntries, FrameRow, FrameWarning, TransformTreeConfig } from "./types";

type Props = {
  config: TransformTreeConfig;
  saveConfig: SaveConfig<TransformTreeConfig>;
};

const EMPTY_ENTRIES: FrameEntries = new Map();

const addEntries = (prev: FrameEntries, events: Immutable<MessageEvent[]>): FrameEntries =>
  addTransformEvents(prev, events);

const onlyTopics = (entries: FrameEntries, topics: ReadonlySet<string>): FrameEntries =>
  new Map([...entries].filter(([, entry]) => topics.has(entry.topic)));

const selectCurrentTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.currentTime;

const RAD_TO_DEG = 180 / Math.PI;

const NO_COLLAPSED: ReadonlySet<string> = new Set();

/**
 * Fixed widths (in characters of the monospace table font) for the value columns, so the layout
 * never shifts while playing when a value gains a sign or a digit. Each fits its header and the
 * largest expected value: "-12345.678" m, "-180.0" °, "9999.999" s, "1000.0" Hz.
 */
const VALUE_COLUMNS = [
  { key: "x", chars: 10, groupStart: true },
  { key: "y", chars: 10, groupStart: false },
  { key: "z", chars: 10, groupStart: false },
  { key: "roll", chars: 9, groupStart: true },
  { key: "pitch", chars: 9, groupStart: false },
  { key: "yaw", chars: 9, groupStart: false },
  { key: "age", chars: 9, groupStart: true },
  { key: "rate", chars: 9, groupStart: false },
] as const;
const FRAME_COLUMN_MIN_CHARS = 24;
// Matches the frame cell indentation per tree level below.
const INDENT_PX = 12;
// Matches the cell padding in TransformTree.style.ts: 8px per side, 20px left at a group start.
const columnWidth = ({ chars, groupStart }: (typeof VALUE_COLUMNS)[number]) =>
  `calc(${chars}ch + ${groupStart ? 28 : 16}px)`;
// The frame column grows with the deepest shown level so indentation never clips the name.
const tableMinWidth = (maxDepth: number) =>
  `calc(${
    FRAME_COLUMN_MIN_CHARS + VALUE_COLUMNS.reduce((sum, column) => sum + column.chars, 0)
  }ch + ${16 * (VALUE_COLUMNS.length + 1) + 12 * 3 + maxDepth * INDENT_PX}px)`;

/** Fixed decimals so decimal points line up in a right-aligned column; no "-0.000". */
function formatFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

function formatDuration(seconds: number): string {
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`;
}

function warningMessage(
  t: TFunction<"transformTree">,
  row: FrameRow,
  warning: FrameWarning,
): string {
  switch (warning) {
    case "multipleParents":
      return t("warnings.multipleParents", { parents: row.entry?.parents.join(", ") ?? "" });
    case "stale":
      return t("warnings.stale", {
        age: formatDuration(row.age ?? 0),
        period: formatDuration(row.rate != undefined ? 1 / row.rate : 0),
      });
    case "noData":
      return t("warnings.noData");
  }
}

export function TransformTree({ config, saveConfig }: Props): React.JSX.Element {
  const { classes, cx } = useStyles();
  const { t } = useTranslation("transformTree");
  const { topics, playerId } = useDataSourceInfo();

  const transformTopics = useMemo(
    () => topics.filter((topic) => isTransformSchema(topic.schemaName)).map(({ name }) => name),
    [topics],
  );

  const resolvedTopics = useMemo(
    () => resolveTopics(config, transformTopics),
    [config, transformTopics],
  );
  // Keyed by the names so unrelated config changes (e.g. collapsing a frame) keep the same
  // arrays, which would otherwise reset the data and resubscribe. Topic names have no newlines.
  const visibleKey = resolvedTopics
    .filter((topic) => topic.visible)
    .map(({ name }) => name)
    .join("\n");
  const staticKey = resolvedTopics
    .filter((topic) => topic.visible && topic.isStatic)
    .map(({ name }) => name)
    .join("\n");
  const visibleTopics = useMemo(() => (visibleKey ? visibleKey.split("\n") : []), [visibleKey]);
  const visibleTopicSet = useMemo(() => new Set(visibleTopics), [visibleTopics]);
  const staticTopics = useMemo(() => new Set(staticKey ? staticKey.split("\n") : []), [staticKey]);

  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      saveConfig(settingsActionReducer(config, action));
    },
    [config, saveConfig],
  );
  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler: settingsActionHandler,
      nodes: buildSettingsTree(resolvedTopics, t),
    });
  }, [resolvedTopics, settingsActionHandler, t, updatePanelSettingsTree]);

  // Entries remember every parent a frame had, including from topics that are now hidden, so
  // start over when the visible topics change. useMessageReducer calls `restore` on a seek and
  // whenever `restore` itself changes, so a new function per topic set resets the state.
  const restoreEntries = useMemo(() => {
    void visibleTopics;
    return (): FrameEntries => EMPTY_ENTRIES;
  }, [visibleTopics]);

  // Dynamic and static transforms around the current playback position.
  const streamed = useMessageReducer<FrameEntries>({
    topics: visibleTopics,
    restore: restoreEntries,
    addMessages: addEntries,
  });

  // Static transforms are published once, usually at the start of a recording, so a seek would
  // lose them. Preload them from the whole recording when the data source supports it.
  const staticSubscriptions = useMemo<SubscribePayload[]>(
    () => [...staticTopics].map((topic) => ({ topic, preloadType: "full" })),
    [staticTopics],
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
    () => onlyTopics(mergeEntries(preloadedStatic, streamed), visibleTopicSet),
    [preloadedStatic, streamed, visibleTopicSet],
  );

  // Every frame seen for this data source, so the tree keeps its shape across seeks.
  const knownRef = useRef({ playerId, visibleTopics, entries: EMPTY_ENTRIES });
  const known = useMemo(() => {
    const previous =
      knownRef.current.playerId === playerId && knownRef.current.visibleTopics === visibleTopics
        ? knownRef.current.entries
        : EMPTY_ENTRIES;
    return mergeEntries(previous, current);
  }, [current, playerId, visibleTopics]);
  // Only remember committed results; a render React discards must not change what is known.
  useEffect(() => {
    knownRef.current = { playerId, visibleTopics, entries: known };
  }, [known, playerId, visibleTopics]);

  const currentTime = useMessagePipeline(selectCurrentTime);
  const now = currentTime ? toSec(currentTime) : undefined;

  const collapsed = useMemo(() => new Set(config.collapsed), [config.collapsed]);
  const rows = useMemo(
    () => buildRows({ current, known, now, collapsed, staticTopics }),
    [current, known, now, collapsed, staticTopics],
  );

  // Warnings and counts cover every frame, including those under collapsed frames.
  const allRows = useMemo(
    () =>
      collapsed.size === 0
        ? rows
        : buildRows({ current, known, now, collapsed: NO_COLLAPSED, staticTopics }),
    [rows, collapsed.size, current, known, now, staticTopics],
  );
  const roots = useMemo(
    () => allRows.filter((row) => row.depth === 0).map((row) => row.frame),
    [allRows],
  );

  // Report each problem once in the panel log when it appears, with details. "noData" is left out
  // because it is expected for a moment after every seek.
  const { logError } = usePanelContext();
  const loggedRef = useRef(new Set<string>());
  useEffect(() => {
    if (logError == undefined) {
      return;
    }
    const messages = new Map<string, string>();
    for (const topic of resolvedTopics) {
      if (topic.visible && !topic.available) {
        messages.set(`topic:${topic.name}`, `${topic.name}: ${t("settings.topicUnavailable")}`);
      }
    }
    for (const row of allRows) {
      for (const warning of row.warnings) {
        if (warning !== "noData") {
          messages.set(
            `${warning}:${row.frame}`,
            `${row.frame}: ${warningMessage(t, row, warning)}`,
          );
        }
      }
    }
    if (roots.length > 1) {
      messages.set(
        `roots:${roots.join(",")}`,
        `${t("multipleRoots", { count: roots.length })}: ${roots.join(", ")}`,
      );
    }
    for (const [key, message] of messages) {
      if (!loggedRef.current.has(key)) {
        logError(message);
      }
    }
    loggedRef.current = new Set(messages.keys());
  }, [allRows, logError, resolvedTopics, roots, t]);

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

  const staticCount = [...known.values()].filter((entry) => staticTopics.has(entry.topic)).length;
  const rootCount = roots.length;
  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), 0);
  const warningCount = allRows.filter((row) => row.warnings.length > 0).length;
  const notYetPublishedCount = allRows.filter((row) => row.notYetPublished).length;

  let body: React.ReactNode;
  if (resolvedTopics.length === 0) {
    body = <EmptyState>{t("noTransformTopics")}</EmptyState>;
  } else if (visibleTopics.length === 0) {
    body = <EmptyState>{t("allTopicsHidden")}</EmptyState>;
  } else if (rows.length === 0) {
    body = <EmptyState>{t("waitingForTransforms")}</EmptyState>;
  } else {
    body = (
      <>
        <div className={classes.summary}>
          <span>{t("frameCount", { count: known.size })}</span>
          <span>{t("staticCount", { count: staticCount })}</span>
          {notYetPublishedCount > 0 && (
            <span>{t("notYetPublishedCount", { count: notYetPublishedCount })}</span>
          )}
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
          <table className={classes.table} style={{ minWidth: tableMinWidth(maxDepth) }}>
            <colgroup>
              <col />
              {VALUE_COLUMNS.map((column) => (
                <col key={column.key} style={{ width: columnWidth(column) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>{t("columns.frame")}</th>
                {VALUE_COLUMNS.map((column) => (
                  <th key={column.key} className={cx({ [classes.groupStart]: column.groupStart })}>
                    {t(`columns.${column.key}`)}
                  </th>
                ))}
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
  const hasData = !row.notYetPublished && !row.warnings.includes("noData");

  const details = [
    row.frame,
    ...(entry
      ? [
          t("parent", { parent: entry.parent }),
          t("topic", { topic: entry.topic }),
          t("quaternion", {
            value: [entry.rotation.x, entry.rotation.y, entry.rotation.z, entry.rotation.w]
              .map((value) => value.toFixed(4))
              .join(", "),
          }),
          ...(row.notYetPublished ? [t("notYetPublished")] : []),
          ...row.warnings.map((warning) => warningMessage(t, row, warning)),
        ]
      : []),
  ].join("\n");

  const rpy = entry ? quaternionToRpy(entry.rotation) : undefined;
  const valueClass = cx({ [classes.muted]: !hasData });
  const ageText = !row.isStatic && age != undefined ? formatFixed(age, 3) : undefined;
  const rateText = !row.isStatic && rate != undefined ? formatFixed(rate, 1) : undefined;

  return (
    <tr className={className}>
      <td>
        <div className={classes.frameCell} style={{ paddingLeft: row.depth * INDENT_PX }}>
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
            title={<span style={{ whiteSpace: "pre-line" }}>{details}</span>}
            placement="right"
          >
            <span
              className={cx(classes.frameName, {
                [classes.root]: !entry,
                [classes.muted]: !hasData,
              })}
            >
              {row.frame}
            </span>
          </Tooltip>
          {row.warnings.length > 0 && <Warning16Filled className={classes.warningIcon} />}
        </div>
      </td>
      {/* Values can be wider than their column and get clipped, so the title has the full text. */}
      {[entry?.translation.x, entry?.translation.y, entry?.translation.z].map((value, i) => {
        const text = value != undefined ? formatFixed(value, 3) : undefined;
        return (
          <td
            key={`t${i}`}
            title={text}
            className={cx(valueClass, { [classes.groupStart]: i === 0 })}
          >
            {text}
          </td>
        );
      })}
      {[rpy?.x, rpy?.y, rpy?.z].map((value, i) => {
        const text = value != undefined ? formatFixed(value * RAD_TO_DEG, 1) : undefined;
        return (
          <td
            key={`r${i}`}
            title={text}
            className={cx(valueClass, { [classes.groupStart]: i === 0 })}
          >
            {text}
          </td>
        );
      })}
      <td title={ageText} className={cx(valueClass, classes.groupStart)}>
        {row.isStatic ? <span className={classes.staticBadge}>{t("static")}</span> : ageText}
      </td>
      <td title={rateText} className={valueClass}>
        {rateText}
      </td>
    </tr>
  );
});
