// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import { IconButton, InputBase, Switch, Tooltip } from "@mui/material";
import { ReactElement, useState } from "react";
import { makeStyles } from "tss-react/mui";

import { ParameterValue } from "@lichtblick/suite";
import { customTypography } from "@lichtblick/theme";

import { formatValue, hexToBytes, parameterType } from "./utils";

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  input: {
    flex: 1,
    fontFamily: customTypography.fontMonospace,
    fontSize: theme.typography.body2.fontSize,
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.borderRadius,
    "&:hover": { backgroundColor: theme.palette.action.hover },
    "&.Mui-focused": { backgroundColor: theme.palette.action.selected },
  },
  dirty: {
    boxShadow: `inset 0 0 0 1px ${theme.palette.warning.main}`,
  },
  error: {
    boxShadow: `inset 0 0 0 1px ${theme.palette.error.main}`,
  },
}));

type ParseResult = { value: ParameterValue } | { error: string };

function parserFor(value: ParameterValue): (text: string) => ParseResult {
  switch (parameterType(value)) {
    case "int":
    case "float":
      return (text) => {
        const num = Number(text.trim());
        return text.trim() === "" || Number.isNaN(num) ? { error: "Not a number" } : { value: num };
      };
    case "string":
      return (text) => ({ value: text });
    case "bytes":
      return (text) => {
        const bytes = hexToBytes(text);
        return bytes ? { value: bytes } : { error: "Expected hex bytes, e.g. 00 ff 1a" };
      };
    case "time":
      return (text) => {
        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? { error: "Invalid date" } : { value: date };
      };
    default:
      // Lists, dicts and unset values are edited as JSON
      return (text) => {
        try {
          return { value: JSON.parse(text) as ParameterValue };
        } catch {
          return { error: "Invalid JSON" };
        }
      };
  }
}

function formatForEditing(value: ParameterValue): string {
  return value == undefined ? "null" : formatValue(value);
}

/**
 * Inline editor matching the value's type. Text editors keep a local draft while focused/dirty, so
 * incoming parameter updates don't clobber an in-progress edit. Enter submits, Shift+Enter inserts
 * a newline, Escape resets.
 */
export function ParameterEditor({
  name,
  value,
  onSubmit,
}: {
  name: string;
  value: ParameterValue;
  onSubmit: (name: string, value: ParameterValue) => void;
}): ReactElement {
  const { classes, cx } = useStyles();
  const [draft, setDraft] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  if (typeof value === "boolean") {
    return (
      <div className={classes.root}>
        <Switch
          size="small"
          checked={value}
          slotProps={{ input: { "aria-label": name } }}
          onChange={(_event, checked) => {
            onSubmit(name, checked);
          }}
        />
      </div>
    );
  }

  const text = draft ?? formatForEditing(value);
  const dirty = draft != undefined && draft !== formatForEditing(value);
  const multiline = parameterType(value) === "list" || parameterType(value) === "dict";

  const reset = () => {
    setDraft(undefined);
    setError(undefined);
  };
  const submit = () => {
    if (draft == undefined || !dirty) {
      reset();
      return;
    }
    const result = parserFor(value)(draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSubmit(name, result.value);
    reset();
  };

  return (
    <div className={classes.root}>
      <Tooltip title={error ?? ""} open={error != undefined} placement="bottom-start" arrow>
        <InputBase
          className={cx(classes.input, {
            [classes.dirty]: dirty,
            [classes.error]: error != undefined,
          })}
          value={text}
          multiline={multiline}
          maxRows={8}
          inputProps={{ "aria-label": name, spellCheck: false }}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              reset();
            }
          }}
          onBlur={() => {
            // Leaving an untouched field shouldn't pin the draft
            if (!dirty) {
              reset();
            }
          }}
        />
      </Tooltip>
      {dirty && (
        <>
          <Tooltip title="Submit (Enter)">
            <IconButton size="small" onClick={submit}>
              <CheckIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reset (Esc)">
            <IconButton size="small" onClick={reset}>
              <ClearIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      )}
    </div>
  );
}
