// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import {
  Button,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { FormField } from "@lichtblick/suite-base/components/DataSourceDialog/FormField";
import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/OpenUrlInput.style";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  IDataSourceFactory,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import {
  detectConnection,
  hostUrl,
  looksLikeHost,
} from "@lichtblick/suite-base/util/recentSources";

/** id of the address bar, so the open-connection shortcut can focus it while the page is open. */
export const START_ADDRESS_INPUT_ID = "start-address-input";

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
 * detected, or picked from the ⋯ menu along with any extra fields it needs), anything else
 * searches recents and the catalog, and Enter opens the top result. Hints sit inside the box so
 * typing never shifts the page.
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
  // Source picked from the ⋯ menu; undefined detects it from the input
  const [pickedId, setPickedId] = useState<string | undefined>();
  // Values and errors of the picked source's fields other than the URL
  const [fieldValues, setFieldValues] = useState<Record<string, string | undefined>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  const connectionSources = useMemo(
    () =>
      availableSources.filter(
        (source) =>
          source.type === "connection" &&
          source.hidden !== true &&
          source.disabledReason == undefined,
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
  const picked = connectionSources.find((s) => s.id === pickedId);
  const fields = picked?.formConfig?.fields ?? [];
  const defaultUrlOf = (s: IDataSourceFactory | undefined) =>
    s?.formConfig?.fields.find((field) => field.id === "url")?.defaultValue;
  const hasUrlField = (s: IDataSourceFactory) =>
    s.formConfig?.fields.some((field) => field.id === "url") ?? false;
  const sourceId = recentMatch?.sourceId ?? detected?.sourceId;
  const source =
    picked ??
    (isUrl ? connectionSources.find((s) => s.id === sourceId && hasUrlField(s)) : undefined);
  const connects = picked != undefined || isUrl;
  // Extra fields only show for a picked source, so a detected one opens with their defaults
  const extraFields = fields.filter((field) => field.id !== "url");
  const hasFieldErrors = Object.values(fieldErrors).some((err) => err != undefined);

  const pick = (next: IDataSourceFactory | undefined) => {
    setMenuAnchor(undefined);
    setPickedId(next?.id);
    setFieldValues({});
    setFieldErrors({});
    setError(undefined);
    const defaultUrl = defaultUrlOf(next);
    // Keep a URL the user typed, but replace another source's prefilled default
    const isDefault = connectionSources.some((s) => defaultUrlOf(s) === trimmed);
    if (defaultUrl != undefined && (!isUrl || isDefault)) {
      onChange(defaultUrl);
    }
    inputRef.current?.focus();
  };

  const connect = () => {
    if (!source || hasFieldErrors) {
      return;
    }
    if (recentMatch?.sourceId === source.id && extraFields.length === 0) {
      selectRecent(recentMatch.id);
      return;
    }
    const sourceFields = source.formConfig?.fields ?? [];
    const urlField = sourceFields.find((field) => field.id === "url");
    const urlError = urlField?.validate?.(url);
    if (urlError instanceof Error) {
      setError(urlError.message);
      return;
    }
    const defaults = Object.fromEntries(
      sourceFields.map((field) => [field.id, field.defaultValue]),
    );
    selectSource(source.id, {
      type: "connection",
      params: { ...defaults, ...fieldValues, ...(urlField ? { url } : {}) },
    });
  };

  const open = connects ? connect : onOpenTopMatch;

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

  const hint = connects ? (
    <Typography variant="caption" color={source ? "text.secondary" : "error"} noWrap>
      {source == undefined
        ? t("unrecognizedUrl")
        : hasUrlField(source)
          ? t("enterOpensUrl", { url, type: source.displayName })
          : t("enterOpens", { name: source.displayName })}
    </Typography>
  ) : topMatch != undefined && trimmed !== "" ? (
    <Typography
      variant="caption"
      noWrap
      className={classes.topMatch}
      sx={{
        color: "text.secondary",
      }}
    >
      {t("enterOpens", { name: topMatch })}
    </Typography>
  ) : undefined;

  return (
    <Stack gap={0.5}>
      {/* Buttons stretch to the box's height so the row lines up. */}
      <Stack direction="row" gap={1} alignItems="stretch">
        <TextField
          autoFocus
          inputRef={inputRef}
          id={START_ADDRESS_INPUT_ID}
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
            // Clearing the box goes back to searching
            if (event.target.value === "") {
              setPickedId(undefined);
            }
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
          disabled={connects ? !source || hasFieldErrors : topMatch == undefined}
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
        <Tooltip title={t("connectionType")}>
          <IconButton
            size="small"
            aria-label={t("connectionType")}
            onClick={(event) => {
              setMenuAnchor(event.currentTarget);
            }}
          >
            <MoreHorizIcon />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={menuAnchor}
          open={menuAnchor != undefined}
          onClose={() => {
            setMenuAnchor(undefined);
          }}
        >
          <MenuItem
            selected={picked == undefined}
            onClick={() => {
              pick(undefined);
            }}
          >
            {t("detectConnectionType")}
          </MenuItem>
          {connectionSources.map((s) => (
            <MenuItem
              key={s.id}
              selected={s === picked}
              onClick={() => {
                pick(s);
              }}
            >
              {s.displayName}
            </MenuItem>
          ))}
        </Menu>
      </Stack>
      {extraFields.length > 0 && (
        <Stack direction="row" gap={1} key={picked?.id}>
          {extraFields.map((field) => (
            <FormField
              key={field.id}
              field={field}
              disabled={false}
              onError={(message) => {
                setFieldErrors((old) => ({ ...old, [field.id]: message }));
              }}
              onChange={(newValue) => {
                setFieldErrors((old) => ({ ...old, [field.id]: undefined }));
                setFieldValues((old) => ({ ...old, [field.id]: newValue }));
              }}
            />
          ))}
        </Stack>
      )}
      {error != undefined && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
    </Stack>
  );
}
