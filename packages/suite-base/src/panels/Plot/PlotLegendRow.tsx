// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ErrorCircle16Filled, Square12Filled } from "@fluentui/react-icons";
import { isTime, toSec } from "@foxglove/rostime";
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
import { customTypography } from "@lichtblick/theme";

import { formatStat } from "./RangeStats";
import { PLOT_BUTTONS } from "./buttons";
import { PlotPath, plotPathDisplayName } from "./utils/config";

const {
  toggleSeries: ToggleButton,
  addSeries: AddButton,
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
    whiteSpace: "pre-wrap",
    // Fixed-width digits and a reserved width keep the legend from resizing as values change.
    fontVariantNumeric: "tabular-nums",
    minWidth: "12ch",
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
      width: ROW_HEIGHT,

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
    case "object":
      if (isTime(value)) {
        return toSec(value);
      }
      return undefined;
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
}: PlotLegendRowProps): React.JSX.Element {
  const { openPanelSettings } = useWorkspaceActions();
  const { id: panelId } = usePanelContext();
  const { setSelectedPanelIds } = useSelectedPanels();
  const { classes, cx } = useStyles();
  const { t } = useTranslation("plot");
  const toggleTitle = usePanelButtonTitle(ToggleButton);
  const addTitle = usePanelButtonTitle(AddButton);
  const deleteTitle = usePanelButtonTitle(DeleteButton);

  // When there are no series configured we render an extra row to show an "add series" button.
  const isAddSeriesRow = paths.length === 0;
  const { dragRef, isDragging } = useSeriesDrag(isAddSeriesRow ? undefined : path.value);

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
      onClick={() => {
        setSelectedPanelIds([panelId]);
        openPanelSettings();
        onClickPath();
      }}
    >
      <div className={classes.listIcon}>
        <Checkbox
          className={classes.checkbox}
          checked={path.enabled}
          size="small"
          title={toggleTitle}
          style={{ color: getLineColor(path.color, index) }}
          icon={<ToggleButton.icon />}
          checkedIcon={<Square12Filled />}
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
        <Typography
          noWrap={showPlotValuesInLegend}
          variant="body2"
          className={cx({ [classes.disabledPathLabel]: !path.enabled })}
          data-testid="plot-legend-row-path-label"
          style={{ flex: "auto" }}
        >
          {isAddSeriesRow ? t("clickToAddASeries") : plotPathDisplayName(path, index)}
        </Typography>
        {hasMismatchedDataLength && (
          <Tooltip
            placement="top"
            title="Mismatch in the number of elements in x-axis and y-axis messages"
          >
            <ErrorCircle16Filled className={classes.errorIcon} />
          </Tooltip>
        )}
      </div>
      {showPlotValuesInLegend && (
        <div className={classes.plotValue}>
          <Typography
            variant="body2"
            align="right"
            color={valueSource === "hover" ? "warning" : "textSecondary"}
          >
            {renderValue(value)}
          </Typography>
        </div>
      )}
      <div className={classes.actionButton}>
        {index === paths.length ? (
          <ButtonBase
            title={addTitle}
            aria-label={addTitle}
            onClick={onClickPath}
            data-testid="add-series"
          >
            <AddButton.icon />
          </ButtonBase>
        ) : (
          <ButtonBase
            title={deleteTitle}
            aria-label={deleteTitle}
            onClick={handleDeletePath}
            data-testid="delete-series"
          >
            <DeleteButton.icon />
          </ButtonBase>
        )}
      </div>
    </div>
  );
}
