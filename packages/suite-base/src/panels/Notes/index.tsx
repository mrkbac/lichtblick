// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import Panel from "@lichtblick/suite-base/components/Panel";

import { Notes } from "./Notes";
import { NotesConfig } from "./types";

const defaultConfig: NotesConfig = { text: "" };

export default Panel(Object.assign(Notes, { panelType: "Notes", defaultConfig }));
