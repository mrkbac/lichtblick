// SPDX-License-Identifier: MPL-2.0

import Panel from "@lichtblick/suite-base/components/Panel";

import { Notes } from "./Notes";
import { defaultConfig } from "./settings";

export default Panel(Object.assign(Notes, { panelType: "Notes", defaultConfig }));
