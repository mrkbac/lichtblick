// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2025 Takayuki Honda <takayuki.honda@tier4.jp>
// SPDX-License-Identifier: MPL-2.0

import { create } from "zustand";

export const useLegendCount = create<{
  legendCount: number;
  setLegendCount: (newCount: number) => void;
  increment: () => void;
  decrement: () => void;
}>()((set) => ({
  legendCount: 10,
  setLegendCount: (legendCount) => {
    set({ legendCount });
  },
  increment: () => {
    set((state) => ({ legendCount: state.legendCount + 1 }));
  },
  decrement: () => {
    set((state) => ({ legendCount: Math.max(1, state.legendCount - 1) }));
  },
}));
