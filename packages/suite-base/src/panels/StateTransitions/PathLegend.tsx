// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import { Button, ButtonGroup, Stack, darken } from "@mui/material";
import React, { MouseEvent, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import useStyles from "@lichtblick/suite-base/panels/StateTransitions/PathLegend.style";
import { STATE_TRANSITIONS_BUTTONS } from "@lichtblick/suite-base/panels/StateTransitions/buttons";
import { DEFAULT_STATE_TRANSITION_PATH } from "@lichtblick/suite-base/panels/StateTransitions/constants";
import {
  PX_PER_Y_UNIT,
  Y_AXIS_MAX,
} from "@lichtblick/suite-base/panels/StateTransitions/hooks/constants";
import { stateTransitionPathDisplayName } from "@lichtblick/suite-base/panels/StateTransitions/shared";
import {
  PathLegendProps,
  StateTransitionPath,
} from "@lichtblick/suite-base/panels/StateTransitions/types";
import { useSeriesDrag } from "@lichtblick/suite-base/panels/shared/useSeriesDrag";

/** The series label; dragging it copies the series onto another panel. */
function SeriesButton({
  index,
  path,
  onClick,
  children,
}: React.PropsWithChildren<{
  index: number;
  path: StateTransitionPath | undefined;
  onClick: (index: number) => void;
}>): React.JSX.Element {
  const { t } = useTranslation("stateTransitions");
  const { classes, cx } = useStyles();
  const { dragRef, isDragging } = useSeriesDrag(path?.value);
  return (
    <Button
      // Firefox can't drag <button> elements.
      component="div"
      ref={dragRef}
      title={dragRef ? t("dragSeriesHint") : undefined}
      className={cx({ [classes.dragging]: isDragging })}
      data-testid={`edit-topic-button-${index}`}
      endIcon={path == undefined && <AddIcon style={{ fontSize: 16 }} />}
      onClick={() => {
        onClick(index);
      }}
    >
      {children}
    </Button>
  );
}

export const PathLegend = React.memo(function PathLegend(props: PathLegendProps) {
  const { t } = useTranslation("stateTransitions");
  const { paths, rows, setFocusedPath, saveConfig } = props;
  const { setSelectedPanelIds } = useSelectedPanels();
  const { id: panelId } = usePanelContext();
  const { openPanelSettings } = useWorkspaceActions();
  const { classes, theme } = useStyles();
  // Same as the transition labels: light state colors need darker text on a light background.
  const laneTextColor = (color: string) =>
    theme.palette.mode === "light" ? darken(color, 0.45) : color;
  const deleteTitle = usePanelButtonTitle(STATE_TRANSITIONS_BUTTONS.deleteSeries);
  const DeleteIcon = STATE_TRANSITIONS_BUTTONS.deleteSeries.icon;

  const handleDeletePath = useCallback(
    (event: MouseEvent<HTMLButtonElement>, index: number) => {
      // Deleting a path is a "quick action" and we want to avoid opening the settings sidebar
      // so whatever sidebar the user is already viewing says active.
      //
      // This prevents the click event from going up to the entire row and showing the sidebar.
      event.stopPropagation();

      const newPaths = paths.slice();
      if (newPaths.length > 0) {
        newPaths.splice(index, 1);
      }
      saveConfig({ paths: newPaths });
    },
    [paths, saveConfig],
  );

  const handleEditTopic = useCallback(
    (index: number) => {
      setSelectedPanelIds([panelId]);
      openPanelSettings();
      setFocusedPath(["paths", String(index)]);
    },
    [openPanelSettings, panelId, setFocusedPath, setSelectedPanelIds],
  );

  return (
    <Stack className={classes.chartOverlay}>
      {(paths.length === 0 ? [DEFAULT_STATE_TRANSITION_PATH] : paths).map(
        (path: StateTransitionPath, index: number) => (
          <div
            data-testid={`row-${index}`}
            className={classes.row}
            key={index}
            style={{ height: (rows[index]?.span ?? 0) * PX_PER_Y_UNIT }}
          >
            {rows[index]?.lanes?.map((lane) => (
              <span
                key={lane.label}
                className={classes.laneLabel}
                style={{
                  top: (rows[index]!.top + Y_AXIS_MAX - lane.y) * PX_PER_Y_UNIT,
                  color: laneTextColor(lane.color),
                }}
              >
                {lane.label}
              </span>
            ))}
            <ButtonGroup
              size="small"
              color="inherit"
              variant="contained"
              className={classes.buttonGroup}
            >
              <SeriesButton
                index={index}
                path={paths.length === 0 ? undefined : path}
                onClick={handleEditTopic}
              >
                {paths.length === 0
                  ? t("addSeriesButton")
                  : stateTransitionPathDisplayName(path, index)}
              </SeriesButton>
              {paths.length > 0 && (
                <Button
                  data-testid={`delete-topic-button-${index}`}
                  title={deleteTitle}
                  aria-label={deleteTitle}
                  className={classes.dismissIcon}
                  size="small"
                  onClick={(event) => {
                    handleDeletePath(event, index);
                  }}
                >
                  <DeleteIcon style={{ fontSize: 12 }} />
                </Button>
              )}
            </ButtonGroup>
          </div>
        ),
      )}
    </Stack>
  );
});
