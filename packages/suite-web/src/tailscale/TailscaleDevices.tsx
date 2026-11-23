// SPDX-License-Identifier: MPL-2.0

import {
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useStyles } from "@lichtblick/suite-base/components/DataSourceDialog/index.style";
import Stack from "@lichtblick/suite-base/components/Stack";
import { usePlayerSelection } from "@lichtblick/suite-base/context/PlayerSelectionContext";

import { useTailscaleAccount } from "./TailscaleAccount";

const deviceOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function customBridgeUrl(address: string): string | undefined {
  try {
    const url = new URL(address);
    if (
      (url.protocol === "ws:" || url.protocol === "wss:") &&
      !url.username &&
      !url.password &&
      !url.hash
    ) {
      return url.href;
    }
  } catch {
    // Incomplete address while typing.
  }
  return undefined;
}

export default function TailscaleDevices({ query }: { query: string }): React.JSX.Element {
  const { t } = useTranslation("openDialog");
  const { classes } = useStyles();
  const { status, start } = useTailscaleAccount({ watchPeers: true });
  const { selectSource } = usePlayerSelection();
  const [address, setAddress] = useState<string>();
  useEffect(() => {
    start();
  }, [start]);

  const customUrl = address ? customBridgeUrl(address) : undefined;
  function connect(url: string) {
    selectSource("tailscale", { type: "connection", params: { url } });
  }

  const filter = query.trim().toLowerCase();
  const visiblePeers = (status?.peers ?? [])
    .filter(
      ({ name, label }) =>
        name.toLowerCase().includes(filter) || label?.toLowerCase().includes(filter) === true,
    )
    .sort((a, b) => {
      const priority = Number(b.online === true) - Number(a.online === true);
      return priority !== 0 ? priority : deviceOrder.compare(a.label ?? a.name, b.label ?? b.name);
    });
  const running = status?.state === "Running" && !status.error;
  const signedOut =
    status?.state === "NeedsLogin" ||
    status?.state === "LoggedOut" ||
    status?.state === "NeedsMachineAuth";
  return (
    <Stack gap={0.5} className={classes.recentsFull}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">{t("tailscaleDevices")}</Typography>
        {running && address == undefined && (
          <Button
            size="small"
            color="inherit"
            onClick={() => {
              setAddress("");
            }}
          >
            {t("tailscaleCustomAddress")}
          </Button>
        )}
      </Stack>
      {!running ? (
        <Typography variant="body2" color="textSecondary">
          {t(status?.error ?? (signedOut ? "tailscaleProfileLogin" : "tailscaleStarting"))}
        </Typography>
      ) : (
        <>
          {address != undefined && (
            <Stack direction="row" gap={1} alignItems="center">
              <TextField
                size="small"
                autoFocus
                label={t("tailscaleAddress")}
                placeholder="ws://device:8765"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && customUrl) {
                    event.preventDefault();
                    connect(customUrl);
                  }
                }}
              />
              <Button
                size="small"
                disabled={!customUrl}
                onClick={() => {
                  if (customUrl) {
                    connect(customUrl);
                  }
                }}
              >
                {t("open")}
              </Button>
            </Stack>
          )}
          {visiblePeers.length === 0 ? (
            <Typography variant="body2" color="textSecondary">
              {t(filter ? "tailscaleNoMatches" : "tailscaleNoDevices")}
            </Typography>
          ) : (
            <List
              dense
              disablePadding
              className={classes.recentList}
              aria-label={t("tailscaleDevices")}
            >
              {visiblePeers.map(({ name, label, online }) => {
                const host = name.includes(":") && !name.startsWith("[") ? `[${name}]` : name;
                const url = `ws://${host}:8765`;
                return (
                  <ListItem key={name} disablePadding>
                    <ListItemButton
                      onClick={() => {
                        connect(url);
                      }}
                    >
                      <ListItemText
                        primary={label ?? name.replace(/^([^.]+)\.[^.]+\.ts\.net$/i, "$1")}
                        secondary={url}
                      />
                      <Typography
                        variant="caption"
                        color={online === true ? "success.main" : "textSecondary"}
                        noWrap
                      >
                        {t(
                          online == undefined
                            ? "tailscaleUnknown"
                            : online
                              ? "tailscaleOnline"
                              : "tailscaleOffline",
                        )}
                      </Typography>
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </>
      )}
    </Stack>
  );
}
