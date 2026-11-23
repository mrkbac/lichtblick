// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import AutorenewIcon from "@mui/icons-material/Autorenew";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useServiceWorkerUpdate } from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";

import { AppBarIconButton } from "./AppBarIconButton";

/**
 * Shows a button in the app bar while a newer version is available; clicking it updates. A window
 * left on the old build after another window updated shows a plain reload arrow instead.
 */
export function UpdateIndicator(): React.JSX.Element | undefined {
  const { t } = useTranslation("appBar");
  const theme = useTheme();
  const available = useServiceWorkerUpdate();

  if (!available) {
    return undefined;
  }

  const stale = available.kind === "activated";
  const title = stale ? t("staleVersion") : t("updateAvailable");
  // the accent color: the muted app bar color is nearly invisible on the dark bar
  const Icon = stale ? RefreshIcon : AutorenewIcon;

  return (
    <AppBarIconButton
      title={
        <>
          <b>{title}</b>
          <br />
          {stale ? t("staleVersionDescription") : t("updateAvailableDescription")}
        </>
      }
      aria-label={title}
      data-testid="update-indicator"
      data-update-kind={available.kind}
      onClick={available.update}
    >
      <Icon htmlColor={theme.palette.primary.main} />
    </AppBarIconButton>
  );
}
