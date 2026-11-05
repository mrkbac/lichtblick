// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Dispatch } from "react";

import {
  LayoutSelectionAction,
  LayoutSelectionState,
} from "@lichtblick/suite-base/components/LayoutBrowser/types";

export type LayoutSetupOptions = {
  state: LayoutSelectionState;
  dispatch: Dispatch<LayoutSelectionAction>;
};

export type InteractionCaptureOptions = {
  /**
   * DOM attribute used to identify the clicked element. Defaults to "data-testid".
   * Callers with dynamic/high-cardinality test IDs should pass a dedicated static attribute instead.
   */
  attribute?: string;
  /** Optional static attributes merged into every logged event's data payload. */
  data?: Record<string, unknown>;
};
