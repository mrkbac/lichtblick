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
import { elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Time } from "@lichtblick/suite";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";
import { NormalizedLogMessage } from "@lichtblick/suite-base/panels/Log/types";

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

/**
 * Virtualized list of log messages that follows the playhead: the row nearest the current time
 * is highlighted and kept in view. For live data this means following the newest row.
 * Scrolling away stops following until the user scrolls back or presses the follow button.
 */
function LogList({ items, currentTime, onSeek, onCopy, apiRef }: LogListProps): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("log");
  const { timeFormat, timeZone } = useAppTimeFormat();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stable keys per message, so measured row heights survive filtering
  const keyOf = useMemo(() => {
    const keys = new WeakMap<NormalizedLogMessage, number>();
    let nextKey = 0;
    return (item: NormalizedLogMessage) => {
      let key = keys.get(item);
      if (key == undefined) {
        key = nextKey++;
        keys.set(item, key);
      }
      return key;
    };
  }, []);

  // scrollTop set by our own scrolling, so the resulting scroll event isn't taken as user input
  const programmaticScrollTop = useRef<number | undefined>(undefined);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ROW_HEIGHT,
    overscan: 3,
    getItemKey: (index) => keyOf(items[index]!),
    measureElement: (element) => element.getBoundingClientRect().height,
    // Avoids "ResizeObserver loop" errors while the list scrolls
    useAnimationFrameWithResizeObserver: true,
    scrollToFn: (offset, options, instance) => {
      const before = scrollRef.current?.scrollTop;
      elementScroll(offset, options, instance);
      const after = scrollRef.current?.scrollTop;
      // Only a real move dispatches a scroll event that clears the marker; recording a no-op would
      // leave a stale marker, and clearing it would drop a still-pending earlier event.
      if (after !== before) {
        programmaticScrollTop.current = after;
      }
    },
  });

  const playheadIndex = useMemo(
    () => (currentTime == undefined ? items.length - 1 : lastIndexAtOrBefore(items, currentTime)),
    [items, currentTime],
  );

  const [following, setFollowing] = useState(true);

  const scrollToRow = useCallback(
    (index: number) => {
      const item = virtualizer.measurementsCache[index];
      if (!item) {
        return;
      }
      // Like react-window's "smart" alignment: scroll minimally when the row is within one
      // viewport of being visible, otherwise center it.
      const offset = virtualizer.scrollOffset ?? 0;
      const size = virtualizer.scrollRect?.height ?? 0;
      const near = offset >= item.end - 2 * size && offset <= item.start + size;
      virtualizer.scrollToIndex(index, { align: near ? "auto" : "center" });
    },
    [virtualizer],
  );

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

  const dimFuture = currentTime != undefined;

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      data-testid="virtualized-list"
    >
      <div
        ref={scrollRef}
        role="list"
        style={{ outline: "none", width: "100%", height: "100%", overflowY: "auto" }}
        onScroll={onScroll}
        data-testid="scrollable-list"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const index = virtualRow.index;
            return (
              <div
                key={virtualRow.key}
                data-index={index}
                ref={virtualizer.measureElement}
                role="listitem"
                aria-posinset={index + 1}
                aria-setsize={items.length}
                style={{
                  position: "absolute",
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <LogMessage
                  value={items[index]!}
                  timestampFormat={timeFormat}
                  timeZone={timeZone}
                  current={index === playheadIndex}
                  future={dimFuture && index > playheadIndex}
                  onClick={onRowClick}
                  onCopy={onCopy}
                />
              </div>
            );
          })}
        </div>
      </div>
      {!following && (
        <Fab
          size="small"
          title={t("followPlayhead")}
          onClick={follow}
          className={classes.floatingButton}
          data-testid="scroll-to-bottom-button"
        >
          <DoubleArrowDownIcon />
        </Fab>
      )}
    </div>
  );
}

export default LogList;
