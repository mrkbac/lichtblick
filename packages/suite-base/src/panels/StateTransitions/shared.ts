// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ImmutableDataset, StateTransitionPath } from "./types";

function presence<T>(value: undefined | T): undefined | T {
  if (value === "") {
    return undefined;
  }

  return value ?? undefined;
}

export function stateTransitionPathDisplayName(
  path: Readonly<StateTransitionPath>,
  index: number,
): string {
  const value = presence(path.value);
  const condition = presence(path.condition);
  return (
    presence(path.label) ??
    (value != undefined && condition != undefined ? `${value} ${condition}` : value) ??
    `Series ${index + 1}`
  );
}

export function datasetContainsArray(dataset: ImmutableDataset): boolean {
  // We need to detect when the path produces more than one data point,
  // since that is invalid input
  const dataCounts = [
    ...new Set(dataset.flatMap((data) => data?.map((message) => message.queriedData.length) ?? [])),
  ];
  return dataCounts.length > 0 && dataCounts.every((numPoints) => numPoints > 1);
}
