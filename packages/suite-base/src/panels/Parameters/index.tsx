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

import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import SearchIcon from "@mui/icons-material/Search";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import ViewListIcon from "@mui/icons-material/ViewList";
import {
  Alert,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Switch,
  ToggleButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as _ from "lodash-es";
import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { ParameterValue } from "@lichtblick/suite";
import EmptyState from "@lichtblick/suite-base/components/EmptyState";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Panel from "@lichtblick/suite-base/components/Panel";
import PanelToolbar from "@lichtblick/suite-base/components/PanelToolbar";
import Stack from "@lichtblick/suite-base/components/Stack";
import { PLAYER_CAPABILITIES } from "@lichtblick/suite-base/players/constants";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";
import { downloadTextFile } from "@lichtblick/suite-base/util/download";

import { ParameterRow } from "./ParameterRow";
import {
  allGroupKeys,
  buildRows,
  diffParameters,
  makeMatcher,
  parametersFromYaml,
  parametersToYaml,
} from "./utils";

// How long a changed parameter stays highlighted
const HIGHLIGHT_MS = 3000;

type ParameterSnapshot = { name: string; yaml: string };

export type ParametersConfig = {
  title?: string;
  /** Show a namespace tree (default) or a flat list */
  flat?: boolean;
  /** Collapsed namespace keys */
  collapsed?: string[];
  snapshots?: ParameterSnapshot[];
};

type Props = {
  config: ParametersConfig;
  saveConfig: SaveConfig<ParametersConfig>;
};

// Keep a single empty map so selector return value is reference-equal
const EMPTY_PARAMETERS = new Map<string, ParameterValue>();
const EMPTY_SET = new Set<string>();

function selectCapabilities(ctx: MessagePipelineContext) {
  return ctx.playerState.capabilities;
}
function selectSetParameter(ctx: MessagePipelineContext) {
  return ctx.setParameter;
}
function selectParameters(ctx: MessagePipelineContext): ReadonlyMap<string, ParameterValue> {
  // Player parameters are deeply immutable; we only read them
  return (
    (ctx.playerState.activeData?.parameters as ReadonlyMap<string, ParameterValue> | undefined) ??
    EMPTY_PARAMETERS
  );
}

const useStyles = makeStyles()((theme) => ({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(0.5),
    padding: theme.spacing(0.5, 0.75),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  search: {
    flex: 1,
    fontSize: theme.typography.body2.fontSize,
    padding: theme.spacing(0, 0.75),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.action.hover,
  },
  regex: {
    padding: theme.spacing(0, 0.5),
    border: "none",
    fontFamily: "monospace",
  },
  list: { flex: 1, overflow: "auto", contain: "strict" },
  summary: { flex: "1 1 200px" },
  wrap: { flexWrap: "wrap" },
}));

/** Highlights parameters whose value changed since the previous update, after the first load. */
function useChangedParameters(
  parameters: ReadonlyMap<string, ParameterValue>,
): ReadonlySet<string> {
  const [changed, setChanged] = useState<ReadonlySet<string>>(EMPTY_SET);
  const previous = useRef(parameters);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const prev = previous.current;
    previous.current = parameters;
    if (prev === parameters || prev.size === 0) {
      return;
    }
    const names = new Set<string>();
    for (const [name, value] of parameters) {
      if (!prev.has(name) || !_.isEqual(prev.get(name), value)) {
        names.add(name);
      }
    }
    if (names.size === 0) {
      return;
    }
    setChanged(names);
    // Kept in a ref so updates without changes don't cancel the reset
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setChanged(EMPTY_SET);
    }, HIGHLIGHT_MS);
  }, [parameters]);

  return changed;
}

function Parameters({ config, saveConfig }: Props): ReactElement {
  const { classes, cx } = useStyles();
  const capabilities = useMessagePipeline(selectCapabilities);
  const setParameter = useMessagePipeline(selectSetParameter);
  const parameters = useMessagePipeline(selectParameters);
  const canGetParams = capabilities.includes(PLAYER_CAPABILITIES.getParameters);
  const canSetParams = capabilities.includes(PLAYER_CAPABILITIES.setParameters);

  const tree = config.flat !== true;
  const snapshots = useMemo(() => config.snapshots ?? [], [config.snapshots]);
  const collapsed = useMemo(() => new Set(config.collapsed ?? []), [config.collapsed]);

  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [compareTo, setCompareTo] = useState<number | undefined>();
  const [onlyDiffs, setOnlyDiffs] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [error, setError] = useState<string | undefined>();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | undefined>();
  const fileInput = useRef<HTMLInputElement>(ReactNull);
  const listRef = useRef<HTMLDivElement>(ReactNull);

  const changed = useChangedParameters(parameters);

  const snapshot = compareTo != undefined ? snapshots[compareTo] : undefined;
  const snapshotValues = useMemo(() => {
    try {
      return snapshot ? parametersFromYaml(snapshot.yaml) : undefined;
    } catch {
      return undefined;
    }
  }, [snapshot]);
  const diff = useMemo(
    () => (snapshotValues ? diffParameters(parameters, snapshotValues) : undefined),
    [parameters, snapshotValues],
  );

  const matcher = useMemo(() => makeMatcher(query, { regex }), [query, regex]);

  const allNames = useMemo(
    () => [...new Set([...parameters.keys(), ...(snapshotValues?.keys() ?? [])])],
    [parameters, snapshotValues],
  );
  const visibleNames = useMemo(
    () =>
      allNames.filter(
        (name) =>
          typeof matcher === "function" &&
          matcher(name) &&
          (!onlyDiffs || diff == undefined || diff.has(name)),
      ),
    [allNames, matcher, onlyDiffs, diff],
  );
  const filtering = query !== "" || onlyDiffs;
  const rows = useMemo(
    () =>
      buildRows(visibleNames, {
        tree,
        collapsed: filtering ? EMPTY_SET : collapsed,
      }),
    [visibleNames, tree, filtering, collapsed],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 29,
    // A name can be both a parameter and a namespace, so include the kind
    getItemKey: (index) => {
      const row = rows[index];
      return row ? `${row.kind}:${row.key}` : index;
    },
    overscan: 10,
    useAnimationFrameWithResizeObserver: true,
  });

  const onToggle = useCallback(
    (key: string) => {
      saveConfig((old) => ({ collapsed: _.xor(old.collapsed ?? [], [key]) }));
    },
    [saveConfig],
  );

  // No debounce: each submit is an explicit user action, and a shared debounce drops edits
  const onSubmit = useCallback(
    (name: string, value: ParameterValue) => {
      setParameter(name, value);
    },
    [setParameter],
  );

  const onToggleSelected = useCallback((name: string) => {
    setSelected((old) => {
      const next = new Set(old);
      if (!next.delete(name)) {
        next.add(name);
      }
      return next;
    });
  }, []);

  const startCompare = (index: number | undefined) => {
    setCompareTo(index);
    setSelected(EMPTY_SET);
    setOnlyDiffs(index != undefined);
    setMenuAnchor(undefined);
  };

  const saveSnapshot = () => {
    const name = new Date().toLocaleString();
    saveConfig((old) => ({
      snapshots: [...(old.snapshots ?? []), { name, yaml: parametersToYaml(parameters) }],
    }));
    setMenuAnchor(undefined);
  };

  const importSnapshot = async (file: File) => {
    try {
      const yaml = await file.text();
      parametersFromYaml(yaml); // validate
      saveConfig((old) => ({
        snapshots: [...(old.snapshots ?? []), { name: file.name, yaml }],
      }));
      startCompare(snapshots.length);
      setError(undefined);
    } catch (err) {
      setError(
        `Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const deleteSnapshot = (index: number) => {
    saveConfig((old) => ({
      snapshots: (old.snapshots ?? []).filter((_s, i) => i !== index),
    }));
    if (compareTo != undefined) {
      startCompare(compareTo === index ? undefined : compareTo > index ? compareTo - 1 : compareTo);
    }
  };

  const applySelected = () => {
    for (const name of selected) {
      setParameter(name, snapshotValues?.get(name));
    }
    setSelected(EMPTY_SET);
  };

  const applicable = useMemo(
    () => [...(diff ?? [])].filter(([, status]) => status !== "added").map(([name]) => name),
    [diff],
  );

  if (!canGetParams) {
    return (
      <Stack fullHeight>
        <PanelToolbar />
        <EmptyState>Connect to a data source that supports parameters to view them</EmptyState>
      </Stack>
    );
  }

  const counts = _.countBy([...(diff?.values() ?? [])]);

  return (
    <Stack fullHeight>
      <PanelToolbar />
      <div className={classes.bar}>
        <InputBase
          className={classes.search}
          placeholder={regex ? "Filter by regex" : "Filter parameters"}
          value={query}
          error={matcher instanceof Error}
          inputProps={{ "aria-label": "Filter parameters", spellCheck: false }}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
            }
          }}
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          }
          endAdornment={
            <>
              {query !== "" && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {visibleNames.length} / {allNames.length}
                </Typography>
              )}
              <Tooltip title="Use regular expression">
                <ToggleButton
                  className={classes.regex}
                  value="regex"
                  size="small"
                  selected={regex}
                  onChange={() => {
                    setRegex(!regex);
                  }}
                >
                  .*
                </ToggleButton>
              </Tooltip>
            </>
          }
        />
        <Tooltip title={tree ? "Show flat list" : "Group by namespace"}>
          <IconButton
            size="small"
            onClick={() => {
              saveConfig({ flat: tree });
            }}
          >
            {tree ? (
              <ViewListIcon fontSize="small" />
            ) : (
              <AccountTreeOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        {tree && (
          <>
            <Tooltip title="Expand all">
              <IconButton
                size="small"
                onClick={() => {
                  saveConfig({ collapsed: [] });
                }}
              >
                <UnfoldMoreIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Collapse all">
              <IconButton
                size="small"
                onClick={() => {
                  saveConfig({ collapsed: allGroupKeys(allNames) });
                }}
              >
                <UnfoldLessIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip title="Snapshots">
          <IconButton
            size="small"
            aria-label="Snapshots"
            onClick={(event) => {
              setMenuAnchor(event.currentTarget);
            }}
          >
            <PhotoCameraOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml"
          hidden
          data-testid="parameters-import"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void importSnapshot(file);
            }
          }}
        />
      </div>
      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor != undefined}
        onClose={() => {
          setMenuAnchor(undefined);
        }}
        slotProps={{ list: { dense: true } }}
      >
        <MenuItem onClick={saveSnapshot}>
          <ListItemIcon>
            <PhotoCameraOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Save snapshot</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            downloadTextFile(parametersToYaml(parameters), "parameters.yaml");
            setMenuAnchor(undefined);
          }}
        >
          <ListItemIcon>
            <FileDownloadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export current as YAML</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            fileInput.current?.click();
            setMenuAnchor(undefined);
          }}
        >
          <ListItemIcon>
            <FileUploadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Import YAML snapshot…</ListItemText>
        </MenuItem>
        {snapshots.length > 0 && <Divider />}
        {snapshots.map((snap, index) => (
          <MenuItem
            key={index}
            selected={index === compareTo}
            onClick={() => {
              startCompare(index);
            }}
          >
            <ListItemText primary={snap.name} secondary="Compare with current" />
            <Tooltip title="Export as YAML">
              <IconButton
                size="small"
                aria-label={`Export ${snap.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  downloadTextFile(snap.yaml, `${snap.name.replace(/[^\w.-]+/g, "_")}.yaml`);
                }}
              >
                <FileDownloadOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete snapshot">
              <IconButton
                size="small"
                aria-label={`Delete ${snap.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  deleteSnapshot(index);
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </MenuItem>
        ))}
      </Menu>
      {error != undefined && (
        <Alert
          severity="error"
          onClose={() => {
            setError(undefined);
          }}
        >
          {error}
        </Alert>
      )}
      {snapshot && (
        <div className={cx(classes.bar, classes.wrap)}>
          <Typography variant="body2" className={classes.summary} title={snapshot.name}>
            vs <b>{snapshot.name}</b>: {counts.changed ?? 0} changed, {counts.added ?? 0} added,{" "}
            {counts.removed ?? 0} removed
          </Typography>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={onlyDiffs}
                onChange={(_event, checked) => {
                  setOnlyDiffs(checked);
                }}
              />
            }
            label={<Typography variant="body2">Only differences</Typography>}
          />
          {canSetParams && applicable.length > 0 && (
            <>
              <Button
                size="small"
                onClick={() => {
                  setSelected(
                    selected.size === applicable.length ? EMPTY_SET : new Set(applicable),
                  );
                }}
              >
                {selected.size === applicable.length ? "Select none" : "Select all"}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={selected.size === 0}
                onClick={applySelected}
              >
                Restore {selected.size}
              </Button>
            </>
          )}
          <Tooltip title="Stop comparing">
            <IconButton
              size="small"
              aria-label="Stop comparing"
              onClick={() => {
                startCompare(undefined);
              }}
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState>
          {matcher instanceof Error
            ? `Invalid regex: ${matcher.message}`
            : allNames.length === 0
              ? "No parameters"
              : "No parameters match the filter"}
        </EmptyState>
      ) : (
        <div ref={listRef} className={classes.list} role="tree">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <ParameterRow
                    row={row}
                    collapsed={collapsed.has(row.key) && !filtering}
                    onToggle={onToggle}
                    value={parameters.get(row.key)}
                    canSet={canSetParams}
                    onSubmit={onSubmit}
                    highlighted={changed.has(row.key)}
                    diff={diff?.get(row.key)}
                    snapshotValue={snapshotValues?.get(row.key)}
                    selected={selected.has(row.key)}
                    onToggleSelected={onToggleSelected}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Stack>
  );
}

Parameters.panelType = "Parameters";
Parameters.defaultConfig = {
  title: "Parameters",
} as ParametersConfig;

export default Panel(Parameters);
