// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import Panel from "@lichtblick/suite-base/components/Panel";

import { Audio } from "./Audio";
import { DEFAULT_CONFIG } from "./types";

export default Panel(Object.assign(Audio, { panelType: "Audio", defaultConfig: DEFAULT_CONFIG }));
