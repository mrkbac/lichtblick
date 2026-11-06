// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ArrowSyncCircle24Filled } from "@fluentui/react-icons";
import { useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import {
  applyServiceWorkerUpdate,
  useServiceWorkerUpdate,
} from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";

import { AppBarIconButton } from "./AppBarIconButton";

/** Shows a button in the app bar while a new version is waiting; clicking it applies the update. */
export function UpdateIndicator(): React.JSX.Element | undefined {
  const { t } = useTranslation("appBar");
  const theme = useTheme();
  const waiting = useServiceWorkerUpdate();

  if (!waiting) {
    return undefined;
  }

  return (
    <AppBarIconButton
      title={
        <>
          <b>{t("updateAvailable")}</b>
          <br />
          {t("updateAvailableDescription")}
        </>
      }
      aria-label={t("updateAvailable")}
      data-testid="update-indicator"
      onClick={() => {
        applyServiceWorkerUpdate(waiting);
      }}
    >
      {/* the accent color: the muted app bar color is nearly invisible on the dark bar */}
      <ArrowSyncCircle24Filled primaryFill={theme.palette.primary.main} />
    </AppBarIconButton>
  );
}
