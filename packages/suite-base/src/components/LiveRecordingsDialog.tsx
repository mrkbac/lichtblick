// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Button, Dialog, DialogActions, DialogContent } from "@mui/material";
import { useTranslation } from "react-i18next";
import { create } from "zustand";

import { LiveRecordingsList } from "@lichtblick/suite-base/components/LiveRecordingsList";

/** Whether the live recordings dialog is open, so the app menu can open it. */
export const useLiveRecordingsDialog = create<{
  open: boolean;
  show: () => void;
  hide: () => void;
}>()((set) => ({
  open: false,
  show: () => {
    set({ open: true });
  },
  hide: () => {
    set({ open: false });
  },
}));

/** The live recordings list from the start page, in a dialog for the app menu. */
export function LiveRecordingsDialog(): React.JSX.Element | null {
  const { t } = useTranslation("liveRecordings");
  const open = useLiveRecordingsDialog((state) => state.open);
  const hide = useLiveRecordingsDialog((state) => state.hide);
  if (!open) {
    return null;
  }
  return (
    <Dialog open onClose={hide} fullWidth maxWidth="sm" aria-label={t("title")}>
      {/* The list's own header is the title, as on the start page. */}
      <DialogContent>
        <LiveRecordingsList onOpened={hide} />
      </DialogContent>
      <DialogActions>
        <Button onClick={hide}>{t("close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
