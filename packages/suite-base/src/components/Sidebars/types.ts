// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { BadgeProps } from "@mui/material";
import { PropsWithChildren } from "react";

export type SidebarItemBadge = {
  color?: BadgeProps["color"];
  count: number;
};

export type SidebarItem = {
  badge?: SidebarItemBadge;
  component?: React.ComponentType;
  title: string;
};

export type NewSidebarProps<K> = {
  items: Map<K, SidebarItem>;
  anchor: "right" | "left";
  onClose: () => void;
  activeTab: K | undefined;
  setActiveTab: (newValue: K) => void;
};

export type SidebarProps<LeftKey, RightKey> = PropsWithChildren<{
  leftItems: Map<LeftKey, SidebarItem>;
  selectedLeftKey: LeftKey | undefined;
  onSelectLeftKey: (item: LeftKey | undefined) => void;
  leftSidebarSize: number | undefined;
  setLeftSidebarSize: (size: number | undefined) => void;

  rightItems: Map<RightKey, SidebarItem>;
  selectedRightKey: RightKey | undefined;
  onSelectRightKey: (item: RightKey | undefined) => void;
  rightSidebarSize: number | undefined;
  setRightSidebarSize: (size: number | undefined) => void;
}>;
