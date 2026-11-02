// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createWithEqualityFn } from "zustand/traditional";

import { MessagePathStructureItem } from "@lichtblick/message-path";

type StructuredItemsState = {
  structureItemsByPath: Map<string, MessagePathStructureItem>;
  setStructureItemsByPath: (items: Map<string, MessagePathStructureItem>) => void;
};

export const useStructureItemsByPathStore = createWithEqualityFn<StructuredItemsState>((set) => ({
  structureItemsByPath: new Map(),
  setStructureItemsByPath: (items) => {
    set({ structureItemsByPath: items });
  },
}));
