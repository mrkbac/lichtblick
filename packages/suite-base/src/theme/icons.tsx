// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AddIcon from "@mui/icons-material/Add";
import AddToQueueIcon from "@mui/icons-material/AddToQueue";
import AppsIcon from "@mui/icons-material/Apps";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloseIcon from "@mui/icons-material/Close";
import CollectionsBookmarkOutlinedIcon from "@mui/icons-material/CollectionsBookmarkOutlined";
import DataArrayIcon from "@mui/icons-material/DataArray";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import FilePresentOutlinedIcon from "@mui/icons-material/FilePresentOutlined";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import SchemaOutlinedIcon from "@mui/icons-material/SchemaOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";

import BlockheadFilledIcon from "@lichtblick/suite-base/components/BlockheadFilledIcon";
import BlockheadIcon from "@lichtblick/suite-base/components/BlockheadIcon";
import { RegisteredIconNames } from "@lichtblick/suite-base/types/Icons";

import DatabaseSettings from "../assets/database-settings.svg";
import PanelLayout from "../assets/panel-layout.svg";
import PanelSettings from "../assets/panel-settings.svg";

const icons: {
  // This makes it a type error to forget to add an icon here once it has been added to RegisteredIconNames.
  [N in RegisteredIconNames]: React.ReactElement;
} = {
  Add: <AddIcon fontSize="small" />,
  AddIn: <ExtensionOutlinedIcon fontSize="small" />,
  BacklogList: <FormatListBulletedIcon fontSize="small" />,
  Blockhead: <BlockheadIcon />,
  BlockheadFilled: <BlockheadFilledIcon />,
  BookStar: <CollectionsBookmarkOutlinedIcon fontSize="small" />,
  Cancel: <CloseIcon fontSize="small" />,
  DatabaseSettings: <DatabaseSettings />,
  Delete: <DeleteOutlinedIcon fontSize="small" />,
  Edit: <EditOutlinedIcon fontSize="small" />,
  ErrorBadge: <HighlightOffIcon fontSize="small" />,
  FileASPX: <FilePresentOutlinedIcon fontSize="small" />,
  FiveTileGrid: <PanelLayout />,
  Flow: <SchemaOutlinedIcon fontSize="small" />,
  GenericScan: <QrCodeScannerIcon fontSize="small" />,
  OpenFile: <InsertDriveFileOutlinedIcon fontSize="small" />,
  PanelSettings: <PanelSettings />,
  RectangularClipping: <AddToQueueIcon fontSize="small" />,
  Settings: <SettingsOutlinedIcon fontSize="small" />,
  Sparkle: <AutoAwesomeOutlinedIcon fontSize="small" />,
  Variable2: <DataArrayIcon fontSize="small" />,
  ROS: <AppsIcon fontSize="small" />,
};

export default icons;
