// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  Autocomplete,
  Button,
  Link,
  MenuItem,
  Select,
  TextField,
  Typography,
  createFilterOptions,
} from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput.style";
import { RecentSourceLabel } from "@lichtblick/suite-base/components/RecentSourceLabel";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  RecentSource,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { detectConnection } from "@lichtblick/suite-base/util/recentSources";

const filterOptions = createFilterOptions<RecentSource>({
  stringify: (option) => `${option.title} ${option.label ?? ""}`,
  limit: 10,
});

/**
 * Single input to open a data source: type a URL (the source type is detected from it), pick one
 * of the recent sources, or open local files.
 */
export function OpenUrlInput(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("openDialog");
  const { availableSources, recentSources, selectRecent, selectSource } = usePlayerSelection();
  const { dialogActions } = useWorkspaceActions();

  const [input, setInput] = useState("");
  const [overrideSourceId, setOverrideSourceId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  // Connection sources that are opened with just a URL
  const urlSources = useMemo(
    () =>
      availableSources.filter(
        (source) =>
          source.type === "connection" &&
          source.hidden !== true &&
          source.disabledReason == undefined &&
          (source.formConfig?.fields.some((field) => field.id === "url") ?? false),
      ),
    [availableSources],
  );

  const hasInput = input.trim() !== "";
  const detected = detectConnection(input);
  const url = detected?.url ?? input.trim();
  // A previously used URL keeps the source it was opened with (e.g. rosbridge on a custom port)
  const recentMatch = recentSources.find(
    (recent) => recent.type === "connection" && recent.title === url,
  );
  const sourceId = overrideSourceId ?? recentMatch?.sourceId ?? detected?.sourceId;
  const source = urlSources.find((s) => s.id === sourceId);

  const open = () => {
    if (!source) {
      return;
    }
    if (recentMatch?.sourceId === source.id) {
      selectRecent(recentMatch.id);
      return;
    }
    const fields = source.formConfig?.fields ?? [];
    const urlError = fields.find((field) => field.id === "url")?.validate?.(url);
    if (urlError instanceof Error) {
      setError(urlError.message);
      return;
    }
    const defaults = Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]));
    selectSource(source.id, {
      type: "connection",
      params: { ...defaults, url },
    });
  };

  return (
    <Stack gap={1}>
      <Stack direction="row" gap={1} alignItems="flex-start">
        <Autocomplete<RecentSource, false, false, true>
          freeSolo
          className={classes.input}
          options={recentSources}
          filterOptions={filterOptions}
          getOptionLabel={(option) => (typeof option === "string" ? option : option.title)}
          inputValue={input}
          onInputChange={(_event, value) => {
            setInput(value);
            setError(undefined);
          }}
          onChange={(_event, value) => {
            if (typeof value === "string") {
              open();
            } else if (value != undefined) {
              selectRecent(value.id);
            }
          }}
          renderOption={(props, option) => {
            const { key: _key, ...optionProps } = props;
            return (
              <li key={option.id} {...optionProps}>
                <RecentSourceLabel recent={option} />
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              autoFocus
              placeholder={t("openUrlPlaceholder")}
              error={error != undefined}
              helperText={error}
              slotProps={{ formHelperText: { variant: "standard" } }}
            />
          )}
        />
        <Button
          className={classes.button}
          variant="contained"
          size="large"
          disabled={!source}
          onClick={open}
        >
          {t("open")}
        </Button>
      </Stack>
      {hasInput && (
        <Stack direction="row" gap={0.5} alignItems="center">
          <Typography variant="body2" color={source ? "text.secondary" : "error"}>
            {source ? t("opensWith") : t("unrecognizedUrl")}
          </Typography>
          <Select
            variant="standard"
            disableUnderline
            displayEmpty
            className={classes.sourceSelect}
            value={source?.id ?? ""}
            renderValue={() => source?.displayName ?? t("chooseSourceType")}
            onChange={(event) => {
              setOverrideSourceId(event.target.value);
            }}
            inputProps={{ "aria-label": t("sourceType") }}
          >
            {urlSources.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.displayName}
              </MenuItem>
            ))}
          </Select>
        </Stack>
      )}
      <Stack direction="row" gap={2} alignItems="center">
        <Button
          className={classes.button}
          variant="outlined"
          onClick={() => {
            dialogActions.dataSource.open("file");
          }}
        >
          {t("openLocalFiles")}
        </Button>
        <Link
          component="button"
          variant="body2"
          onClick={() => {
            dialogActions.dataSource.open("connection");
          }}
        >
          {t("moreConnectionOptions")}
        </Link>
      </Stack>
    </Stack>
  );
}
