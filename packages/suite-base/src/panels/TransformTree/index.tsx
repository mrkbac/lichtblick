// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import Panel from "@lichtblick/suite-base/components/Panel";

import { TransformTree } from "./TransformTree";
import { TransformTreeConfig } from "./types";

const defaultConfig: TransformTreeConfig = {};

export default Panel(
  Object.assign(TransformTree, {
    panelType: "TransformTree",
    defaultConfig,
  }),
);
