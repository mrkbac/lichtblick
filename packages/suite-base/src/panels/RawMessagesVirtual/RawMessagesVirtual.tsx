// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { Checkbox, FormControlLabel, InputBase, Typography } from "@mui/material";
import * as _ from "lodash-es";
import { useMemo, useRef, useState } from "react";

import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import Stack from "@lichtblick/suite-base/components/Stack";
import DiffStats from "@lichtblick/suite-base/panels/RawMessagesCommon/DiffStats";
import MaybeCollapsedValue from "@lichtblick/suite-base/panels/RawMessagesCommon/MaybeCollapsedValue";
import Metadata from "@lichtblick/suite-base/panels/RawMessagesCommon/Metadata";
import ObjectSummary from "@lichtblick/suite-base/panels/RawMessagesCommon/ObjectSummary";
import { StepButtons } from "@lichtblick/suite-base/panels/RawMessagesCommon/StepButtons";
import { Toolbar } from "@lichtblick/suite-base/panels/RawMessagesCommon/Toolbar";
import { CUSTOM_METHOD } from "@lichtblick/suite-base/panels/RawMessagesCommon/constants";
import getDiff from "@lichtblick/suite-base/panels/RawMessagesCommon/getDiff";
import {
  useStylesRawMessagesVirtual,
  useStylesToolbar,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/index.style";
import {
  diffLabels,
  DiffObject,
  PropsRawMessagesVirtual,
  TreeNode,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import { useRawMessagesPanelSettings } from "@lichtblick/suite-base/panels/RawMessagesCommon/useRawMessagesPanelSettings";
import {
  useRenderDiffLabel,
  useValueRenderer,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/useRenderers";
import { useSharedRawMessagesLogic } from "@lichtblick/suite-base/panels/RawMessagesCommon/useSharedRawMessagesLogic";
import {
  dataWithoutWrappingArray,
  getSingleValue,
  getValueString,
  isSingleElemArray,
  handleStepKeyDown,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/utils";
import { VirtualizedTree } from "@lichtblick/suite-base/panels/RawMessagesVirtual/VirtualizedTree";

const selectIsPlaying = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.isPlaying;

const RawMessagesVirtual = (props: PropsRawMessagesVirtual): React.JSX.Element => {
  const { classes } = useStylesRawMessagesVirtual();
  const { classes: toolbarClasses } = useStylesToolbar();
  const { config, saveConfig } = props;
  const { openSiblingPanel } = usePanelContext();
  const { topicPath, diffMethod, diffTopicPath, diffEnabled, showFullMessageForDiff, fontSize } =
    config;
  const { datatypes } = useDataSourceInfo();
  const isPlaying = useMessagePipeline(selectIsPlaying) === true;

  const {
    topic,
    rootStructureItem,
    baseItem,
    diffItem,
    isExpanded,
    onToggleExpand,
    canExpandAll,
    onTopicPathChange,
    onDiffTopicPathChange,
    onToggleDiff,
    onToggleExpandAll,
    canStep,
    canStepPrevious,
    canStepNext,
    onStepPrevious,
    onStepNext,
  } = useSharedRawMessagesLogic({
    config,
    saveConfig,
  });
  const stepping = { canStepPrevious, canStepNext, onStepPrevious, onStepNext };

  const [search, setSearch] = useState<string | undefined>();

  const valueRenderer = useValueRenderer({
    datatypes,
    hoverObserverClassName: classes.hoverObserver,
    onTopicPathChange,
    openSiblingPanel,
  });

  const renderDiffLabel = useRenderDiffLabel({
    onTopicPathChange,
    openSiblingPanel,
  });

  // Remember the previously shown message so changed values can be highlighted while stepping.
  const data = useMemo(
    () => baseItem && dataWithoutWrappingArray(baseItem.queriedData.map(({ value }) => value)),
    [baseItem],
  );
  const diffData = useMemo(
    () => diffItem && dataWithoutWrappingArray(diffItem.queriedData.map(({ value }) => value)),
    [diffItem],
  );
  const diff = useMemo(
    () =>
      diffEnabled
        ? getDiff({ before: data, after: diffData, idLabel: undefined, showFullMessageForDiff })
        : {},
    [data, diffData, diffEnabled, showFullMessageForDiff],
  );
  const shownRef = useRef<{ event: unknown; data: unknown; topicPath: string }>();
  const previousDataRef = useRef<unknown>();
  if (shownRef.current?.event !== baseItem?.messageEvent) {
    previousDataRef.current =
      shownRef.current?.topicPath === topicPath ? shownRef.current.data : undefined;
    shownRef.current = baseItem ? { event: baseItem.messageEvent, data, topicPath } : undefined;
  }

  const hideWrappingArray =
    baseItem?.queriedData.length === 1 && typeof baseItem.queriedData[0]?.value === "object";

  const renderValue = (node: TreeNode): React.ReactNode => {
    if (diffEnabled) {
      if (node.isExpandable) {
        // Items matched by an id field show that id (from DiffStats) instead of a preview.
        const hasId = diffLabels.ID.labelText in (node.value as DiffObject);
        return (
          <>
            {!hasId && <ObjectSummary value={node.value} />}
            <DiffStats data={node.value as DiffObject} itemType={undefined} />
          </>
        );
      }
      // Changed leaves already hold a formatted "before -> after" string.
      const label = node.diffStatus === "changed" ? String(node.value) : getValueString(node.value);
      return renderDiffLabel(label, node.value);
    }

    return valueRenderer(
      rootStructureItem,
      hideWrappingArray ? [data] : (data as unknown[]),
      baseItem?.queriedData ?? [],
      getValueString(node.value),
      node.value,
      ...node.keyPath,
      ...(hideWrappingArray ? [0] : []),
    );
  };

  const renderOutput = () => {
    if (topicPath.length === 0) {
      return <EmptyState>No topic selected</EmptyState>;
    }
    if (diffEnabled && diffMethod === CUSTOM_METHOD && (!baseItem || !diffItem)) {
      return (
        <EmptyState>{`Waiting to diff next messages from "${topicPath}" and "${diffTopicPath}"`}</EmptyState>
      );
    }

    if (!baseItem) {
      return (
        <>
          {canStep && (
            // Keep the step buttons reachable before the first message, e.g. to jump to it.
            <Stack direction="row" alignItems="center" paddingInline={1} paddingBlockStart={0.75}>
              <Typography variant="caption" color="text.secondary">
                No message yet
              </Typography>
              <StepButtons stepping={stepping} />
            </Stack>
          )}
          <EmptyState>Waiting for next message…</EmptyState>
        </>
      );
    }

    const { messageEvent, queriedData } = baseItem;

    const shouldDisplaySingleVal =
      (data != undefined && typeof data !== "object") ||
      (isSingleElemArray(data) && data[0] != undefined && typeof data[0] !== "object");

    const singleVal = getSingleValue(data, queriedData);

    const renderContent = () => {
      if (shouldDisplaySingleVal) {
        return (
          <Typography
            variant="body1"
            fontSize={fontSize}
            whiteSpace="pre-wrap"
            style={{ wordWrap: "break-word" }}
          >
            <MaybeCollapsedValue itemLabel={String(singleVal)} />
          </Typography>
        );
      }

      if (diffEnabled && _.isEqual({}, diff)) {
        return <EmptyState>No difference found</EmptyState>;
      }

      return (
        <>
          {diffEnabled && (
            <FormControlLabel
              disableTypography
              checked={showFullMessageForDiff}
              control={
                <Checkbox
                  size="small"
                  onChange={() => {
                    saveConfig({ showFullMessageForDiff: !showFullMessageForDiff });
                  }}
                />
              }
              label="Show full message"
            />
          )}
          <VirtualizedTree
            data={diffEnabled ? diff : data}
            diff={diffEnabled}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
            fontSize={fontSize}
            renderValue={renderValue}
            search={search}
            previousData={isPlaying ? undefined : previousDataRef.current}
          />
        </>
      );
    };

    return (
      <Stack
        className={classes.topic}
        flex="auto"
        overflowX="hidden"
        paddingLeft={0.75}
        data-testid="panel-scroll-container"
      >
        <Metadata
          data={data}
          diffData={diffData}
          diff={diff}
          message={messageEvent}
          {...(topic ? { datatype: topic.schemaName } : undefined)}
          {...(diffItem ? { diffMessage: diffItem.messageEvent } : undefined)}
          {...(canStep ? { stepping } : undefined)}
        />
        {renderContent()}
      </Stack>
    );
  };

  // Setup settings in panel settings tree
  useRawMessagesPanelSettings({
    fontSize,
    saveConfig,
  });

  return (
    // A focusable div (Stack has no event props) so the shortcuts work while the panel has focus.
    <div
      tabIndex={-1}
      className={classes.root}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "f") {
          event.preventDefault();
          setSearch((old) => old ?? "");
          return;
        }
        if (canStep) {
          handleStepKeyDown(event, stepping);
        }
      }}
    >
      <Toolbar
        canExpandAll={canExpandAll}
        diffEnabled={diffEnabled}
        diffMethod={diffMethod}
        diffTopicPath={diffTopicPath}
        onDiffTopicPathChange={onDiffTopicPathChange}
        onToggleDiff={onToggleDiff}
        onToggleExpandAll={onToggleExpandAll}
        onTopicPathChange={onTopicPathChange}
        saveConfig={saveConfig}
        topicPath={topicPath}
        searchOpen={search != undefined}
        onToggleSearch={() => {
          setSearch((old) => (old == undefined ? "" : undefined));
        }}
      />
      {search != undefined && (
        <div className={toolbarClasses.diffOptions}>
          <InputBase
            autoFocus
            fullWidth
            size="small"
            placeholder="Search fields and values"
            value={search}
            inputProps={{ "aria-label": "Search fields and values" }}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch(undefined);
              }
            }}
          />
        </div>
      )}
      {renderOutput()}
    </div>
  );
};

export default RawMessagesVirtual;
