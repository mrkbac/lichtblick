// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { Button, IconButton, InputAdornment, TextField, Tooltip, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput.style";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import {
  detectConnection,
  hostUrl,
  looksLikeHost,
} from "@lichtblick/suite-base/util/recentSources";

const SEARCH_FILTER = /^(topic|schema|path|since|until|duration|size|status|has)[:<>]/i;

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Label of the result Enter opens when the input is a search, not a URL. */
  topMatch?: string;
  onOpenTopMatch: () => void;
};

/**
 * Address bar of the start page: a URL or a bare host opens that source (the source type is
 * detected and can be changed), anything else searches recents and the catalog, and Enter opens
 * the top result. Hints sit inside the box so typing never shifts the page.
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

  const trimmed = value.trim();
  // Search filters such as since:2026 or path:2026/ look like host:port
  const explicitUrl =
    !SEARCH_FILTER.test(trimmed) && (trimmed.includes("://") || /^[\w.-]+:\d+/.test(trimmed));
  // A bare host (robot.local, 192.168.1.5) connects only when the search finds nothing, so typing
  // part of a recording's name still searches.
  const bareHost = !explicitUrl && topMatch == undefined && looksLikeHost(trimmed);
  const isUrl = explicitUrl || bareHost;
  const detected = explicitUrl
    ? detectConnection(trimmed)
    : bareHost
      ? { sourceId: "foxglove-websocket", url: hostUrl(trimmed, "foxglove-websocket") }
      : undefined;
  const url = detected?.url ?? trimmed;
  // A previously used URL keeps the source it was opened with (e.g. rosbridge on a custom port)
  const recentMatch = recentSources.find(
    (recent) => recent.type === "connection" && recent.title === url,
  );
  const sourceId = recentMatch?.sourceId ?? detected?.sourceId;
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

  const help = (
    <Stack gap={1} className={classes.help}>
      <Typography variant="subtitle2">{t("searchHelpTitle")}</Typography>
      <Typography variant="body2">{t("searchHelpConnect")}</Typography>
      <Typography variant="body2">{t("searchHelpSearch")}</Typography>
      <Typography variant="body2" className={classes.code}>
        {t("searchHelpFilters")}
      </Typography>
      <Typography variant="body2">{t("searchHelpOr")}</Typography>
    </Stack>
  );

  const hint = isUrl ? (
    <>
      <Typography variant="caption" color={source ? "text.secondary" : "error"} noWrap>
        {source ? t("enterOpensUrl", { url, type: source.displayName }) : t("unrecognizedUrl")}
      </Typography>
    </>
  ) : topMatch != undefined && trimmed !== "" ? (
    <Typography variant="caption" color="text.secondary" noWrap className={classes.topMatch}>
      {t("enterOpens", { name: topMatch })}
    </Typography>
  ) : undefined;

  return (
    <Stack gap={0.5}>
      {/* Buttons stretch to the box's height so the row lines up. */}
      <Stack direction="row" gap={1} alignItems="stretch">
        <TextField
          autoFocus
          type="search"
          size="small"
          className={classes.input}
          value={value}
          placeholder={t("openUrlPlaceholder")}
          error={error != undefined}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end" className={classes.adornment}>
                  {hint}
                  <Tooltip
                    title={help}
                    placement="bottom-end"
                    classes={{ tooltip: classes.helpTooltip }}
                  >
                    <IconButton size="small" edge="end" aria-label={t("searchHelp")}>
                      <InfoOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            },
          }}
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
          size="small"
          disabled={isUrl ? !source : topMatch == undefined}
          onClick={open}
        >
          {t("open")}
        </Button>
        <Button
          className={classes.button}
          variant="outlined"
          size="small"
          onClick={() => {
            dialogActions.dataSource.open("file");
          }}
        >
          {t("openLocalFiles")}
        </Button>
        <Tooltip title={t("moreConnectionOptions")}>
          <IconButton
            size="small"
            aria-label={t("moreConnectionOptions")}
            onClick={() => {
              dialogActions.dataSource.open("connection");
            }}
          >
            <MoreHorizIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      {error != undefined && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Stack>
  );
}
