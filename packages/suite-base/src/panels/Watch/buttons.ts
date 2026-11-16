// SPDX-License-Identifier: MPL-2.0

import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LibraryAddOutlinedIcon from "@mui/icons-material/LibraryAddOutlined";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

export const WATCH_BUTTONS = {
  add: { id: "watchAdd", icon: AddIcon, placement: "inline" },
  copyValue: { id: "watchCopyValue", icon: ContentCopyIcon, placement: "inline" },
  editPath: { id: "watchEditPath", icon: EditOutlinedIcon, placement: "inline" },
  duplicate: { id: "watchDuplicate", icon: LibraryAddOutlinedIcon, placement: "inline" },
  remove: { id: "watchRemove", icon: DeleteOutlineIcon, placement: "inline" },
  addAsRow: { id: "watchAddAsRow", icon: AddIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
