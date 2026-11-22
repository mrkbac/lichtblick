// SPDX-License-Identifier: MPL-2.0

import { Button, Divider, ListItem, ListSubheader, MenuItem, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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

function shortPeer(peer: string): string {
  return peer.replace(/^([^.]+)\.[^.]+\.ts\.net$/i, "$1");
}

export default function TailscaleMenu({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation("openDialog");
  const { status, start, logout } = useTailscaleAccount();
  const { selectSource } = usePlayerSelection();
  const [filter, setFilter] = useState("");
  const [address, setAddress] = useState<string>();
  useEffect(() => {
    start();
  }, [start]);

  function connect(url: string) {
    selectSource("tailscale", { type: "connection", params: { url } });
    onClose();
  }
  function connectPeer(peer: string) {
    const host = peer.includes(":") && !peer.startsWith("[") ? `[${peer}]` : peer;
    connect(`ws://${host}:8765`);
  }
  function signOut() {
    logout();
    onClose();
  }

  if (status?.error) {
    return (
      <>
        <MenuItem disabled>{t(status.error)}</MenuItem>
        <MenuItem onClick={start}>{t("tailscaleRetry")}</MenuItem>
        {status.error === "tailscaleStorageError" && (
          <MenuItem onClick={signOut}>{t("tailscaleLogout")}</MenuItem>
        )}
      </>
    );
  }
  if (status?.state !== "Running") {
    if (status?.state === "NeedsMachineAuth") {
      return <MenuItem disabled>{t("tailscaleApproval")}</MenuItem>;
    }
    if (status?.login) {
      return (
        <MenuItem component="a" href={status.login} target="_blank" rel="noopener noreferrer">
          {t("tailscaleLogin")}
        </MenuItem>
      );
    }
    if (status?.state === "LoggedOut") {
      return <MenuItem onClick={start}>{t("tailscaleLogin")}</MenuItem>;
    }
    return <MenuItem disabled>{t("tailscaleStarting")}</MenuItem>;
  }

  const url = address ? customBridgeUrl(address) : undefined;
  const showFilter = status.peers.length > 8;
  const query = showFilter ? filter.trim().toLowerCase() : "";
  const visiblePeers = status.peers
    .filter((peer) => peer.toLowerCase().includes(query))
    .sort(deviceOrder.compare);
  const names = new Map<string, number>();
  for (const peer of status.peers) {
    const name = shortPeer(peer);
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  return (
    <>
      <ListSubheader disableSticky>{t("tailscaleDevices")}</ListSubheader>
      {showFilter && (
        <ListItem>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t("tailscaleFilter")}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)) {
                event.stopPropagation();
              }
              if (event.key === "Enter" && visiblePeers.length === 1) {
                event.preventDefault();
                connectPeer(visiblePeers[0]!);
              }
            }}
          />
        </ListItem>
      )}
      {visiblePeers.length === 0 && (
        <MenuItem disabled>{t(query ? "tailscaleNoMatches" : "tailscaleNoDevices")}</MenuItem>
      )}
      {visiblePeers.map((peer) => {
        const name = shortPeer(peer);
        return (
          <MenuItem
            key={peer}
            title={peer}
            onClick={() => {
              connectPeer(peer);
            }}
          >
            {names.get(name) === 1 ? name : peer}
          </MenuItem>
        );
      })}
      {address != undefined ? (
        <ListItem>
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
              if (event.key !== "Escape" && event.key !== "Tab") {
                event.stopPropagation();
              }
              if (event.key === "Enter" && url) {
                event.preventDefault();
                connect(url);
              }
            }}
          />
          <Button
            size="small"
            disabled={!url}
            onClick={() => {
              if (url) {
                connect(url);
              }
            }}
          >
            {t("open")}
          </Button>
        </ListItem>
      ) : (
        <MenuItem
          onClick={() => {
            setAddress("");
          }}
        >
          {t("tailscaleCustomAddress")}
        </MenuItem>
      )}
      <Divider />
      <MenuItem onClick={signOut}>{t("tailscaleLogout")}</MenuItem>
    </>
  );
}
