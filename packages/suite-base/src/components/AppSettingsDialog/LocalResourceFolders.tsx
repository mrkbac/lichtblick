// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Alert, Button, FormLabel, Typography } from "@mui/material";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import Stack from "@lichtblick/suite-base/components/Stack";
import { localResourceFolders } from "@lichtblick/suite-base/util/localResourceFolders";

const useStyles = makeStyles()({ path: { overflowWrap: "anywhere" } });

export function LocalResourceFolders(): React.JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("appSettings");
  const { folders } = useSyncExternalStore(
    localResourceFolders.subscribe,
    localResourceFolders.getSnapshot,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const supported = "showDirectoryPicker" in window;
  useEffect(() => {
    void localResourceFolders.restore();
  }, []);
  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };
  const select = async () => {
    await run(async () => {
      const folder = await window.showDirectoryPicker({
        id: "lichtblick-ros-resources",
        mode: "read",
      });
      setBusy(true);
      await localResourceFolders.add(folder);
    });
  };
  const reconnect = async (id: string) => {
    await run(async () => {
      setBusy(true);
      await localResourceFolders.reconnect(id);
    });
  };
  return (
    <Stack gap={1}>
      <FormLabel>{t("localResourceFolders")}</FormLabel>
      <Typography variant="body2" color="text.secondary">
        {t("localResourceFoldersDescription")}
      </Typography>
      {!supported && <Alert severity="info">{t("localResourceFoldersUnsupported")}</Alert>}
      {folders.map((folder) => (
        <Stack key={folder.id} gap={1}>
          <Typography variant="body2">
            {folder.needsPermission
              ? t("resourceFolderNeedsPermission", { name: folder.name })
              : t("localResourceFolderSummary", {
                  name: folder.name,
                  count: folder.packages.length,
                })}
          </Typography>
          <Typography
            variant="caption"
            className={classes.path}
          >{`local-asset://${folder.id}/`}</Typography>
          {folder.needsPermission && (
            <Button size="small" disabled={busy} onClick={() => void reconnect(folder.id)}>
              {t("reconnectResourceFolder")}
            </Button>
          )}
          <Button
            size="small"
            disabled={busy}
            onClick={() => {
              localResourceFolders.remove(folder.id);
            }}
          >
            {t("removeResourceFolder")}
          </Button>
        </Stack>
      ))}
      {error && <Alert severity="error">{error}</Alert>}
      <Button disabled={!supported || busy} onClick={() => void select()}>
        {busy ? t("scanningResourceFolder") : t("selectResourceFolder")}
      </Button>
    </Stack>
  );
}
