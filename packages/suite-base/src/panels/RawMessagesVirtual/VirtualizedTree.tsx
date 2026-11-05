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

  // Search shows the path to matches expanded. Collapsing such a parent is remembered for the
  // current search text only, so it wins over the search without changing the saved expansion.
  const [searchCollapsed, setSearchCollapsed] = useState({ search, keys: new Set<string>() });
  const collapsedInSearch = searchCollapsed.search === search ? searchCollapsed.keys : undefined;

  const isShownExpanded = useCallback(
    (key: string, value: unknown) =>
      searchResult?.ancestors.has(key) === true
        ? collapsedInSearch?.has(key) !== true
        : isExpanded(key, value),
    [collapsedInSearch, isExpanded, searchResult],
  );

  const toggle = useCallback(
    (key: string, value: unknown) => {
      if (searchResult?.ancestors.has(key) !== true) {
        onToggleExpand(key, value);
        return;
      }
      const keys = new Set(collapsedInSearch);
      if (!keys.delete(key)) {
        keys.add(key);
      }
      setSearchCollapsed({ search, keys });
    },
    [collapsedInSearch, onToggleExpand, search, searchResult],
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

  // Arrow-key tree navigation (WAI-ARIA tree pattern): the tree is a single tab stop.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const node = flatData[activeIndex];
      if (!node) {
        return;
      }
      const expanded = node.isExpandable && isShownExpanded(node.key, node.value);
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
        case "ArrowRight":
          if (node.isExpandable && !expanded) {
            toggle(node.key, node.value);
          } else if (expanded) {
            focusRow(activeIndex + 1);
          }
          break;
        case "ArrowLeft":
          if (expanded) {
            toggle(node.key, node.value);
          } else if (node.parentPath) {
            focusRow(flatData.findIndex((other) => other.key === node.parentPath));
          }
          break;
        case "Enter":
        case " ":
          if (node.isExpandable) {
            toggle(node.key, node.value);
          }
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [activeIndex, flatData, focusRow, isShownExpanded, toggle],
  );

  // Breadcrumb of the topmost visible row's ancestors, so deep rows keep their context.
  const topNode =
    flatData[items.find((item) => item.end > (virtualizer.scrollOffset ?? 0))?.index ?? -1];
  const hasNesting = flatData.some((node) => node.depth > 0);
  const breadcrumb = useMemo(() => {
    if (!hasNesting) {
      return undefined;
    }
    if (!topNode?.parentPath) {
      return [];
    }
    // Keys are stored child-first: "child~parent~root".
    const parts = topNode.parentPath.split(PATH_NAME_AGGREGATOR);
    return parts
      .map((label, index) => ({ label, key: parts.slice(index).join(PATH_NAME_AGGREGATOR) }))
      .reverse();
  }, [hasNesting, topNode?.parentPath]);

  return (
    <div className={classes.wrapper}>
      {breadcrumb != undefined && (
        <div className={classes.breadcrumb} style={{ fontSize: fontSize ?? "inherit" }}>
          {breadcrumb.map(({ label, key }, index) => (
            <Fragment key={key}>
              {index > 0 && <span className={classes.breadcrumbSeparator}>›</span>}
              <button
                className={classes.spanButton}
                tabIndex={-1}
                onClick={() => {
                  focusRow(flatData.findIndex((node) => node.key === key));
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
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
                      className={classes.spanButton}
                    >
                      {expanded ? COLLAPSED_ICON : EXPANDED_ICON}
                    </button>
                  )}
                </span>
                <span className={classes.key}>{node.label}</span>
                <div className={classes.valueContainer}>{renderValue(node)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
