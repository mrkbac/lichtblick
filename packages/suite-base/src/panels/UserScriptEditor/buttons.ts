// SPDX-License-Identifier: MPL-2.0

import {
  Delete20Regular,
  Dismiss20Filled,
  DocumentOnePageSparkle24Regular,
  Edit20Regular,
  Script24Regular,
  Toolbox24Regular,
} from "@fluentui/react-icons";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const USER_SCRIPTS_BUTTONS = {
  scripts: { id: "userScriptsScripts", icon: Script24Regular, placement: "inline" },
  utilities: { id: "userScriptsUtilities", icon: Toolbox24Regular, placement: "inline" },
  templates: {
    id: "userScriptsTemplates",
    icon: DocumentOnePageSparkle24Regular,
    placement: "inline",
  },
  collapseSidebar: { id: "userScriptsCollapseSidebar", icon: Dismiss20Filled, placement: "inline" },
  rename: { id: "userScriptsRename", icon: Edit20Regular, placement: "inline" },
  delete: { id: "userScriptsDelete", icon: Delete20Regular, placement: "inline" },
  goBack: { id: "userScriptsGoBack", icon: ArrowBackIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
