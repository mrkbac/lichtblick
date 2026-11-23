// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import SearchIcon from "@mui/icons-material/Search";
import {
  List,
  ListItem,
  ListItemText,
  PopoverPosition,
  Skeleton,
  ToggleButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MouseEvent, Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounce } from "use-debounce";

import { filterMap } from "@lichtblick/den/collection";
import { useLatest, useSessionStorageValue } from "@lichtblick/hooks";
import { useDataSourceInfo } from "@lichtblick/suite-base/PanelAPI";
import { DirectTopicStatsUpdater } from "@lichtblick/suite-base/components/DirectTopicStatsUpdater";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { selectPlayerPresence } from "@lichtblick/suite-base/components/MessagePipeline/selectors";
import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import SearchBar from "@lichtblick/suite-base/components/SearchBar/SearchBar";
import { SKELETON_ITEMS } from "@lichtblick/suite-base/components/TopicList/constants";
import { getDraggedMessagePath } from "@lichtblick/suite-base/components/TopicList/getDraggedMessagePath";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";
import { MessagePathSelectionProvider } from "@lichtblick/suite-base/services/messagePathDragging/MessagePathSelectionProvider";

import { MessagePathRow } from "./MessagePathRow";
import { SelectedTopicKeys } from "./SelectedTopicKeys";
import { useStyles } from "./TopicList.style";
import { TopicRow } from "./TopicRow";
import { groupTopicListItems, TopicListRow } from "./groupTopicListItems";
import { useMultiSelection } from "./useMultiSelection";
import { useOpenMessagePathsInPanel, usePrefetchOpenInSchemas } from "./useOpenMessagePathsInPanel";
import { useTopicListSearch } from "./useTopicListSearch";
import { useTopicListStyles } from "./useTopicListStyles";

// Only needed on right-click: kept out of the startup bundle
const ContextMenu = lazy(async () => ({
  default: (await import("@lichtblick/suite-base/components/TopicList/ContextMenu")).ContextMenu,
}));

export function TopicList(): React.JSX.Element {
  const { t } = useTranslation("topicList");
  const { classes } = useStyles();
  const [undebouncedFilterText, setFilterText] = useState<string>("");
  const [debouncedFilterText] = useDebounce(undebouncedFilterText, 50);
  const onClear = () => {
    setFilterText("");
  };

  const playerPresence = useMessagePipeline(selectPlayerPresence);
  const { topics, datatypes } = useDataSourceInfo();

  const scrollRef = useRef<HTMLDivElement>(null);

  const searchItems = useTopicListSearch({
    topics,
    datatypes,
    filterText: debouncedFilterText,
  });

  const [treeModeValue, setTreeModeValue] = useSessionStorageValue("topicList.treeMode");
  const treeMode = treeModeValue === "true";
  // Namespaces whose state differs from the default: collapsed without a filter, open with one.
  // A new filter reopens everything it matches.
  const [toggled, setToggled] = useState({ filter: "", keys: new Set<string>() });
  const toggledKeys = toggled.filter === debouncedFilterText ? toggled.keys : undefined;
  const treeItems: TopicListRow[] = useMemo(
    () =>
      treeMode
        ? groupTopicListItems(
            searchItems,
            (key) => (toggledKeys?.has(key) ?? false) !== (debouncedFilterText !== ""),
          )
        : searchItems,
    [treeMode, searchItems, toggledKeys, debouncedFilterText],
  );
  const toggleNamespace = useCallback(
    (key: string) => {
      const keys = new Set(toggledKeys);
      if (!keys.delete(key)) {
        keys.add(key);
      }
      setToggled({ filter: debouncedFilterText, keys });
    },
    [toggledKeys, debouncedFilterText],
  );
  const { selectedIndexes, onSelect, getSelectedIndexes } = useMultiSelection(treeItems);
  const soleSelectedItem =
    selectedIndexes.size === 1 ? treeItems[selectedIndexes.values().next().value!] : undefined;
  const soleSelectedTopic =
    soleSelectedItem?.type === "topic" ? soleSelectedItem.item.item.name : undefined;

  // The virtualizer re-reads row heights only when the keys change, so they include the row type
  const getItemKey = useCallback(
    (index: number) => `${index}:${treeItems[index]?.type}`,
    [treeItems],
  );
  const virtualizer = useVirtualizer({
    count: treeItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (treeItems[index]?.type === "topic" ? 50 : 28),
    getItemKey,
    overscan: 10,
  });

  const [contextMenuState, setContextMenuState] = useState<
    { position: PopoverPosition; items: DraggedMessagePath[] } | undefined
  >(undefined);

  const latestTreeItems = useLatest(treeItems);

  const getSelectedItemsAsDraggedMessagePaths = useCallback(() => {
    return filterMap(
      Array.from(getSelectedIndexes()).sort((a, b) => a - b),
      (index): DraggedMessagePath | undefined => {
        const item = latestTreeItems.current[index];
        return item && item.type !== "namespace" ? getDraggedMessagePath(item) : undefined;
      },
    );
  }, [getSelectedIndexes, latestTreeItems]);

  const openMenu = useCallback(
    (position: PopoverPosition, index: number) => {
      const latestSelectedIndexes = getSelectedIndexes();
      // Select only the clicked item if it was not already selected
      if (!latestSelectedIndexes.has(index)) {
        onSelect({ index, modKey: false, shiftKey: false });
      }
      setContextMenuState({ position, items: getSelectedItemsAsDraggedMessagePaths() });
    },
    [getSelectedIndexes, getSelectedItemsAsDraggedMessagePaths, onSelect],
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent, index: number) => {
      event.preventDefault();
      openMenu({ left: event.clientX, top: event.clientY }, index);
    },
    [openMenu],
  );

  const handleOpenInPanelClick = useCallback(
    (event: MouseEvent<HTMLElement>, index: number) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu({ left: rect.left, top: rect.bottom }, index);
    },
    [openMenu],
  );

  const openMessagePathsInPanel = useOpenMessagePathsInPanel();
  const handleDoubleClick = useCallback(() => {
    // The two clicks before the double-click already updated the selection
    void openMessagePathsInPanel(getSelectedItemsAsDraggedMessagePaths());
  }, [getSelectedItemsAsDraggedMessagePaths, openMessagePathsInPanel]);

  // Load the panels' schemas before the first right-click or double-click needs them
  const prefetchOpenInSchemas = usePrefetchOpenInSchemas();

  const handleContextMenuClose = useCallback(() => {
    setContextMenuState(undefined);
  }, []);

  const renderRow = useCallback(
    (index: number, key: React.Key, baseStyle: React.CSSProperties): React.JSX.Element | null => {
      const treeItem = treeItems[index]!;
      if (treeItem.type === "namespace") {
        return (
          <NamespaceRow
            key={key}
            style={baseStyle}
            row={treeItem}
            onToggle={() => {
              toggleNamespace(treeItem.key);
            }}
          />
        );
      }
      const selected = selectedIndexes.has(index);
      const style =
        treeItem.depth == undefined
          ? baseStyle
          : { ...baseStyle, paddingLeft: indentPx(treeItem.depth) };
      const onClick = (event: React.MouseEvent) => {
        event.preventDefault();
        onSelect({
          index,
          modKey: event.metaKey || event.ctrlKey,
          shiftKey: event.shiftKey,
        });
      };
      switch (treeItem.type) {
        case "topic":
          return (
            <TopicRow
              key={key}
              style={style}
              topicResult={treeItem.item}
              label={treeItem.label}
              selected={selected}
              onClick={onClick}
              onDoubleClick={handleDoubleClick}
              onContextMenu={(event) => {
                handleContextMenu(event, index);
              }}
              onOpenInPanelClick={(event) => {
                handleOpenInPanelClick(event, index);
              }}
            />
          );
        case "schema":
          return (
            <MessagePathRow
              key={key}
              style={style}
              messagePathResult={treeItem.item}
              selected={selected}
              onClick={onClick}
              onDoubleClick={handleDoubleClick}
              onContextMenu={(event) => {
                handleContextMenu(event, index);
              }}
            />
          );
      }
      return null;
    },
    [
      handleContextMenu,
      handleDoubleClick,
      handleOpenInPanelClick,
      onSelect,
      selectedIndexes,
      toggleNamespace,
      treeItems,
    ],
  );

  if (playerPresence === PlayerPresence.NOT_PRESENT) {
    return <EmptyState>{t("noDataSourceSelected")}</EmptyState>;
  }

  if (playerPresence === PlayerPresence.ERROR) {
    return <EmptyState>{t("anErrorOccurred")}</EmptyState>;
  }

  if (playerPresence === PlayerPresence.INITIALIZING) {
    return (
      <>
        <header className={classes.filterBar}>
          <SearchBar
            disabled
            variant="filled"
            fullWidth
            placeholder={t("waitingForData")}
            slotProps={{
              input: {
                size: "small",
                startAdornment: <SearchIcon fontSize="small" />,
              },
            }}
          />
        </header>
        <List dense disablePadding>
          {SKELETON_ITEMS.map((id) => (
            <ListItem divider key={id}>
              <ListItemText
                className={classes.skeletonText}
                primary={<Skeleton animation={false} width="20%" />}
                secondary={<Skeleton animation="wave" width="55%" />}
                slotProps={{ secondary: { variant: "caption" } }}
              />
            </ListItem>
          ))}
        </List>
      </>
    );
  }

  return (
    <MessagePathSelectionProvider getSelectedItems={getSelectedItemsAsDraggedMessagePaths}>
      <div className={classes.root} onPointerEnter={prefetchOpenInSchemas}>
        <div className={classes.searchRow}>
          <SearchBar
            id="topic-filter"
            placeholder={t("searchBarPlaceholder")}
            onChange={(event) => {
              setFilterText(event.target.value);
            }}
            value={undebouncedFilterText}
            showClearIcon={!!debouncedFilterText}
            onClear={onClear}
          />
          <Tooltip title={t("groupTopicsByName")}>
            <ToggleButton
              size="small"
              value="tree"
              selected={treeMode}
              aria-label={t("groupTopicsByName")}
              className={classes.treeToggle}
              onChange={() => {
                setTreeModeValue(treeMode ? undefined : "true");
              }}
            >
              <AccountTreeIcon fontSize="small" />
            </ToggleButton>
          </Tooltip>
        </div>
        {treeItems.length > 0 ? (
          // Focusable, so clicking a row focuses the list and its keys (N / Shift+N) apply
          <div
            ref={scrollRef}
            tabIndex={-1}
            style={{ flex: "1 1 100%", overflowY: "auto", outline: "none" }}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) =>
                renderRow(virtualRow.index, virtualRow.key, {
                  position: "absolute",
                  left: 0,
                  width: "100%",
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }),
              )}
            </div>
          </div>
        ) : (
          <EmptyState>
            {playerPresence === PlayerPresence.PRESENT && undebouncedFilterText
              ? `${t("noTopicsOrDatatypesMatching")} \n “${undebouncedFilterText}”`
              : t("noTopicsAvailable")}
            {playerPresence === PlayerPresence.RECONNECTING && t("waitingForConnection")}
          </EmptyState>
        )}
        {soleSelectedTopic != undefined && (
          <SelectedTopicKeys topicName={soleSelectedTopic} containerRef={scrollRef} />
        )}
        <DirectTopicStatsUpdater interval={6} />
      </div>
      {contextMenuState && (
        <Suspense fallback={undefined}>
          <ContextMenu
            // A new right-click opens a fresh menu, not the old one with new props
            key={`${contextMenuState.position.left},${contextMenuState.position.top}`}
            onClose={handleContextMenuClose}
            anchorPosition={contextMenuState.position}
            messagePaths={contextMenuState.items}
            doubleClickOpens
          />
        </Suspense>
      )}
    </MessagePathSelectionProvider>
  );
}

function indentPx(depth: number): number {
  return 8 + depth * 16;
}

function NamespaceRow({
  row,
  style,
  onToggle,
}: {
  row: Extract<TopicListRow, { type: "namespace" }>;
  style: React.CSSProperties;
  onToggle: () => void;
}): React.JSX.Element {
  const { classes } = useTopicListStyles();
  const { classes: namespaceClasses } = useStyles();
  const Chevron = row.expanded ? ExpandMoreIcon : ChevronRightIcon;
  return (
    <div
      className={classes.row}
      style={{ ...style, paddingLeft: indentPx(row.depth) - 4, cursor: "pointer" }}
      role="button"
      tabIndex={0}
      aria-expanded={row.expanded}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <Chevron style={{ fontSize: 16 }} color="action" />
      <FolderOutlinedIcon style={{ fontSize: 16 }} color="action" />
      <Typography variant="body2" noWrap className={namespaceClasses.namespaceLabel}>
        {row.label}
      </Typography>
      <Typography variant="caption" color="textSecondary">
        {row.topicCount}
      </Typography>
    </div>
  );
}
