// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button, Link, MenuItem, Select, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput.style";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import { detectConnection } from "@lichtblick/suite-base/util/recentSources";

const SEARCH_FILTER = /^(topic|schema|path|since|until|duration|size|status)[:<>]/i;

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Label of the result Enter opens when the input is a search, not a URL. */
  topMatch?: string;
  onOpenTopMatch: () => void;
};

/**
 * Address bar of the start page: a URL opens that source (the source type is detected from it),
 * anything else searches recents and the catalog, and Enter opens the top result.
 */
export function OpenUrlInput({
  value,
  onChange,
  topMatch,
  onOpenTopMatch,
}: Props): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("openDialog");
  const { availableSources, recentSources, selectRecent, selectSource } = usePlayerSelection();
  const { dialogActions } = useWorkspaceActions();

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

  const hasInput = value.trim() !== "";
  const trimmed = value.trim();
  // Search filters such as since:2026 or path:2026/ look like host:port
  const isUrl =
    !SEARCH_FILTER.test(trimmed) && (trimmed.includes("://") || /^[\w.-]+:\d+/.test(trimmed));
  const detected = isUrl ? detectConnection(trimmed) : undefined;
  const url = detected?.url ?? trimmed;
  // A previously used URL keeps the source it was opened with (e.g. rosbridge on a custom port)
  const recentMatch = recentSources.find(
    (recent) => recent.type === "connection" && recent.title === url,
  );
  const sourceId = overrideSourceId ?? recentMatch?.sourceId ?? detected?.sourceId;
  const source = isUrl ? urlSources.find((s) => s.id === sourceId) : undefined;

  const openUrl = () => {
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

  const open = isUrl ? openUrl : onOpenTopMatch;

  return (
    <Stack gap={0.5}>
      <Stack direction="row" gap={1} alignItems="flex-start">
        <TextField
          autoFocus
          type="search"
          className={classes.input}
          value={value}
          placeholder={t("openUrlPlaceholder")}
          error={error != undefined}
          helperText={error}
          slotProps={{ formHelperText: { variant: "standard" } }}
          onChange={(event) => {
            onChange(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              open();
            }
          }}
        />
        <Button
          className={classes.button}
          variant="contained"
          size="large"
          disabled={isUrl ? !source : topMatch == undefined}
          onClick={open}
        >
          {t("open")}
        </Button>
        <Button
          className={classes.button}
          variant="outlined"
          size="large"
          onClick={() => {
            dialogActions.dataSource.open("file");
          }}
        >
          {t("openLocalFiles")}
        </Button>
        <Link
          component="button"
          variant="body2"
          className={classes.moreLink}
          onClick={() => {
            dialogActions.dataSource.open("connection");
          }}
        >
          {t("moreConnectionOptions")}
        </Link>
      </Stack>
      {isUrl && (
        <Stack direction="row" gap={0.5} alignItems="center">
          <Typography variant="body2" color={source ? "text.secondary" : "error"}>
            {source ? t("enterOpensUrl", { url }) : t("unrecognizedUrl")}
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
      {hasInput && !isUrl && (
        <Typography variant="caption" color="text.secondary">
          {topMatch != undefined ? `${t("enterOpens", { name: topMatch })} · ` : ""}
          {t("searchHelp")}
        </Typography>
      )}
    </Stack>
  );
}
