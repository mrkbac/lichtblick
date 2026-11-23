// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createWithEqualityFn } from "zustand/traditional";

export type InstallingProgress = {
  installed: number;
  total: number;
  inProgress: boolean;
};

export const IDLE_INSTALLING_PROGRESS: InstallingProgress = {
  installed: 0,
  total: 0,
  inProgress: false,
};

export type InstallingExtensionsState = {
  installingProgress: InstallingProgress;
  setInstallingProgress: (progress: InstallingProgress) => void;
};

export const useInstallingExtensionsStore = createWithEqualityFn<InstallingExtensionsState>(
  (set) => ({
    installingProgress: IDLE_INSTALLING_PROGRESS,
    setInstallingProgress: (installingProgress) => {
      set({ installingProgress });
    },
  }),
);
