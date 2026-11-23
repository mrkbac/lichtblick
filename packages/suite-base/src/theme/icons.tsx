// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import AppsIcon from "@mui/icons-material/Apps";
import FilePresentOutlinedIcon from "@mui/icons-material/FilePresentOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import SchemaOutlinedIcon from "@mui/icons-material/SchemaOutlined";

import { RegisteredIconNames } from "@lichtblick/suite-base/types/Icons";

const icons: {
  // This makes it a type error to forget to add an icon here once it has been added to RegisteredIconNames.
  [N in RegisteredIconNames]: React.ReactElement;
} = {
  FileASPX: <FilePresentOutlinedIcon fontSize="small" />,
  Flow: <SchemaOutlinedIcon fontSize="small" />,
  GenericScan: <QrCodeScannerIcon fontSize="small" />,
  OpenFile: <InsertDriveFileOutlinedIcon fontSize="small" />,
  ROS: <AppsIcon fontSize="small" />,
};

export default icons;
