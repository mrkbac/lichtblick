// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ReOrderDotsVertical16Filled } from "@fluentui/react-icons";
import { Fade, ListItem, ListItemButton, ListItemText, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect, useRef } from "react";
import { makeStyles } from "tss-react/mui";

import { fuzzyPositions, HighlightChars } from "@lichtblick/suite-base/components/HighlightChars";
import Stack from "@lichtblick/suite-base/components/Stack";
import { PanelInfo } from "@lichtblick/suite-base/context/PanelCatalogContext";

import { setPanelDragData } from "./panelDrag";

const useStyles = makeStyles<void, "dragIcon">()((theme, _params, classes) => {
  return {
    listItemButton: {
      height: theme.spacing(4), // hard coded here because the parent element of this changes based on context
      cursor: "grab",

      [`&:not(:hover) .${classes.dragIcon}`]: {
        visibility: "hidden",
      },
    },
    dragIcon: {
      cursor: "grab",
      marginRight: theme.spacing(-1),
      color: theme.palette.text.disabled,
    },
    highlight: {
      backgroundColor: "transparent",
      color: theme.palette.primary.main,
      fontWeight: "bold",
    },
  };
});

type Props = {
  panel: PanelInfo;
  searchQuery: string;
  checked?: boolean;
  highlighted?: boolean;
  onClick: () => void;
  onDragStart?: () => void;
};

export function PanelListItem(props: Props): React.JSX.Element {
  const { searchQuery, panel, onClick, onDragStart, checked = false, highlighted = false } = props;
  const { classes } = useStyles();
  const scrollRef = useRef<HTMLDivElement>(null);
  // Dropping is handled by the panel layout, which reads the panel from the drag data.
  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      setPanelDragData(event.dataTransfer, { type: panel.type, config: panel.config });
      // Let the drag start before a surrounding menu closes and unmounts this item.
      setTimeout(() => onDragStart?.(), 0);
    },
    [onDragStart, panel.config, panel.type],
  );

  useEffect(() => {
    if (highlighted && scrollRef.current) {
      const highlightedItem = scrollRef.current.getBoundingClientRect();
      const scrollContainer = scrollRef.current.parentElement?.parentElement?.parentElement;
      if (scrollContainer) {
        const scrollContainerToTop = scrollContainer.getBoundingClientRect().top;

        const isInView =
          highlightedItem.top >= 0 &&
          highlightedItem.top >= scrollContainerToTop &&
          highlightedItem.top + 50 <= window.innerHeight;

        if (!isInView) {
          scrollRef.current.scrollIntoView();
        }
      }
    }
  }, [highlighted]);

  const targetString = panel.extensionNamespace
    ? `${panel.title} [${panel.extensionNamespace}]`
    : panel.title;

  const onClickWithStopPropagation = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onClick();
    },
    [onClick],
  );

  return (
    <Tooltip
      placement="right"
      enterDelay={500}
      leaveDelay={0}
      slots={{ transition: Fade }}
      title={
        <Stack paddingTop={0.25} style={{ width: 200 }}>
          {panel.thumbnail != undefined && <img src={panel.thumbnail} alt={panel.title} />}
          <Stack padding={1} gap={0.5}>
            <Typography variant="body2" style={{ fontWeight: "bold" }}>
              {panel.title}
            </Typography>
            <Typography variant="body2" style={{ opacity: 0.6 }}>
              {panel.description}
            </Typography>
          </Stack>
        </Stack>
      }
    >
      <ListItem dense disablePadding>
        <ListItemButton
          selected={highlighted}
          className={classes.listItemButton}
          disabled={checked}
          ref={scrollRef}
          draggable
          onDragStart={handleDragStart}
          onClick={onClickWithStopPropagation}
        >
          <ListItemText>
            <span data-testid={`panel-menu-item ${panel.title}`}>
              <HighlightChars
                str={targetString}
                indices={fuzzyPositions(targetString, searchQuery)}
                highlightClassName={classes.highlight}
              />
            </span>
          </ListItemText>

          <ReOrderDotsVertical16Filled className={classes.dragIcon} />
        </ListItemButton>
      </ListItem>
    </Tooltip>
  );
}
