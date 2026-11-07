// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Delete20Regular, ArrowDownload20Regular, Open20Regular } from "@fluentui/react-icons";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore, create } from "zustand";

import { formatByteSize } from "@lichtblick/den/format";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";
import {
  formatLiveHistoryMemory,
  liveHistorySettings,
} from "@lichtblick/suite-base/players/liveHistory/liveHistorySettings";
import {
  chooseRecordingFolder,
  forgetRecordingFolder,
  getRecordingFolder,
  listLiveRecordings,
  LiveRecording,
  moveLiveRecordingsToFolder,
  supportsLiveRecording,
  supportsRecordingFolder,
} from "@lichtblick/suite-base/players/liveHistory/liveRecordings";
import { downloadFiles } from "@lichtblick/suite-base/util/download";

/** Whether the live recordings dialog is open, so the app menu can open it. */
export const useLiveRecordingsDialog = create<{
  open: boolean;
  show: () => void;
  hide: () => void;
}>()((set) => ({
  open: false,
  show: () => {
    set({ open: true });
  },
  hide: () => {
    set({ open: false });
  },
}));

type FolderState = { name: string; permission: PermissionState } | undefined;

/**
 * Recordings of live sessions with open, download and delete, and the folder they are moved to.
 * `onOpened` runs after a recording was opened as the data source.
 */
export function LiveRecordingsList({ onOpened }: { onOpened?: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation("liveRecordings");
  const { selectSource } = usePlayerSelection();
  const diskMiB = useStore(liveHistorySettings, (state) => state.diskMiB);
  const [recordings, setRecordings] = useState<LiveRecording[]>();
  const [folder, setFolder] = useState<FolderState>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const handle = await getRecordingFolder();
      setFolder(
        handle && {
          name: handle.name,
          permission: await handle.queryPermission({ mode: "readwrite" }),
        },
      );
      setRecordings(await listLiveRecordings());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (action: () => Promise<unknown>) => {
    setError(undefined);
    action()
      .then(refresh)
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(String(err));
        }
      });
  };

  const browserBytes = (recordings ?? [])
    .filter((rec) => rec.location === "browser")
    .reduce((sum, rec) => sum + rec.sizeBytes, 0);

  return (
    <Stack gap={1.5}>
      <Typography variant="body2" color="text.secondary">
        {diskMiB === 0
          ? t("recordingOff")
          : t("budget", {
              used: formatByteSize(browserBytes),
              budget: formatLiveHistoryMemory(diskMiB),
            })}
      </Typography>
      {!supportsLiveRecording() && (
        <Typography variant="body2" color="error">
          {t("unsupported")}
        </Typography>
      )}
      {recordings?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("empty")}
        </Typography>
      )}
      {recordings != undefined && recordings.length > 0 && (
        <List dense disablePadding>
          {recordings.map((rec) => (
            <ListItem
              key={`${rec.location}/${rec.name}`}
              disableGutters
              secondaryAction={
                <Stack direction="row">
                  <Tooltip title={t("open")}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t("open")}
                        disabled={rec.active}
                        onClick={() => {
                          run(async () => {
                            selectSource("mcap-local-file", {
                              type: "file",
                              files: [await rec.file()],
                            });
                            onOpened?.();
                          });
                        }}
                      >
                        <Open20Regular />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("download")}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t("download")}
                        disabled={rec.active}
                        onClick={() => {
                          run(async () => {
                            downloadFiles([{ blob: await rec.file(), fileName: rec.name }]);
                          });
                        }}
                      >
                        <ArrowDownload20Regular />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("delete")}>
                    <span>
                      <IconButton
                        size="small"
                        aria-label={t("delete")}
                        disabled={rec.active}
                        onClick={() => {
                          run(rec.remove);
                        }}
                      >
                        <Delete20Regular />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              }
            >
              <ListItemText
                primary={rec.name}
                secondary={[
                  rec.active ? t("recording") : formatByteSize(rec.sizeBytes),
                  rec.active ? undefined : new Date(rec.lastModified).toLocaleString(i18n.language),
                  rec.location === "folder" ? folder?.name : t("browserStorage"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </ListItem>
          ))}
        </List>
      )}
      {supportsRecordingFolder() && (
        <Stack gap={0.5}>
          <Typography variant="body2" color="text.secondary">
            {folder
              ? folder.permission === "granted"
                ? t("folderInUse", { name: folder.name })
                : t("folderNeedsAccess", { name: folder.name })
              : t("folderHint")}
          </Typography>
          <Stack direction="row" gap={1}>
            {folder?.permission !== "granted" && folder != undefined && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  run(async () => {
                    const handle = await getRecordingFolder();
                    await handle?.requestPermission({ mode: "readwrite" });
                    await moveLiveRecordingsToFolder();
                  });
                }}
              >
                {t("allowFolder")}
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                run(async () => {
                  await chooseRecordingFolder();
                  await moveLiveRecordingsToFolder();
                });
              }}
            >
              {folder ? t("changeFolder") : t("chooseFolder")}
            </Button>
            {folder && (
              <Button
                size="small"
                onClick={() => {
                  run(forgetRecordingFolder);
                }}
              >
                {t("stopUsingFolder")}
              </Button>
            )}
          </Stack>
        </Stack>
      )}
      {error != undefined && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
    </Stack>
  );
}

/** Recordings of live sessions: open, download or delete them, and pick a folder to move them to. */
export function LiveRecordingsDialog(): React.JSX.Element | null {
  const { t } = useTranslation("liveRecordings");
  const open = useLiveRecordingsDialog((state) => state.open);
  const hide = useLiveRecordingsDialog((state) => state.hide);
  if (!open) {
    return null;
  }
  return (
    <Dialog open onClose={hide} fullWidth maxWidth="sm">
      <DialogTitle>{t("title")}</DialogTitle>
      <DialogContent>
        <LiveRecordingsList onOpened={hide} />
      </DialogContent>
      <DialogActions>
        <Button onClick={hide}>{t("close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
