// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

const PANEL_TOOLBAR_MIN_HEIGHT = 30;
const COMPACT_PANEL_TOOLBAR_HEIGHT = 24;

/** Set on the workspace while the compact panels app setting is on. */
export const COMPACT_PANELS_ATTRIBUTE = "data-compact-panels";

/** CSS height of a panel toolbar; smaller in compact mode. */
export const PANEL_TOOLBAR_HEIGHT = `var(--panel-toolbar-height, ${PANEL_TOOLBAR_MIN_HEIGHT}px)`;

/**
 * CSS height a toolbar with only a title takes from its panel: none in compact mode, where it
 * floats over the panel.
 */
export const PANEL_TITLE_TOOLBAR_SPACE = `var(--panel-title-toolbar-space, ${PANEL_TOOLBAR_MIN_HEIGHT}px)`;

/**
 * CSS height of the floating toolbar over a panel with only a title (none outside compact mode).
 * Controls drawn over the top of a panel go this far down so the toolbar doesn't cover them.
 */
export const PANEL_FLOATING_TOOLBAR_HEIGHT = "var(--panel-floating-toolbar-height, 0px)";

/** Workspace styles that turn compact panels on. */
export const COMPACT_PANELS_STYLE = {
  [`&[${COMPACT_PANELS_ATTRIBUTE}]`]: {
    "--panel-toolbar-height": `${COMPACT_PANEL_TOOLBAR_HEIGHT}px`,
    "--panel-title-toolbar-space": "0px",
    "--panel-floating-toolbar-height": `${COMPACT_PANEL_TOOLBAR_HEIGHT}px`,
  },
};
