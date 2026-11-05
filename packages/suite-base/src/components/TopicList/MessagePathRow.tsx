// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReOrderDotsVertical16Regular } from "@fluentui/react-icons";
import { Badge, Typography } from "@mui/material";
import { FzfResultItem } from "fzf";
import { useMemo } from "react";

import { HighlightChars } from "@lichtblick/suite-base/components/HighlightChars";
import { DraggedMessagePath } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import Stack from "@lichtblick/suite-base/components/Stack";
import { useMessagePathDrag } from "@lichtblick/suite-base/services/messagePathDragging";

import { MessagePathSearchItem } from "./getMessagePathSearchItems";
import { useTopicListStyles } from "./useTopicListStyles";

export function MessagePathRow({
  messagePathResult,
  style,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  messagePathResult: FzfResultItem<MessagePathSearchItem>;
  style: React.CSSProperties;
  selected: boolean;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onContextMenu: React.MouseEventHandler<HTMLDivElement>;
}): React.JSX.Element {
  const { cx, classes } = useTopicListStyles();

  const {
    fullPath,
    suffix: { pathSuffix, type, isLeaf },
    topic,
  } = messagePathResult.item;

  const item: DraggedMessagePath = useMemo(
    () => ({
      path: fullPath,
      rootSchemaName: topic.schemaName,
      isTopic: false,
      isLeaf,
      topicName: topic.name,
    }),
    [fullPath, isLeaf, topic.name, topic.schemaName],
  );

  const { dragRef, isDragging, draggedItemCount } = useMessagePathDrag({
    item,
    selected,
  });

  return (
    <div
      ref={dragRef}
      className={cx(classes.row, classes.fieldRow, {
        [classes.isDragging]: isDragging,
        [classes.selected]: selected,
      })}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {draggedItemCount > 1 && (
        <Badge color="primary" className={classes.countBadge} badgeContent={draggedItemCount} />
      )}
      <Stack flex="auto" direction="row" gap={2} overflow="hidden">
        <Typography variant="body2" noWrap>
          <HighlightChars
            str={pathSuffix}
            indices={messagePathResult.positions}
            offset={messagePathResult.item.offset}
          />
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {type}
        </Typography>
      </Stack>
      <div data-testid="TopicListDragHandle" className={classes.dragHandle}>
        <ReOrderDotsVertical16Regular />
      </div>
    </div>
  );
}
