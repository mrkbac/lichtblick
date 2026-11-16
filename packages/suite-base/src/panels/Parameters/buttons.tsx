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
import type { SvgIconProps } from "@mui/material";
import type { ComponentType } from "react";

import type { PanelButton } from "@lichtblick/suite-base/components/PanelButton";

import { PARAMETERS_SHORTCUT } from "./shortcuts";

function small(Icon: ComponentType<SvgIconProps>): ComponentType {
  return function SmallIcon() {
    return <Icon fontSize="small" />;
  };
}

function RegexLabel(): React.JSX.Element {
  return <span style={{ fontFamily: "monospace" }}>.*</span>;
}

export const PARAMETERS_BUTTONS = {
  regex: { id: "parametersRegex", icon: RegexLabel, placement: "inline" },
  flatList: { id: "parametersFlatList", icon: small(ViewListIcon), placement: "inline" },
  groupByNamespace: {
    id: "parametersGroupByNamespace",
    icon: small(AccountTreeOutlinedIcon),
    placement: "inline",
  },
  expandAll: { id: "parametersExpandAll", icon: small(UnfoldMoreIcon), placement: "inline" },
  collapseAll: { id: "parametersCollapseAll", icon: small(UnfoldLessIcon), placement: "inline" },
  snapshots: {
    id: "parametersSnapshots",
    icon: small(PhotoCameraOutlinedIcon),
    placement: "inline",
  },
  exportSnapshot: {
    id: "parametersExportSnapshot",
    icon: small(FileDownloadOutlinedIcon),
    placement: "inline",
  },
  deleteSnapshot: {
    id: "parametersDeleteSnapshot",
    icon: small(DeleteOutlineIcon),
    placement: "inline",
  },
  stopComparing: { id: "parametersStopComparing", icon: small(ClearIcon), placement: "inline" },
  submitValue: {
    id: "parametersSubmitValue",
    icon: small(CheckIcon),
    placement: "inline",
    shortcut: PARAMETERS_SHORTCUT.submitValue,
  },
  resetValue: {
    id: "parametersResetValue",
    icon: small(ClearIcon),
    placement: "inline",
    shortcut: PARAMETERS_SHORTCUT.resetValue,
  },
  restoreValue: { id: "parametersRestoreValue", icon: small(RestoreIcon), placement: "inline" },
} as const satisfies Record<string, PanelButton>;
