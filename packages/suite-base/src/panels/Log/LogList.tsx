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

import DoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown";
import { Fab } from "@mui/material";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useResizeDetector } from "react-resize-detector";
import AutoSizer from "react-virtualized-auto-sizer";
import { List, ListImperativeAPI, RowComponentProps } from "react-window";

import { Time } from "@lichtblick/suite";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { NormalizedLogMessage } from "@lichtblick/suite-base/panels/Log/types";
import { TimeDisplayMethod } from "@lichtblick/suite-base/types/panels";

import { useStyles } from "./LogList.style";
import LogMessage from "./LogMessage";
import { DEFAULT_ROW_HEIGHT } from "./constants";
import { lastIndexAtOrBefore } from "./timeIndex";

export type LogListApi = {
  /** Scroll a row into view and stop following the playhead */
  scrollToIndex: (index: number) => void;
  /** Resume following the playhead */
  follow: () => void;
};

export type LogListProps = {
  items: readonly NormalizedLogMessage[];
  /** Current playback time; rows after it are dimmed. Undefined follows the newest row. */
  currentTime?: Time;
  /** Called when a row is clicked; rows are not clickable without it */
  onSeek?: (time: Time) => void;
  onCopy?: (item: NormalizedLogMessage) => void;
  apiRef?: React.Ref<LogListApi>;
};

type ListItemData = {
  items: readonly NormalizedLogMessage[];
  playheadIndex: number;
  dimFuture: boolean;
  timeFormat: TimeDisplayMethod;
  timeZone: string | undefined;
  onRowClick?: (item: NormalizedLogMessage) => void;
  onCopy?: (item: NormalizedLogMessage) => void;
  setRowHeight: (item: NormalizedLogMessage, height: number) => void;
  /** Changes when measured heights change, so the List re-reads row heights */
  heightVersion: number;
  /** Re-measure rows when the width changes */
  width: number | undefined;
};

function Row(props: RowComponentProps<ListItemData>): React.JSX.Element {
  const { index, style, ariaAttributes, items, playheadIndex, dimFuture, setRowHeight, width } =
    props;
  const item = items[index]!;
  const ref = useRef<HTMLDivElement>(ReactNull);

  // Measured in an effect rather than with a ResizeObserver, which can trigger
  // "ResizeObserver loop" errors while the list scrolls.
  useEffect(() => {
    if (ref.current) {
      setRowHeight(item, ref.current.clientHeight);
    }
  }, [item, setRowHeight, width]);

  return (
    <div style={{ ...style, height: "auto" }} {...ariaAttributes} ref={ref}>
      <LogMessage
        value={item}
        timestampFormat={props.timeFormat}
        timeZone={props.timeZone}
        current={index === playheadIndex}
        future={dimFuture && index > playheadIndex}
        onClick={props.onRowClick}
        onCopy={props.onCopy}
      />
    </div>
  );
}

/**
 * Virtualized list of log messages that follows the playhead: the row nearest the current time
 * is highlighted and kept in view. For live data this means following the newest row.
 * Scrolling away stops following until the user scrolls back or presses the follow button.
 */
function LogList({ items, currentTime, onSeek, onCopy, apiRef }: LogListProps): React.JSX.Element {
  const { classes } = useStyles();
  const { timeFormat, timeZone } = useAppTimeFormat();
  const listRef = useRef<ListImperativeAPI>(ReactNull);
  const { width, ref: resizeRef } = useResizeDetector({ refreshRate: 0, refreshMode: "debounce" });

  // Row heights keyed by message so they survive filtering. Reset when the width changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- width invalidates measured heights
  const heights = useMemo(() => new WeakMap<NormalizedLogMessage, number>(), [width]);
  const [heightVersion, bumpHeightVersion] = useReducer((n: number) => n + 1, 0);
  const setRowHeight = useCallback(
    (item: NormalizedLogMessage, height: number) => {
      if (heights.get(item) !== height) {
        heights.set(item, height);
        bumpHeightVersion();
      }
    },
    [heights],
  );
  const rowHeight = useCallback(
    (index: number, { items: rowItems }: ListItemData) =>
      heights.get(rowItems[index]!) ?? DEFAULT_ROW_HEIGHT,
    [heights],
  );

  const playheadIndex = useMemo(
    () => (currentTime == undefined ? items.length - 1 : lastIndexAtOrBefore(items, currentTime)),
    [items, currentTime],
  );

  const [following, setFollowing] = useState(true);
  // scrollTop set by our own scrolling, so the resulting scroll event isn't taken as user input
  const programmaticScrollTop = useRef<number | undefined>();

  const scrollToRow = useCallback((index: number) => {
    const list = listRef.current;
    if (!list || index < 0) {
      return;
    }
    const before = list.element?.scrollTop;
    list.scrollToRow({ index, align: "smart" });
    const after = list.element?.scrollTop;
    // Without movement there is no scroll event, so a stale value would swallow a user scroll
    programmaticScrollTop.current = after !== before ? after : undefined;
  }, []);

  useEffect(() => {
    if (following && items.length > 0) {
      scrollToRow(Math.max(playheadIndex, 0));
    }
  }, [following, playheadIndex, items, scrollToRow]);

  const follow = useCallback(() => {
    setFollowing(true);
  }, []);

  useImperativeHandle(
    apiRef,
    () => ({
      scrollToIndex: (index) => {
        setFollowing(false);
        scrollToRow(index);
      },
      follow,
    }),
    [follow, scrollToRow],
  );

  const playheadIsLast = playheadIndex === items.length - 1;
  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, offsetHeight, scrollHeight } = event.currentTarget;
      if (
        programmaticScrollTop.current != undefined &&
        Math.abs(scrollTop - programmaticScrollTop.current) < 1
      ) {
        programmaticScrollTop.current = undefined;
        return;
      }
      // Like a terminal: scrolling back to the end resumes following when the playhead is there
      const isAtEnd = scrollTop + offsetHeight >= scrollHeight - 1;
      setFollowing(isAtEnd && playheadIsLast);
    },
    [playheadIsLast],
  );

  const onRowClick = useMemo(
    () =>
      onSeek
        ? (item: NormalizedLogMessage) => {
            setFollowing(true);
            onSeek(item.receiveTime);
          }
        : undefined,
    [onSeek],
  );

  const rowProps = useMemo<ListItemData>(
    () => ({
      items,
      playheadIndex,
      dimFuture: currentTime != undefined,
      timeFormat,
      timeZone,
      onRowClick,
      onCopy,
      setRowHeight,
      heightVersion,
      width,
    }),
    [
      items,
      playheadIndex,
      currentTime,
      timeFormat,
      timeZone,
      onRowClick,
      onCopy,
      setRowHeight,
      heightVersion,
      width,
    ],
  );

  return (
    <AutoSizer>
      {({ width: autoWidth, height }) => (
        <div
          style={{ position: "relative", width: autoWidth, height }}
          ref={resizeRef}
          data-testid="virtualized-list"
        >
          <List<ListItemData>
            listRef={listRef}
            style={{ outline: "none", width: autoWidth, height }}
            rowProps={rowProps}
            rowHeight={rowHeight}
            rowCount={items.length}
            onScroll={onScroll}
            rowComponent={Row}
            data-testid="scrollable-list"
          />
          {!following && (
            <Fab
              size="small"
              title="Follow playhead"
              onClick={follow}
              className={classes.floatingButton}
              data-testid="scroll-to-bottom-button"
            >
              <DoubleArrowDownIcon />
            </Fab>
          )}
        </div>
      )}
    </AutoSizer>
  );
}

export default LogList;
