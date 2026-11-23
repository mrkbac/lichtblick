// SPDX-License-Identifier: MPL-2.0

import { MenuItem } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useTailscaleAccount } from "./TailscaleAccount";

export default function TailscaleMenu({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation("openDialog");
  const { status, start, logout } = useTailscaleAccount();
  useEffect(() => {
    start();
  }, [start]);

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

  return <MenuItem onClick={signOut}>{t("tailscaleLogout")}</MenuItem>;
}
