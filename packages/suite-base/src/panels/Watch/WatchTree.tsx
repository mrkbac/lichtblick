// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import { IconButton, Tooltip } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { quoteFieldNameIfNeeded } from "@lichtblick/message-path";
import { useSeriesDrag } from "@lichtblick/suite-base/panels/shared/useSeriesDrag";
import { isTypedArray } from "@lichtblick/suite-base/types/isTypedArray";

import { useStyles } from "./Watch.style";
import { formatValue, isExpandable } from "./format";

const MAX_CHILDREN = 200;
const INDENT_PX = 14;

/** Children of an array or object, with the message path of each. Long arrays are cut short. */
export function treeChildren(
  value: unknown,
  path: string,
): { name: string; value: unknown; path: string }[] {
  if (Array.isArray(value) || isTypedArray(value)) {
    const arr = value as ArrayLike<unknown>;
    return Array.from({ length: Math.min(arr.length, MAX_CHILDREN) }, (_, i) => ({
      name: String(i),
      value: arr[i],
      path: `${path}[${i}]`,
    }));
  }
  if (typeof value === "object" && value != undefined) {
    return Object.entries(value).map(([name, child]) => ({
      name,
      value: child,
      path: `${path}.${quoteFieldNameIfNeeded(name)}`,
    }));
  }
  return [];
}

type NodeProps = {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  /** Adds the field as its own row; with Shift every field below it */
  onAddPath: (path: string, options: { shiftKey: boolean }) => void;
};

function TreeNode({ name, value, path, depth, onAddPath }: NodeProps): React.JSX.Element {
  const { t } = useTranslation("watch");
  const { classes } = useStyles();
  const [open, setOpen] = useState(false);
  const expandable = isExpandable(value);
  // Fields can be dragged onto other panels, e.g. a Plot
  const { dragRef } = useSeriesDrag(path);

  return (
    <>
      <div ref={dragRef} className={classes.treeRow} style={{ paddingLeft: depth * INDENT_PX }}>
        {expandable ? (
          <IconButton
            size="small"
            className={classes.expandButton}
            aria-label={open ? t("collapse") : t("expand")}
            onClick={() => {
              setOpen((prev) => !prev);
            }}
          >
            {open ? (
              <KeyboardArrowDownIcon fontSize="inherit" />
            ) : (
              <KeyboardArrowRightIcon fontSize="inherit" />
            )}
          </IconButton>
        ) : (
          <span className={classes.treeSpacer} />
        )}
        <span className={classes.treeName} title={path}>
          {name}
        </span>
        <span className={classes.treeValue}>{formatValue(value, undefined)}</span>
        <span data-actions className={classes.treeActions}>
          <Tooltip title={t("addAsRow")}>
            <IconButton
              size="small"
              aria-label={t("addAsRow")}
              onClick={(event) => {
                onAddPath(path, { shiftKey: event.shiftKey });
              }}
            >
              <AddIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </span>
      </div>
      {open &&
        treeChildren(value, path).map((child) => (
          <TreeNode key={child.name} {...child} depth={depth + 1} onAddPath={onAddPath} />
        ))}
    </>
  );
}

/** An expanded row's value as a tree; any field can be pulled out into its own row. */
export function WatchTree({
  value,
  path,
  fallbackText,
  onAddPath,
}: {
  value: unknown;
  path: string;
  /** Shown when the value isn't an array or object (anymore) */
  fallbackText: string;
  onAddPath: NodeProps["onAddPath"];
}): React.JSX.Element {
  const { classes } = useStyles();
  const children = treeChildren(value, path);
  return (
    <div className={classes.expanded} data-testid="watch-tree">
      {isExpandable(value)
        ? children.map((child) => (
            <TreeNode key={child.name} {...child} depth={0} onAddPath={onAddPath} />
          ))
        : fallbackText}
    </div>
  );
}
