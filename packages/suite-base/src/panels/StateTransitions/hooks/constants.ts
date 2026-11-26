// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const ROW_SPACING = 9;
export const ROW_MARGIN = ROW_SPACING / 4;
/** Pixels per y unit: a bar row (ROW_SPACING units) is 64 px tall. */
export const PX_PER_Y_UNIT = 64 / ROW_SPACING;
/** The y axis ends here, so the first row's bar sits below its legend button. */
export const Y_AXIS_MAX = -3;
export const DEFAULT_X_END_TIME = 1;
