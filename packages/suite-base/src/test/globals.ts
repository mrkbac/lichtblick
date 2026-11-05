// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Globals the webpack build injects with DefinePlugin
Object.assign(globalThis, {
  LICHTBLICK_SUITE_VERSION: "TEST",
  API_URL: "/",
  DEV_WORKSPACE: "",
  OTLP_ENDPOINT: undefined,
});
