// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CheckIcon from "@mui/icons-material/Check";
import { Tooltip, useTheme } from "@mui/material";
import React, { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { withStyles } from "tss-react/mui";

import HoverableIconButton from "@lichtblick/suite-base/components/HoverableIconButton";
import { usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import Stack from "@lichtblick/suite-base/components/Stack";
import { openSiblingPlotPanel } from "@lichtblick/suite-base/panels/Plot/utils/openSiblingPlotPanel";
import HighlightedValue from "@lichtblick/suite-base/panels/RawMessagesCommon/HighlightedValue";
import { RAW_MESSAGES_BUTTONS } from "@lichtblick/suite-base/panels/RawMessagesCommon/buttons";
import { copyMessageReplacer } from "@lichtblick/suite-base/panels/RawMessagesCommon/copyMessageReplacer";
import { useStylesValue } from "@lichtblick/suite-base/panels/RawMessagesCommon/index.style";
import { PropsValue, ValueActionItem } from "@lichtblick/suite-base/panels/RawMessagesCommon/types";
import { TRANSITIONABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/StateTransitions/constants";
import { openSiblingStateTransitionsPanel } from "@lichtblick/suite-base/panels/StateTransitions/openSiblingStateTransitionsPanel";
import { PLOTABLE_ROS_TYPES } from "@lichtblick/suite-base/panels/shared/constants";
import { useSeriesDrag } from "@lichtblick/suite-base/panels/shared/useSeriesDrag";
import clipboard from "@lichtblick/suite-base/util/clipboard";
import { getValueColor } from "@lichtblick/suite-base/util/globalConstants";

const StyledIconButton = withStyles(HoverableIconButton, (theme) => ({
  root: {
    "&.MuiIconButton-root": {
      fontSize: theme.typography.pxToRem(16),
      opacity: 0.6,
      padding: 0,
    },
  },
}));

const DragButton = RAW_MESSAGES_BUTTONS.dragValue;

function DragHandle(props: {
  dragRef: (element: HTMLElement | null) => (() => void) | undefined;
  className: string;
}): React.JSX.Element {
  const title = usePanelButtonTitle(DragButton);
  return (
    <Tooltip arrow title={title} placement="top">
      <span ref={props.dragRef} className={props.className}>
        <DragButton.icon fontSize="inherit" />
      </span>
    </Tooltip>
  );
}

function ValueActionButton({ action }: { action: ValueActionItem }): React.JSX.Element {
  const title = usePanelButtonTitle(action.button);
  const Icon = action.button.icon;
  return (
    <Tooltip arrow title={action.feedback?.tooltip ?? title} placement="top">
      <StyledIconButton
        size="small"
        aria-label={title}
        activeColor={action.activeColor}
        onClick={action.onClick}
        color="inherit"
        icon={action.feedback?.icon ?? <Icon fontSize="inherit" />}
      />
    </Tooltip>
  );
}

function Value(props: PropsValue): React.JSX.Element {
  const timeOutID = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {
    arrLabel,
    basePath,
    itemLabel,
    itemValue,
    valueAction,
    onTopicPathChange,
    openSiblingPanel,
  } = props;
  const [copied, setCopied] = useState(false);
  const { palette } = useTheme();
  const valueColor = useMemo(
    () => getValueColor(itemValue, palette.mode),
    [itemValue, palette.mode],
  );

  const openPlotPanel = useCallback(
    (pathSuffix: string) => () => {
      openSiblingPlotPanel(openSiblingPanel, `${basePath}${pathSuffix}`);
    },
    [basePath, openSiblingPanel],
  );

  const openStateTransitionsPanel = useCallback(
    (pathSuffix: string) => () => {
      openSiblingStateTransitionsPanel(openSiblingPanel, `${basePath}${pathSuffix}`);
    },
    [basePath, openSiblingPanel],
  );

  const onFilter = useCallback(() => {
    onTopicPathChange(`${basePath}${valueAction?.filterPath}`);
  }, [basePath, valueAction, onTopicPathChange]);

  const handleCopy = useCallback((value: string) => {
    clipboard
      .copy(value)
      .then(() => {
        setCopied(true);
        timeOutID.current = setTimeout(() => {
          setCopied(false);
        }, 1500);
      })
      .catch((e: unknown) => {
        console.warn(e);
      });
  }, []);

  const availableActions = useMemo(() => {
    const actions: ValueActionItem[] = [];

    if (arrLabel.length > 0) {
      actions.push({
        key: "Copy",
        activeColor: copied ? "success" : "primary",
        button: RAW_MESSAGES_BUTTONS.copyValue,
        feedback: copied
          ? { tooltip: "Copied", icon: <CheckIcon fontSize="inherit" /> }
          : undefined,
        onClick: () => {
          handleCopy(JSON.stringify(itemValue, copyMessageReplacer, 2) ?? "");
        },
      });
    }

    if (valueAction == undefined) {
      return actions;
    }

    const isPlotableType = PLOTABLE_ROS_TYPES.includes(valueAction.primitiveType);
    const isTransitionalType = TRANSITIONABLE_ROS_TYPES.includes(valueAction.primitiveType);
    const isMultiSlicePath = valueAction.multiSlicePath === valueAction.singleSlicePath;

    if (valueAction.filterPath.length > 0) {
      actions.push({ key: "Filter", button: RAW_MESSAGES_BUTTONS.filter, onClick: onFilter });
    }

    if (isPlotableType) {
      actions.push({
        key: "line",
        button: RAW_MESSAGES_BUTTONS.plotLine,
        onClick: openPlotPanel(valueAction.singleSlicePath),
      });

      if (!isMultiSlicePath) {
        actions.push({
          key: "scatter",
          button: RAW_MESSAGES_BUTTONS.plotScatter,
          onClick: openPlotPanel(valueAction.multiSlicePath),
        });
      }
    }

    if (isTransitionalType && isMultiSlicePath) {
      actions.push({
        key: "stateTransitions",
        button: RAW_MESSAGES_BUTTONS.stateTransitions,
        onClick: openStateTransitionsPanel(valueAction.singleSlicePath),
      });
    }

    return actions;
  }, [
    arrLabel.length,
    copied,
    handleCopy,
    itemValue,
    onFilter,
    openPlotPanel,
    openStateTransitionsPanel,
    valueAction,
  ]);

  const { classes } = useStylesValue();

  // Drag a field onto another panel, e.g. a Watch or Plot
  const { dragRef } = useSeriesDrag(
    valueAction ? `${basePath}${valueAction.singleSlicePath}` : undefined,
  );

  useEffect(() => {
    return () => {
      if (timeOutID.current != undefined) {
        clearTimeout(timeOutID.current);
      }
    };
  }, []);

  // The Tooltip and StyledIconButton components seem to be expensive to render so we
  // track our hover state and render them conditionally only when this component is
  // hovered.
  const [pointerOver, setPointerOver] = useState(false);

  return (
    <Stack
      inline
      flexWrap="wrap"
      direction="row"
      alignItems="center"
      gap={0.25}
      className={classes.root}
      onPointerEnter={() => {
        setPointerOver(true);
      }}
      onPointerLeave={() => {
        setPointerOver(false);
      }}
    >
      <span style={valueColor ? { color: valueColor } : undefined}>
        <HighlightedValue itemLabel={itemLabel} />
      </span>
      {arrLabel}
      {/* Out of the layout, so hovering never moves or wraps the value */}
      {pointerOver && (
        <span className={classes.hoverActions}>
          {/* A grip instead of the whole value, so the value text stays selectable */}
          {dragRef && <DragHandle dragRef={dragRef} className={classes.dragHandle} />}
          {availableActions.map((action) => (
            <ValueActionButton key={action.key} action={action} />
          ))}
        </span>
      )}
    </Stack>
  );
}

// In practice this seems to be an expensive component to render.
// Memoization provides a very noticeable performance boost.
export default React.memo(Value);
