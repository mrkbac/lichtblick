// SPDX-License-Identifier: MPL-2.0

import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import RestoreIcon from "@mui/icons-material/Restore";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import ViewListIcon from "@mui/icons-material/ViewList";

import { type PanelButton, RegexLabel } from "@lichtblick/suite-base/components/PanelButton";

import { PARAMETERS_SHORTCUT } from "./shortcuts";

export const PARAMETERS_BUTTONS = {
  regex: { id: "parametersRegex", icon: RegexLabel, placement: "inline" },
  flatList: { id: "parametersFlatList", icon: ViewListIcon, placement: "inline" },
  groupByNamespace: {
    id: "parametersGroupByNamespace",
    icon: AccountTreeOutlinedIcon,
    placement: "inline",
  },
  expandAll: { id: "parametersExpandAll", icon: UnfoldMoreIcon, placement: "inline" },
  collapseAll: { id: "parametersCollapseAll", icon: UnfoldLessIcon, placement: "inline" },
  snapshots: {
    id: "parametersSnapshots",
    icon: PhotoCameraOutlinedIcon,
    placement: "inline",
  },
  exportSnapshot: {
    id: "parametersExportSnapshot",
    icon: FileDownloadOutlinedIcon,
    placement: "inline",
  },
  deleteSnapshot: {
    id: "parametersDeleteSnapshot",
    icon: DeleteOutlineIcon,
    placement: "inline",
  },
  stopComparing: { id: "parametersStopComparing", icon: ClearIcon, placement: "inline" },
  submitValue: {
    id: "parametersSubmitValue",
    icon: CheckIcon,
    placement: "inline",
    shortcut: PARAMETERS_SHORTCUT.submitValue,
  },
  resetValue: {
    id: "parametersResetValue",
    icon: ClearIcon,
    placement: "inline",
    shortcut: PARAMETERS_SHORTCUT.resetValue,
  },
  restoreValue: { id: "parametersRestoreValue", icon: RestoreIcon, placement: "inline" },
} as const satisfies Record<string, PanelButton>;
