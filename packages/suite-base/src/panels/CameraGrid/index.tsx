// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { extensionPanel } from "@lichtblick/suite-base/panels/extensionPanel";

import { CameraGrid } from "./CameraGrid";

export default extensionPanel("CameraGrid", CameraGrid, { dark: true });
