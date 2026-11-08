// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RestoreIcon from "@mui/icons-material/Restore";
import SaveIcon from "@mui/icons-material/Save";
import { useTranslation } from "react-i18next";

import { useMonitorSetup } from "@lichtblick/suite-base/components/MonitorSetupContext";

import { AppBarIconButton } from "./AppBarIconButton";

/** Direct window actions beside Add panel; restoration always requires a user click. */
export function MonitorSetupButtons({ disabled }: { disabled: boolean }): React.JSX.Element | null {
  const setup = useMonitorSetup();
  const { t } = useTranslation("appBar");
  if (!setup) {
    return null;
  }
  return (
    <>
      <AppBarIconButton
        title={t("newWindow")}
        aria-label={t("newWindow")}
        data-testid="new-window-button"
        disabled={disabled || setup.busy}
        onClick={setup.newWindow}
      >
        <OpenInNewIcon />
      </AppBarIconButton>
      <AppBarIconButton
        title={t("saveMonitorSetup")}
        aria-label={t("saveMonitorSetup")}
        data-testid="save-monitor-setup"
        disabled={!setup.canSave || setup.busy}
        onClick={setup.save}
      >
        <SaveIcon />
      </AppBarIconButton>
      <AppBarIconButton
        title={t("restoreMonitorSetup")}
        aria-label={t("restoreMonitorSetup")}
        data-testid="restore-monitor-setup"
        disabled={!setup.canRestore || setup.busy}
        onClick={setup.restore}
      >
        <RestoreIcon />
      </AppBarIconButton>
    </>
  );
}
