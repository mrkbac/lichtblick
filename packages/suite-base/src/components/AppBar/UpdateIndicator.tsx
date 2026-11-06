// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ArrowSync20Regular } from "@fluentui/react-icons";
import { useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useServiceWorkerUpdate } from "@lichtblick/suite-base/hooks/useServiceWorkerUpdate";

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
        waiting.postMessage({ type: "SKIP_WAITING" });
      }}
    >
      <ArrowSync20Regular primaryFill={theme.palette.appBar.primary} />
    </AppBarIconButton>
  );
}
