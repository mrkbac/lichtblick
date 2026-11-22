// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Drawn in the main pass and picked */
export const LAYER_DEFAULT = 0;
/** The selected renderable, drawn again above the selection backdrop */
export const LAYER_SELECTED = 1;
/**
 * Drawn through an instanced batch instead of on its own (see MarkerBatches): skipped by the draw
 * passes, still picked, and selectable (selection moves it to LAYER_SELECTED)
 */
export const LAYER_PICK_ONLY = 2;
