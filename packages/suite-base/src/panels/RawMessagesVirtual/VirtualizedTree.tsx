// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useVirtualizer } from "@tanstack/react-virtual";
import * as _ from "lodash-es";
import { Fragment, memo, useCallback, useId, useMemo, useRef, useState } from "react";

import { PATH_NAME_AGGREGATOR } from "@lichtblick/suite-base/panels/RawMessagesCommon/constants";
import {
  PropsVirtualizedTree,
  TreeNode,
} from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import { parseRangeKey } from "@lichtblick/suite-base/panels/RawMessagesCommon/utils";
import {
  COLLAPSED_ICON,
  DEFAULT_FONT_SIZE,
  EXPANDED_ICON,
  SCROLLL_OVERSCAN,
  TREE_NODE_INDENTATION,
} from "@lichtblick/suite-base/panels/RawMessagesVirtual/constants";

import { useStyles } from "./VirtualizedTree.style";
import { flattenTreeData, searchTreeData } from "./flattenTreeData";

/** Whether a leaf value differs from the value at the same path in the previous message. */
function hasChanged(node: TreeNode, previousData: unknown): boolean {
  if (node.isExpandable || previousData == undefined) {
    return false;
  }
  const previous: unknown = _.get(previousData, node.keyPath.slice().reverse());
  // Empty objects/arrays are leaves too, and every message has new instances of them.
  if (typeof node.value === "object" && node.value != undefined) {
    return !_.isEqual(previous, node.value);
  }
  return !Object.is(previous, node.value);
}

export const VirtualizedTree = memo(function VirtualizedTree({
  data,
  diff = false,
  isExpanded,
  onToggleExpand,
  fontSize,
  renderValue,
  search = "",
  previousData,
}: PropsVirtualizedTree) {
  const { classes, cx } = useStyles();

  const parentRef = useRef<HTMLDivElement>(null);
  // Row ids must be unique across panels for aria-activedescendant.
  const rowIdPrefix = useId();
  const [activeKey, setActiveKey] = useState<string>();

  // Cache typed-array → regular-array conversions so Array.from() is called at most
  // once per unique typed array object across re-renders caused by node expand/collapse.
  const typedArrayCache = useRef(new WeakMap<object, unknown[]>());

  const searchResult = useMemo(
    () =>
      search.length > 0
        ? searchTreeData(data, search, { diff, cache: typedArrayCache.current })
        : undefined,
    [data, diff, search],
  );

  // Element indexes with a search match (or one below), per array key, so ranges holding them open.
  const matchIndexesByArray = useMemo(() => {
    const byArray = new Map<string, number[]>();
    for (const key of searchResult?.visible ?? []) {
      const separator = key.indexOf(PATH_NAME_AGGREGATOR);
      const first = separator < 0 ? key : key.slice(0, separator);
      if (/^\d+$/.test(first)) {
        const arrayPath = separator < 0 ? "" : key.slice(separator + 1);
        byArray.set(arrayPath, [...(byArray.get(arrayPath) ?? []), Number(first)]);
      }
    }
    return byArray;
  }, [searchResult]);

  /** Whether the search opens node `key`: an ancestor of a match, or a range holding one. */
  const searchOpens = useCallback(
    (key: string) => {
      if (searchResult == undefined) {
        return false;
      }
      if (searchResult.ancestors.has(key)) {
        return true;
      }
      const range = parseRangeKey(key);
      return (
        range != undefined &&
        (matchIndexesByArray.get(range.arrayPath) ?? []).some(
          (index) => index >= range.start && index < range.end,
        )
      );
    },
    [matchIndexesByArray, searchResult],
  );

  // Search shows the path to matches expanded. Collapsing such a parent is remembered for the
  // current search text only, so it wins over the search without changing the saved expansion.
  const [searchCollapsed, setSearchCollapsed] = useState({ search, keys: new Set<string>() });
  const collapsedInSearch = searchCollapsed.search === search ? searchCollapsed.keys : undefined;

  const isShownExpanded = useCallback(
    (key: string, value: unknown) =>
      searchOpens(key) ? collapsedInSearch?.has(key) !== true : isExpanded(key, value),
    [collapsedInSearch, isExpanded, searchOpens],
  );

  const toggle = useCallback(
    (key: string, value: unknown) => {
      if (!searchOpens(key)) {
        onToggleExpand(key, value);
        return;
      }
      const keys = new Set(collapsedInSearch);
      if (!keys.delete(key)) {
        keys.add(key);
      }
      setSearchCollapsed({ search, keys });
    },
    [collapsedInSearch, onToggleExpand, search, searchOpens],
  );

  const flatData = useMemo(() => {
    if (searchResult) {
      // Show matches and the path to them, expanded. Inside a match, the user's expansion applies.
      const { matches, visible } = searchResult;
      return flattenTreeData(data, isShownExpanded, {
        diff,
        include: (key) => visible.has(key),
        includeSubtreeOf: matches,
        cache: typedArrayCache.current,
      });
    }
    return flattenTreeData(data, isExpanded, { diff, cache: typedArrayCache.current });
  }, [data, diff, isExpanded, isShownExpanded, searchResult]);

  const getScrollElement = useCallback(() => parentRef.current, []);

  const virtualizer = useVirtualizer({
    count: flatData.length,
    getScrollElement,
    estimateSize: () => (fontSize ?? DEFAULT_FONT_SIZE) * 1.4 + 4,
    overscan: SCROLLL_OVERSCAN,
    measureElement: (element) => element.getBoundingClientRect().height,
    // It helps prevent the "ResizeObserver loop completed with undelivered notifications" error
    // https://tanstack.com/virtual/latest/docs/api/virtualizer#useanimationframewithresizeobserver
    useAnimationFrameWithResizeObserver: true,
  });

  const items = virtualizer.getVirtualItems();

  const activeIndex = Math.max(
    0,
    flatData.findIndex((node) => node.key === activeKey),
  );

  const focusRow = useCallback(
    (index: number) => {
      const node = flatData[index];
      if (node) {
        setActiveKey(node.key);
        virtualizer.scrollToIndex(index, { align: "auto" });
      }
    },
    [flatData, virtualizer],
  );

  // A focused button inside the tree (after clicking it) keeps Space and Enter for its own click:
  // they reach neither the tree's Enter (which would toggle twice) nor the playback shortcuts.
  const keepActivationKeys = useCallback((event: React.KeyboardEvent) => {
    if (event.key === " " || event.key === "Enter") {
      event.stopPropagation();
    }
  }, []);

  // Keyboard tree navigation (WAI-ARIA tree pattern): the tree is a single tab stop. Left/Right and
  // Space stay with playback (stepping and play/pause while reading messages); Enter expands.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const node = flatData[activeIndex];
      if (!node) {
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          focusRow(Math.min(activeIndex + 1, flatData.length - 1));
          break;
        case "ArrowUp":
          focusRow(Math.max(activeIndex - 1, 0));
          break;
        case "Home":
          focusRow(0);
          break;
        case "End":
          focusRow(flatData.length - 1);
          break;
        case "Enter":
          if (!node.isExpandable) {
            return;
          }
          toggle(node.key, node.value);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [activeIndex, flatData, focusRow, toggle],
  );

  // Breadcrumb of the topmost visible row's ancestors, so deep rows keep their context. Taken from
  // the rows above it, so index ranges show up although element keys don't name them.
  const topIndex = items.find((item) => item.end > (virtualizer.scrollOffset ?? 0))?.index ?? -1;
  const hasNesting = flatData.some((node) => node.depth > 0);
  const breadcrumb = useMemo(() => {
    if (!hasNesting) {
      return undefined;
    }
    const crumbs: { label: string; index: number }[] = [];
    let depth = flatData[topIndex]?.depth ?? 0;
    for (let index = topIndex - 1; index >= 0 && depth > 0; index--) {
      const node = flatData[index]!;
      if (node.depth < depth) {
        crumbs.unshift({ label: node.label, index });
        depth = node.depth;
      }
    }
    return crumbs;
  }, [flatData, hasNesting, topIndex]);

  return (
    <div className={classes.wrapper}>
      {breadcrumb != undefined && (
        <div className={classes.breadcrumb} style={{ fontSize: fontSize ?? "inherit" }}>
          {breadcrumb.map(({ label, index: rowIndex }, index) => (
            <Fragment key={rowIndex}>
              {index > 0 && <span className={classes.breadcrumbSeparator}>›</span>}
              <button
                className={classes.spanButton}
                tabIndex={-1}
                onKeyDown={keepActivationKeys}
                onClick={() => {
                  focusRow(rowIndex);
                }}
              >
                {label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
      <div
        ref={parentRef}
        className={classes.container}
        style={{ fontSize: fontSize ?? "inherit" }}
        role="tree"
        tabIndex={0}
        aria-activedescendant={
          flatData[activeIndex] ? `${rowIdPrefix}-row-${activeIndex}` : undefined
        }
        onKeyDown={onKeyDown}
      >
        <div className={classes.innerWrapper} style={{ height: virtualizer.getTotalSize() }}>
          {items.map((virtualRow) => {
            const node = flatData[virtualRow.index];

            if (!node) {
              return undefined;
            }

            const expanded = node.isExpandable && isShownExpanded(node.key, node.value);
            const changed = diff ? node.diffStatus === "changed" : hasChanged(node, previousData);

            return (
              <div
                key={virtualRow.key}
                id={`${rowIdPrefix}-row-${virtualRow.index}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                role="treeitem"
                aria-level={node.depth + 1}
                aria-expanded={node.isExpandable ? expanded : undefined}
                aria-selected={virtualRow.index === activeIndex}
                className={cx(classes.row, {
                  [classes.activeRow]: virtualRow.index === activeIndex,
                  [classes.added]: node.diffStatus === "added",
                  [classes.deleted]: node.diffStatus === "deleted",
                  [classes.changedValue]: changed,
                  [classes.searchMatch]: searchResult?.matches.has(node.key) === true,
                })}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingLeft: node.depth * TREE_NODE_INDENTATION,
                }}
                onMouseDown={() => {
                  setActiveKey(node.key);
                }}
              >
                <span className={classes.expandButton}>
                  {node.isExpandable && (
                    <button
                      onClick={() => {
                        toggle(node.key, node.value);
                      }}
                      tabIndex={-1}
                      onKeyDown={keepActivationKeys}
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
                      className={classes.spanButton}
                    >
                      {expanded ? COLLAPSED_ICON : EXPANDED_ICON}
                    </button>
                  )}
                </span>
                <span className={classes.key}>{node.label}</span>
                <div className={classes.valueContainer}>
                  {node.isRange !== true && renderValue(node)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
