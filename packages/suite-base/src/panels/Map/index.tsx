// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { extensionPanel } from "@lichtblick/suite-base/panels/extensionPanel";

import MapPanel from "./MapPanel";
import "./maplibre";

import "maplibre-gl/dist/maplibre-gl.css";

export default extensionPanel("map", MapPanel);
