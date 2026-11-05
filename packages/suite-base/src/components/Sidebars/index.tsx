// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useRef, useState } from "react";

import ErrorBoundary from "@lichtblick/suite-base/components/ErrorBoundary";
import { useStyles } from "@lichtblick/suite-base/components/Sidebars/index.style";
import { SidebarProps } from "@lichtblick/suite-base/components/Sidebars/types";
import { clampLeftSidebarPercentage } from "@lichtblick/suite-base/components/Sidebars/utils";
import Stack from "@lichtblick/suite-base/components/Stack";

import { NewSidebar } from "./NewSidebar";

const DEFAULT_SIDEBAR_WIDTH_PX = 320;
/** Neither sidebar may push the panel area below this share of the window. */
const MIN_CHILDREN_PERCENTAGE = 10;

/**
 * Drag handle on a sidebar edge. Reports the pointer position as a percentage of the container.
 */
function ResizeHandle({
  onResize,
  onResizeEnd,
}: {
  onResize: (percentage: number) => void;
  onResizeEnd: () => void;
}): React.JSX.Element {
  const { classes } = useStyles();
  return (
    <div
      className={classes.resizeHandle}
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const container = event.currentTarget.parentElement;
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || container == undefined) {
          return;
        }
        const rect = container.getBoundingClientRect();
        onResize(((event.clientX - rect.left) / rect.width) * 100);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        onResizeEnd();
      }}
    />
  );
}

export default function Sidebars<
  OldLeftKey extends string,
  LeftKey extends string,
  RightKey extends string,
>(props: SidebarProps<OldLeftKey, LeftKey, RightKey>): React.JSX.Element {
  const {
    children,
    leftItems,
    selectedLeftKey,
    onSelectLeftKey,
    leftSidebarSize,
    setLeftSidebarSize,
    rightItems,
    selectedRightKey,
    onSelectRightKey,
    rightSidebarSize,
    setRightSidebarSize,
  } = props;
  const { classes } = useStyles();

  const leftSidebarOpen = selectedLeftKey != undefined && leftItems.has(selectedLeftKey);
  const rightSidebarOpen = selectedRightKey != undefined && rightItems.has(selectedRightKey);

  // Sizes while dragging a handle; saved when the drag ends.
  const [dragLeft, setDragLeft] = useState<number | undefined>();
  const [dragRight, setDragRight] = useState<number | undefined>();
  const latest = useRef({ dragLeft, dragRight });
  latest.current = { dragLeft, dragRight };

  const defaultWidth = (100 * DEFAULT_SIDEBAR_WIDTH_PX) / window.innerWidth;
  // The left size is the left sidebar's width; the right size is where the right sidebar starts.
  const leftWidth = clampLeftSidebarPercentage(dragLeft ?? leftSidebarSize ?? defaultWidth);
  const rightWidth = 100 - (dragRight ?? rightSidebarSize ?? 100 - defaultWidth);

  const resizeLeft = useCallback(
    (percentage: number) => {
      const maxWidth = 100 - MIN_CHILDREN_PERCENTAGE - (rightSidebarOpen ? rightWidth : 0);
      setDragLeft(Math.min(clampLeftSidebarPercentage(percentage), maxWidth));
    },
    [rightSidebarOpen, rightWidth],
  );
  const resizeRight = useCallback(
    (percentage: number) => {
      const minStart = MIN_CHILDREN_PERCENTAGE + (leftSidebarOpen ? leftWidth : 0);
      setDragRight(Math.min(Math.max(percentage, minStart), 100 - MIN_CHILDREN_PERCENTAGE));
    },
    [leftSidebarOpen, leftWidth],
  );

  // The children keep their place in the tree so they don't remount when a sidebar opens or closes.
  return (
    <Stack direction="row" fullHeight overflow="hidden" data-testid="sidebars-wrapper">
      {leftSidebarOpen && [
        <div key="leftbar" className={classes.sidebar} style={{ width: `${leftWidth}%` }}>
          <ErrorBoundary>
            <NewSidebar<LeftKey>
              anchor="left"
              onClose={() => {
                onSelectLeftKey(undefined);
              }}
              items={leftItems}
              activeTab={selectedLeftKey}
              setActiveTab={onSelectLeftKey}
            />
          </ErrorBoundary>
        </div>,
        <ResizeHandle
          key="lefthandle"
          onResize={resizeLeft}
          onResizeEnd={() => {
            setLeftSidebarSize(latest.current.dragLeft);
            setDragLeft(undefined);
          }}
        />,
      ]}
      <div key="children" className={classes.children}>
        <ErrorBoundary>{children as React.JSX.Element}</ErrorBoundary>
      </div>
      {rightSidebarOpen && [
        <ResizeHandle
          key="righthandle"
          onResize={resizeRight}
          onResizeEnd={() => {
            setRightSidebarSize(latest.current.dragRight);
            setDragRight(undefined);
          }}
        />,
        <div key="rightbar" className={classes.sidebar} style={{ width: `${rightWidth}%` }}>
          <ErrorBoundary>
            <NewSidebar<RightKey>
              anchor="right"
              onClose={() => {
                onSelectRightKey(undefined);
              }}
              items={rightItems}
              activeTab={selectedRightKey}
              setActiveTab={onSelectRightKey}
            />
          </ErrorBoundary>
        </div>,
      ]}
    </Stack>
  );
}
