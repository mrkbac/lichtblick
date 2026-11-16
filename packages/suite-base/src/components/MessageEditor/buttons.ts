// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import BookmarksIcon from "@mui/icons-material/BookmarksOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

/** Buttons of the shared message editor (Call Service and Publish panels). */
export const MESSAGE_EDITOR_BUTTONS = {
  presets: { id: "messageEditorPresets", icon: BookmarksIcon, placement: "inline" },
  resetToTemplate: {
    id: "messageEditorResetToTemplate",
    icon: RestartAltIcon,
    placement: "inline",
  },
} as const satisfies Record<string, PanelButton>;
