// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ArrowDownload16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import {
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { formatByteSize } from "@lichtblick/den/format";
import { BuiltinIcon } from "@lichtblick/suite-base/components/BuiltinIcon";
import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/index.style";
import { useStyles as useLabelStyles } from "@lichtblick/suite-base/components/RecentSourceLabel.style";
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
import { formatTimeAgo } from "@lichtblick/suite-base/util/recentSources";

type FolderState = { name: string; permission: PermissionState } | undefined;

/**
 * Recordings of live sessions with open, download and delete, and the folder they are moved to.
 * `onOpened` runs after a recording was opened as the data source.
 */
export function LiveRecordingsList({ onOpened }: { onOpened?: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation("liveRecordings");
  const { selectSource } = usePlayerSelection();
  const { classes } = useStyles();
  const { classes: labelClasses } = useLabelStyles();
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

  const open = (rec: LiveRecording) => {
    run(async () => {
      selectSource("mcap-local-file", { type: "file", files: [await rec.file()] });
      onOpened?.();
    });
  };

  let folderAction: React.ReactNode;
  if (supportsRecordingFolder()) {
    folderAction =
      folder && folder.permission !== "granted" ? (
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
      ) : (
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
      );
  }

  let status: string | undefined;
  if (!supportsLiveRecording()) {
    status = t("unsupported");
  } else if (diskMiB === 0) {
    status = t("recordingOff");
  } else if (recordings?.length === 0) {
    status = t("empty");
  }

  return (
    <Stack gap={0.5} flex={1} style={{ minHeight: 0 }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Typography variant="subtitle2" style={{ flex: "auto" }}>
          {t("title")}
        </Typography>
        {diskMiB > 0 && (
          <Typography variant="caption" color="textSecondary" title={t("budgetHint")}>
            {t("budget", {
              used: formatByteSize(browserBytes),
              budget: formatLiveHistoryMemory(diskMiB),
            })}
          </Typography>
        )}
        {folderAction}
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
      {status != undefined && (
        <Typography variant="body2" color="textSecondary">
          {status}
        </Typography>
      )}
      {error != undefined && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}
      {recordings != undefined && recordings.length > 0 && (
        <List disablePadding dense className={classes.recentList}>
          {recordings.map((rec) => {
            const started = liveRecordingStart(rec.name);
            const secondary = [
              rec.active ? t("recording") : formatByteSize(rec.sizeBytes),
              rec.active ? undefined : formatTimeAgo(rec.lastModified, Date.now(), i18n.language),
              rec.location === "folder" ? folder?.name : t("browserStorage"),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <ListItem
                disablePadding
                key={`${rec.location}/${rec.name}`}
                className={classes.recentListItem}
                secondaryAction={
                  !rec.active && (
                    <>
                      <Tooltip title={t("download")}>
                        <IconButton
                          size="small"
                          aria-label={t("download")}
                          className="recent-action"
                          onClick={() => {
                            run(async () => {
                              downloadFiles([{ blob: await rec.file(), fileName: rec.name }]);
                            });
                          }}
                        >
                          <ArrowDownload16Regular />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t("delete")}>
                        <IconButton
                          size="small"
                          edge="end"
                          aria-label={t("delete")}
                          className="recent-action"
                          onClick={() => {
                            run(rec.remove);
                          }}
                        >
                          <Dismiss16Regular />
                        </IconButton>
                      </Tooltip>
                    </>
                  )
                }
              >
                <ListItemButton
                  disabled={rec.active}
                  onClick={() => {
                    open(rec);
                  }}
                >
                  <Tooltip
                    title={rec.name}
                    placement="top-start"
                    enterDelay={500}
                    disableInteractive
                  >
                    <div className={labelClasses.root}>
                      <span className={labelClasses.icon}>
                        <BuiltinIcon name="Flow" />
                      </span>
                      <div className={labelClasses.text}>
                        <Typography variant="body2" noWrap>
                          {started
                            ? t("sessionFrom", {
                                time: started.toLocaleString(i18n.language, {
                                  dateStyle: "medium",
                                  timeStyle: "medium",
                                }),
                              })
                            : rec.name}
                        </Typography>
                        <Typography variant="caption" noWrap component="div" color="textSecondary">
                          {secondary}
                        </Typography>
                      </div>
                    </div>
                  </Tooltip>
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      )}
    </Stack>
  );
}

/** Start of a recording from its name ("live-2026-11-07T10-30-00-123-k3f9.mcap"), if it has one. */
function liveRecordingStart(name: string): Date | undefined {
  const match = /^live-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?/.exec(name);
  if (!match) {
    return undefined;
  }
  const [, day, hours, minutes, seconds, millis = "000"] = match;
  return new Date(`${day}T${hours}:${minutes}:${seconds}.${millis}Z`);
}
