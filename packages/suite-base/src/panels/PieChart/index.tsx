// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// SPDX-FileCopyrightText: Copyright (C) 2024-2025 Yukihiro Saito <yukky.saito@gmail.com>
// SPDX-License-Identifier: MPL-2.0

import { extensionPanel } from "@lichtblick/suite-base/panels/extensionPanel";

import { PieChart } from "./PieChart";

export default extensionPanel("PieChart", PieChart, { dark: true });
