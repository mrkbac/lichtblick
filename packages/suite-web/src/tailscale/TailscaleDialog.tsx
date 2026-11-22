// SPDX-License-Identifier: MPL-2.0

import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { IDataSourceFactory } from "@lichtblick/suite-base/context/PlayerSelectionContext";

import { TailscaleBackend } from "./TailscaleBackend";
import type { SessionStatus } from "./worker";

type Props = React.ComponentProps<NonNullable<IDataSourceFactory["ConnectionDialog"]>>;

function bridgeUrl(address: string): string | undefined {
  try {
    const url = new URL(address);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export default function TailscaleDialog({
  initialUrl,
  onConnect,
  onCancel,
}: Props): React.JSX.Element {
  const { t } = useTranslation("openDialog");
  const [address, setAddress] = useState(initialUrl ?? "");
  const [{ login, peers, state, error }, setStatus] = useState<SessionStatus>({
    state: "Starting",
    peers: [],
  });
  const session = useRef<TailscaleBackend | undefined>(undefined);
  useEffect(() => {
    let backend: TailscaleBackend;
    try {
      backend = new TailscaleBackend(setStatus);
    } catch {
      setStatus({ state: "Failed", error: "tailscaleFailed", peers: [] });
      return;
    }
    session.current = backend;
    return () => {
      if (session.current === backend) {
        backend.dispose();
      }
    };
  }, []);
  const url = bridgeUrl(address);
  const running = state === "Running";
  function connect() {
    const backend = session.current;
    if (!backend || !url || !running || error) {
      return;
    }
    session.current = undefined;
    onConnect(url, backend);
  }
  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      aria-labelledby="tailscale-connect-title"
    >
      <DialogTitle id="tailscale-connect-title">{t("tailscaleConnect")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error ? (
            <Typography color="error">{t(error)}</Typography>
          ) : state === "LoggedOut" ? (
            <Typography>{t("tailscaleSignedOut")}</Typography>
          ) : running ? (
            <>
              <Autocomplete
                options={peers}
                onChange={(_, peer) => {
                  if (peer) {
                    setAddress(`ws://${peer.includes(":") ? "[" + peer + "]" : peer}:8765`);
                  }
                }}
                renderInput={(params) => <TextField {...params} label={t("tailscalePeers")} />}
              />
              <TextField
                label={t("tailscaleAddress")}
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                }}
                placeholder="ws://device:8765"
              />
            </>
          ) : state === "NeedsMachineAuth" ? (
            <Typography>{t("tailscaleApproval")}</Typography>
          ) : login ? (
            <Button component="a" href={login} target="_blank" rel="noreferrer">
              {t("tailscaleLogin")}
            </Button>
          ) : (
            <Typography>{t("tailscaleStarting")}</Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {(running || error === "tailscaleStorageError") && (
          <Button onClick={() => session.current?.logout()}>{t("tailscaleLogout")}</Button>
        )}
        <Button onClick={onCancel}>{t("tailscaleCancel")}</Button>
        <Button onClick={connect} disabled={!running || !url || Boolean(error)}>
          {t("open")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
