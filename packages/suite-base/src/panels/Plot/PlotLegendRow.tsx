// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toSec } from "@foxglove/rostime";
import ErrorIcon from "@mui/icons-material/Error";
import SquareIcon from "@mui/icons-material/Square";
import { ButtonBase, Checkbox, Tooltip, Typography, buttonBaseClasses } from "@mui/material";
import { MouseEventHandler } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { Immutable } from "@lichtblick/suite";
import { usePanelButtonTitle } from "@lichtblick/suite-base/components/PanelButton";
import { usePanelContext } from "@lichtblick/suite-base/components/PanelContext";
import { useSelectedPanels } from "@lichtblick/suite-base/context/CurrentLayoutContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { useSeriesDrag } from "@lichtblick/suite-base/panels/shared/useSeriesDrag";
import { getLineColor } from "@lichtblick/suite-base/util/plotColors";
import { stampToTime } from "@lichtblick/suite-base/util/time";
import { customTypography } from "@lichtblick/theme";

import { PlotPathEditor } from "./PlotPathEditor";
import { formatStat } from "./RangeStats";
import { PLOT_BUTTONS } from "./buttons";
import { PlotPath, plotPathDisplayName } from "./utils/config";

const {
  toggleSeries: ToggleButton,
  addSeries: AddButton,
  seriesSettings: SettingsButton,
  deleteSeries: DeleteButton,
} = PLOT_BUTTONS;

type PlotLegendRowProps = Immutable<{
  hasMismatchedDataLength: boolean;
  index: number;
  onClickPath: () => void;
  path: PlotPath;
  paths: PlotPath[];
  value?: unknown;
  valueSource: "hover" | "current";
  savePaths: (paths: PlotPath[]) => void;
  editing: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  supportsStreamModifiers: boolean;
}>;

export const ROW_HEIGHT = 30;

const useStyles = makeStyles<void, "plotName" | "actionButton">()((theme, _params, classes) => ({
  root: {
    display: "contents",
    cursor: "pointer",

    "&:hover": {
      "& > *": {
        backgroundColor: theme.palette.background.paper,
        backgroundImage: `linear-gradient(${[
          "0deg",
          theme.palette.action.hover,
          theme.palette.action.hover,
        ].join(" ,")})`,
      },
    },
    ":not(:hover)": {
      [`& .${classes.actionButton}`]: {
        opacity: 0,
      },
    },
  },
  showPlotValue: {
    [`.${classes.plotName}`]: {
      gridColumn: "span 1",
      padding: theme.spacing(0, 1.5, 0, 0.5),
    },
  },
  listIcon: {
    display: "flex",
    alignItems: "center",
    position: "sticky",
    height: ROW_HEIGHT,
    left: 0,
  },
  checkbox: {
    height: ROW_HEIGHT,
    width: ROW_HEIGHT,
    borderRadius: 0,

    ":hover": {
      backgroundColor: theme.palette.action.hover,
    },
  },
  disabledPathLabel: {
    opacity: 0.5,
  },
  draggable: {
    cursor: "grab",
  },
  dragging: {
    opacity: 0.5,
  },
  plotName: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    justifySelf: "stretch",
    gap: theme.spacing(0.5),
    height: ROW_HEIGHT,
    paddingInline: theme.spacing(0.75, 2.5),
    gridColumn: "span 2",
    fontFeatureSettings: `${customTypography.fontFeatureSettings}, "zero"`,

    ".MuiTypography-root": {
      whiteSpace: "nowrap",
    },
  },
  plotValue: {
    display: "flex",
    alignItems: "center",
    justifySelf: "stretch",
    height: ROW_HEIGHT,
    padding: theme.spacing(0.25, 1, 0.25, 0.25),
    // Fixed-width digits and a fixed column width keep the legend from resizing as values change
    // (e.g. between whole and fractional values); longer values are clipped with the full value in
    // the title.
    fontVariantNumeric: "tabular-nums",
    width: "16ch",
    minWidth: 0,
    justifyContent: "flex-end",
  },
  errorIcon: {
    color: theme.palette.error.main,
  },
  actionButton: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    position: "sticky",
    right: 0,

    [`.${buttonBaseClasses.root}`]: {
      height: ROW_HEIGHT,
      width: 24,

      ":hover": {
        backgroundColor: theme.palette.action.hover,
      },
    },
  },
}));

/**
 * Integers (counters, seconds timestamps) show exactly. Fractions keep four decimals for a steady
 * width, switching to an exponent only where fixed digits stop being readable.
 */
export function formatLegendNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return Math.abs(value) >= 1e5 && Math.abs(value) < 1e15 ? value.toFixed(4) : formatStat(value);
}

function renderValue(value: unknown): string | number | undefined {
  switch (typeof value) {
    case "bigint":
    case "boolean":
      return value.toString();
    case "number":
      return formatLegendNumber(value);
    case "string":
      return value;
    case "object": {
      const time = stampToTime(value);
      return time ? formatLegendNumber(toSec(time)) : undefined;
    }
    default:
      return undefined;
  }
}

export function PlotLegendRow({
  hasMismatchedDataLength,
  index,
  onClickPath,
  path,
  paths,
  savePaths,
  value,
  valueSource,
  editing,
  onStartEdit,
  onEndEdit,
  supportsStreamModifiers,
}: PlotLegendRowProps): React.JSX.Element {
  const { openPanelSettings } = useWorkspaceActions();
  const { id: panelId } = usePanelContext();
  const { setSelectedPanelIds } = useSelectedPanels();
  const { classes, cx } = useStyles();
  const { t } = useTranslation("plot");
  const toggleTitle = usePanelButtonTitle(ToggleButton);
  const settingsTitle = usePanelButtonTitle(SettingsButton);
  const deleteTitle = usePanelButtonTitle(DeleteButton);

  const { dragRef, isDragging } = useSeriesDrag(editing ? undefined : path.value);

  const openSettings = () => {
    setSelectedPanelIds([panelId]);
    openPanelSettings();
    onClickPath();
  };

  // Editing to a message replaces the series with one per numeric field
  const commitEdit = (values: string[]) => {
    onEndEdit();
    const [first, ...rest] = values;
    if (first == undefined) {
      return;
    }
    const newPaths = paths.slice();
    newPaths.splice(
      index,
      1,
      { ...path, value: first },
      ...rest.map((field) => ({
        value: field,
        enabled: true,
        timestampMethod: path.timestampMethod,
        timestampPath: path.timestampPath,
      })),
    );
    savePaths(newPaths);
  };

  const handleDeletePath: MouseEventHandler<HTMLButtonElement> = (ev) => {
    // Deleting a path is a "quick action" and we want to avoid opening the settings sidebar
    // so whatever sidebar the user is already viewing says active.
    //
    // This prevents the click event from going up to the entire row and showing the sidebar.
    ev.stopPropagation();

    const newPaths = paths.slice();
    if (newPaths.length > 0) {
      newPaths.splice(index, 1);
    }
    savePaths(newPaths);
  };

  const showPlotValuesInLegend = value != undefined;

  return (
    <div
      className={cx(classes.root, {
        [classes.showPlotValue]: showPlotValuesInLegend,
      })}
      onClick={openSettings}
    >
      <div className={classes.listIcon}>
        <Checkbox
          className={classes.checkbox}
          checked={path.enabled}
          size="small"
          title={toggleTitle}
          style={{ color: getLineColor(path.color, index) }}
          icon={<ToggleButton.icon style={{ fontSize: 12 }} />}
          checkedIcon={<SquareIcon style={{ fontSize: 12 }} />}
          onClick={(event) => {
            event.stopPropagation();
          }} // prevent toggling from opening settings
          onChange={() => {
            const newPaths = paths.slice();
            const newPath = newPaths[index];

            if (newPath) {
              newPaths[index] = { ...newPath, enabled: !newPath.enabled };
            }
            savePaths(newPaths);
          }}
        />
      </div>
      <div
        ref={dragRef}
        title={dragRef ? t("dragSeriesHint") : undefined}
        className={cx(classes.plotName, {
          [classes.draggable]: dragRef != undefined,
          [classes.dragging]: isDragging,
        })}
        style={{ gridColumn: !showPlotValuesInLegend ? "span 2" : undefined }}
      >
        {editing ? (
          <PlotPathEditor
            initialValue={path.value}
            placeholder={t("addSeriesPlaceholder")}
            supportsStreamModifiers={supportsStreamModifiers}
            onCommit={commitEdit}
            onCancel={onEndEdit}
          />
        ) : (
          <Typography
            noWrap={showPlotValuesInLegend}
            variant="body2"
            className={cx({ [classes.disabledPathLabel]: !path.enabled })}
            data-testid="plot-legend-row-path-label"
            style={{ flex: "auto" }}
            title={t("editSeriesHint")}
            onClick={(event) => {
              event.stopPropagation();
              onStartEdit();
            }}
          >
            {plotPathDisplayName(path, index)}
          </Typography>
        )}
        {hasMismatchedDataLength && (
          <Tooltip
            placement="top"
            title="Mismatch in the number of elements in x-axis and y-axis messages"
          >
            <ErrorIcon style={{ fontSize: 16 }} className={classes.errorIcon} />
          </Tooltip>
        )}
      </div>
      {showPlotValuesInLegend && (
        <div className={classes.plotValue}>
          <Typography
            variant="body2"
            align="right"
            noWrap
            title={String(renderValue(value) ?? "")}
            color={valueSource === "hover" ? "warning" : "textSecondary"}
          >
            {renderValue(value)}
          </Typography>
        </div>
      )}
      <div className={classes.actionButton}>
        <ButtonBase
          title={settingsTitle}
          aria-label={settingsTitle}
          onClick={(event) => {
            event.stopPropagation();
            openSettings();
          }}
          data-testid="series-settings"
        >
          <SettingsButton.icon style={{ fontSize: 16 }} />
        </ButtonBase>
        <ButtonBase
          title={deleteTitle}
          aria-label={deleteTitle}
          onClick={handleDeletePath}
          data-testid="delete-series"
        >
          <DeleteButton.icon style={{ fontSize: 12 }} />
        </ButtonBase>
      </div>
    </div>
  );
}

/**
 * The legend's last row: "Add series", which turns into an inline path input. In a floating
 * legend it only shows while the legend is hovered or focused, unless the plot has no series.
 */
export function PlotLegendAddRow({
  editing,
  hideWhenIdle,
  onStartEdit,
  onEndEdit,
  onAdd,
  supportsStreamModifiers,
}: {
  editing: boolean;
  hideWhenIdle: boolean;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onAdd: (values: string[]) => void;
  supportsStreamModifiers: boolean;
}): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("plot");
  const addTitle = usePanelButtonTitle(AddButton);
  return (
    <div
      className={classes.root}
      data-hide-when-idle={hideWhenIdle && !editing ? true : undefined}
      onClick={onStartEdit}
    >
      <div className={classes.listIcon}>
        <ButtonBase
          className={classes.checkbox}
          title={addTitle}
          aria-label={addTitle}
          data-testid="add-series"
        >
          <AddButton.icon style={{ fontSize: 12 }} />
        </ButtonBase>
      </div>
      <div className={classes.plotName}>
        {editing ? (
          <PlotPathEditor
            initialValue=""
            placeholder={t("addSeriesPlaceholder")}
            supportsStreamModifiers={supportsStreamModifiers}
            onCommit={(values) => {
              onEndEdit();
              onAdd(values);
            }}
            onCancel={onEndEdit}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("addSeries")}
          </Typography>
        )}
      </div>
      <div />
    </div>
  );
}
