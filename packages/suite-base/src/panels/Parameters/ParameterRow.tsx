// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RestoreIcon from "@mui/icons-material/Restore";
import { Checkbox, IconButton, Tooltip, Typography } from "@mui/material";
import { memo, ReactElement } from "react";
import { makeStyles } from "tss-react/mui";

import { ParameterValue } from "@lichtblick/suite";
import CopyButton from "@lichtblick/suite-base/components/CopyButton";
import { customTypography } from "@lichtblick/theme";

import { ParameterEditor } from "./ParameterEditor";
import { DiffStatus, formatValue, parameterType, Row } from "./utils";

const INDENT_PX = 14;

const useStyles = makeStyles<void, "actions">()((theme, _params, classes) => ({
  row: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    minHeight: 28,
    paddingRight: theme.spacing(0.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    borderLeft: "3px solid transparent",
    transition: "background-color 0.6s",
    [`&:hover .${classes.actions}, &:focus-within .${classes.actions}`]: {
      visibility: "visible",
    },
    "&:hover": { backgroundColor: theme.palette.action.hover },
  },
  groupRow: {
    cursor: "pointer",
    fontWeight: theme.typography.fontWeightMedium,
    userSelect: "none",
  },
  changed: {
    backgroundColor: theme.palette.action.selected,
    transition: "none",
  },
  diff_added: { borderLeftColor: theme.palette.success.main },
  diff_removed: { borderLeftColor: theme.palette.error.main, opacity: 0.7 },
  diff_changed: { borderLeftColor: theme.palette.warning.main },
  name: {
    display: "flex",
    alignItems: "center",
    flex: "0 0 var(--parameters-name-width, 40%)",
    minWidth: 0,
  },
  chevron: {
    flex: "none",
    width: 20,
    height: 20,
    color: theme.palette.text.secondary,
  },
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  count: { marginLeft: theme.spacing(1), color: theme.palette.text.secondary },
  badge: {
    flex: "none",
    width: 44,
    textAlign: "center",
    fontFamily: customTypography.fontMonospace,
    fontSize: "0.7rem",
    color: theme.palette.text.secondary,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
  },
  value: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
  },
  readonly: {
    fontFamily: customTypography.fontMonospace,
    padding: theme.spacing(0, 0.5),
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  previous: {
    fontFamily: customTypography.fontMonospace,
    color: theme.palette.text.secondary,
    textDecoration: "line-through",
    maxWidth: "35%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: { visibility: "hidden", display: "flex", alignItems: "center" },
}));

export type ParameterRowProps = {
  row: Row;
  collapsed: boolean;
  onToggle: (key: string) => void;
  value: ParameterValue;
  canSet: boolean;
  onSubmit: (name: string, value: ParameterValue) => void;
  highlighted: boolean;
  /** Only set while comparing to a snapshot */
  diff?: DiffStatus;
  snapshotValue?: ParameterValue;
  selected: boolean;
  /** Toggles whether `name` is selected for restoring */
  onToggleSelected: (name: string) => void;
};

export const ParameterRow = memo(function ParameterRowImpl(props: ParameterRowProps): ReactElement {
  const { row, collapsed, onToggle } = props;
  const { classes, cx } = useStyles();
  const indent = { paddingLeft: row.depth * INDENT_PX };

  if (row.kind === "group") {
    return (
      <div
        role="treeitem"
        aria-expanded={!collapsed}
        tabIndex={0}
        className={cx(classes.row, classes.groupRow)}
        onClick={() => {
          onToggle(row.key);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(row.key);
          }
        }}
      >
        <div className={classes.name} style={indent}>
          {collapsed ? (
            <ChevronRightIcon className={classes.chevron} />
          ) : (
            <ExpandMoreIcon className={classes.chevron} />
          )}
          <span className={classes.label} title={row.key}>
            {row.label}
          </span>
          <Typography variant="caption" className={classes.count}>
            {row.count}
          </Typography>
        </div>
      </div>
    );
  }

  const { value, canSet, onSubmit, highlighted, diff, snapshotValue, selected, onToggleSelected } =
    props;
  const name = row.key;
  const removed = diff === "removed";
  const shown = removed ? snapshotValue : value;
  const canApply = canSet && (diff === "changed" || diff === "removed");

  return (
    <div
      role="treeitem"
      className={cx(classes.row, {
        [classes.changed]: highlighted,
        [classes.diff_added]: diff === "added",
        [classes.diff_removed]: removed,
        [classes.diff_changed]: diff === "changed",
      })}
    >
      <div className={classes.name} style={indent}>
        <span className={classes.chevron} />
        <span className={classes.label} title={name}>
          {row.label}
        </span>
      </div>
      <span className={classes.badge}>{parameterType(shown)}</span>
      <div className={classes.value}>
        {canSet && !removed ? (
          <ParameterEditor name={name} value={value} onSubmit={onSubmit} />
        ) : (
          <Typography
            variant="body2"
            className={classes.readonly}
            title={formatValue(shown)}
            sx={{
              color: "text.secondary",
            }}
          >
            {formatValue(shown)}
          </Typography>
        )}
        {diff === "changed" && (
          <Typography
            variant="body2"
            className={classes.previous}
            title={formatValue(snapshotValue)}
          >
            {formatValue(snapshotValue)}
          </Typography>
        )}
      </div>
      {canApply && (
        <>
          <Tooltip title="Restore snapshot value">
            <IconButton
              size="small"
              aria-label={`Restore ${name}`}
              onClick={() => {
                onSubmit(name, snapshotValue);
              }}
            >
              <RestoreIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Checkbox
            size="small"
            checked={selected}
            slotProps={{ input: { "aria-label": `Select ${name}` } }}
            onChange={() => {
              onToggleSelected(name);
            }}
          />
        </>
      )}
      <div className={classes.actions}>
        <CopyButton
          edge="end"
          size="small"
          iconSize="small"
          getText={() => `${name}: ${formatValue(shown)}`}
        />
      </div>
    </div>
  );
});
