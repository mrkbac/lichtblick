// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ArrowDownload20Regular, Delete20Regular } from "@fluentui/react-icons";
import { Button, IconButton, TextField, Tooltip, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { formatByteSize } from "@lichtblick/den/format";
import Catalog from "@lichtblick/suite-base/components/Catalog/Catalog";
import { CatalogRecording } from "@lichtblick/suite-base/components/Catalog/types";
import { useLiveCatalog } from "@lichtblick/suite-base/components/Catalog/useLiveCatalog";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  formatLiveHistoryMemory,
  liveHistorySettings,
} from "@lichtblick/suite-base/players/liveHistory/liveHistorySettings";
import {
  chooseRecordingFolder,
  forgetRecordingFolder,
  getRecordingFolder,
  moveLiveRecordingsToFolder,
  parseLiveRecordingName,
  supportsLiveRecording,
  supportsRecordingFolder,
} from "@lichtblick/suite-base/players/liveHistory/liveRecordings";
import { downloadFiles } from "@lichtblick/suite-base/util/download";

type FolderState = { name: string; permission: PermissionState } | undefined;

const NO_LAST_OPENED: ReadonlyMap<string, number> = new Map();

type Props = {
  /** Search query and its quick filters, see `filterRecordings`; kept locally when not given. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Set by a page that shows the view switch itself. */
  view?: "list" | "grid" | "map";
  lastOpenedByName?: ReadonlyMap<string, number>;
  /** Runs after a recording was opened as the data source. */
  onOpened?: () => void;
};

/**
 * Recordings of live sessions in the catalog view (list, grid, map; topics, previews, GPS tracks),
 * with a filter per machine, download and delete, the disk budget and the folder they move to.
 */
export function LiveRecordingsList({
  query: queryProp,
  onQueryChange: onQueryChangeProp,
  view,
  lastOpenedByName = NO_LAST_OPENED,
  onOpened,
}: Props): React.JSX.Element {
  const { t } = useTranslation("liveRecordings");
  const diskMiB = useStore(liveHistorySettings, (state) => state.diskMiB);
  const [localQuery, setLocalQuery] = useState("");
  const query = queryProp ?? localQuery;
  const onQueryChange = onQueryChangeProp ?? setLocalQuery;
  const [folder, setFolder] = useState<FolderState>();
  const [error, setError] = useState<string>();
  const liveCatalog = useLiveCatalog(t("title"));
  const { rescan, recordingOf } = liveCatalog;

  const refreshFolder = useCallback(async () => {
    const handle = await getRecordingFolder();
    setFolder(
      handle && {
        name: handle.name,
        permission: await handle.queryPermission({ mode: "readwrite" }),
      },
    );
  }, []);

  useEffect(() => {
    void refreshFolder().catch((err: unknown) => {
      setError(String(err));
    });
  }, [refreshFolder]);

  const run = useCallback(
    (action: () => Promise<unknown>) => {
      setError(undefined);
      action()
        .then(async () => {
          await refreshFolder();
          await rescan?.();
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            setError(String(err));
          }
        });
    },
    [refreshFolder, rescan],
  );

  const recordingActions = useCallback(
    (recording: CatalogRecording) => {
      const rec = recordingOf(recording);
      if (!rec) {
        return undefined;
      }
      return (
        <>
          <Tooltip title={t("download")}>
            <IconButton
              aria-label={t("download")}
              onClick={() => {
                // Not through run(): a download changes nothing, so nothing needs reindexing.
                setError(undefined);
                rec
                  .file()
                  .then((blob) => {
                    downloadFiles([{ blob, fileName: rec.name }]);
                  })
                  .catch((err: unknown) => {
                    setError(String(err));
                  });
              }}
            >
              <ArrowDownload20Regular />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("delete")}>
            <IconButton
              aria-label={t("delete")}
              onClick={() => {
                run(rec.remove);
              }}
            >
              <Delete20Regular />
            </IconButton>
          </Tooltip>
        </>
      );
    },
    [recordingOf, run, t],
  );

  const catalogFolder = useMemo(
    () => ({
      ...liveCatalog,
      recordingActions,
      open: async (recording: CatalogRecording) => {
        await liveCatalog.open(recording);
        onOpened?.();
      },
      pickFolder: async () => {
        run(liveCatalog.pickFolder);
      },
    }),
    [liveCatalog, recordingActions, onOpened, run],
  );

  const browserBytes = liveCatalog.recordings.reduce(
    (sum, recording) =>
      sum + (recordingOf(recording)?.location === "browser" ? (recording.size ?? 0) : 0),
    0,
  );
  const recordingNow = liveCatalog.active
    .map((rec) => parseLiveRecordingName(rec.name).machine ?? t("liveSession"))
    .join(", ");

  let status: string | undefined;
  if (!supportsLiveRecording()) {
    status = t("unsupported");
  } else if (diskMiB === 0) {
    status = t("recordingOff");
  }

  return (
    <Stack gap={0.5} flex={1} style={{ minHeight: 0 }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Typography variant="caption" color="textSecondary" style={{ flex: "auto" }}>
          {status ?? (recordingNow !== "" ? t("recordingNow", { machines: recordingNow }) : "")}
        </Typography>
        {diskMiB > 0 && (
          <Typography variant="caption" color="textSecondary" title={t("budgetHint")}>
            {t("budget", {
              used: formatByteSize(browserBytes),
              budget: formatLiveHistoryMemory(diskMiB),
            })}
          </Typography>
        )}
        {supportsRecordingFolder() && folder && folder.permission !== "granted" && (
          <Button
            size="small"
            color="inherit"
            title={t("folderNeedsAccess", { name: folder.name })}
            onClick={() => {
              run(async () => {
                await (await getRecordingFolder())?.requestPermission({ mode: "readwrite" });
                await moveLiveRecordingsToFolder();
              });
            }}
          >
            {t("allowFolder")}
          </Button>
        )}
        {supportsRecordingFolder() && (
          <Button
            size="small"
            color="inherit"
            title={folder ? t("folderInUse", { name: folder.name }) : t("folderHint")}
            onClick={() => {
              run(async () => {
                await chooseRecordingFolder();
                await moveLiveRecordingsToFolder();
              });
            }}
          >
            {folder ? t("folderName", { name: folder.name }) : t("chooseFolder")}
          </Button>
        )}
        {folder && (
          <Button
            size="small"
            color="inherit"
            onClick={() => {
              run(forgetRecordingFolder);
            }}
          >
            {t("stopUsingFolder")}
          </Button>
        )}
      </Stack>
      {error != undefined && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
      {/* The start page has its own search box; elsewhere (the dialog) the list brings one. */}
      {queryProp == undefined && (
        <TextField
          size="small"
          type="search"
          value={query}
          placeholder={t("search")}
          aria-label={t("search")}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
        />
      )}
      <Catalog
        folder={catalogFolder}
        query={query}
        lastOpenedByName={lastOpenedByName}
        onQueryChange={onQueryChange}
        view={view}
      />
    </Stack>
  );
}
