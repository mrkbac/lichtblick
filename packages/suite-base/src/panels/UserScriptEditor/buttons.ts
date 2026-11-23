// SPDX-License-Identifier: MPL-2.0

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HomeRepairServiceOutlinedIcon from "@mui/icons-material/HomeRepairServiceOutlined";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const USER_SCRIPTS_BUTTONS = {
  scripts: { id: "userScriptsScripts", icon: DescriptionOutlinedIcon, placement: "inline" },
  utilities: {
    id: "userScriptsUtilities",
    icon: HomeRepairServiceOutlinedIcon,
    placement: "inline",
  },
  templates: {
    id: "userScriptsTemplates",
    icon: AutoAwesomeOutlinedIcon,
    placement: "inline",
  },
  collapseSidebar: { id: "userScriptsCollapseSidebar", icon: CloseIcon, placement: "inline" },
  rename: { id: "userScriptsRename", icon: EditOutlinedIcon, placement: "inline" },
  delete: { id: "userScriptsDelete", icon: DeleteOutlinedIcon, placement: "inline" },
  goBack: { id: "userScriptsGoBack", icon: ArrowBackIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
