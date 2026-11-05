// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.
import { LayoutData } from "@lichtblick/suite-base/context/CurrentLayoutContext/actions";
import { isLayoutNode, isMosaicNode } from "@lichtblick/suite-base/util/layoutTree";

/** Key injected into panel configs for user-selected title (overrides setDefaultPanelTitle) */
export const PANEL_TITLE_CONFIG_KEY = "lichtblickPanelTitle";

// given a panel type, create a unique id for a panel
// with the type embedded within the id
export function getPanelIdForType(type: string): string {
  const factor = 1e10;
  const rnd = Math.round(Math.random() * factor).toString(36);
  // a panel id consists of its type, an exclamation mark for splitting, and a random val
  // because each panel id is the key of the panel in the layout
  // but also must encode the panel type for panel factory construction
  return `${type}!${rnd}`;
}

export function getPanelTypeFromId(id: string): string {
  return id.split("!")[0] ?? "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != undefined && !Array.isArray(value);
}

/**
 * Validates that a parsed value has the shape required by {@link LayoutData} before it is
 * installed. Throws an Error whose message lists every missing or invalid field so the caller can
 * surface it to the user.
 *
 * @param data The unknown value parsed from a layout file.
 * @returns The same value narrowed to {@link LayoutData} when valid.
 */
export function validateLayoutData(data: unknown): LayoutData {
  const errors: string[] = [];

  if (!isPlainObject(data)) {
    throw new Error("expected an object");
  }

  const missingFields = ["configById", "globalVariables"].filter(
    (field) => !isPlainObject(data[field]),
  );
  if (!isPlainObject(data.playbackConfig) || typeof data.playbackConfig.speed !== "number") {
    missingFields.push("playbackConfig");
  }
  if (missingFields.length === 1) {
    errors.push(`missing or invalid "${missingFields[0]}"`);
  } else if (missingFields.length > 1) {
    const quotedFields = missingFields.map((field) => `"${field}"`).join(", ");
    errors.push(`missing or invalid fields: ${quotedFields}`);
  }

  if ("userNodes" in data && !isPlainObject(data.userNodes)) {
    errors.push(`invalid "userNodes"`);
  }

  // Older files store the react-mosaic-component tree, which is converted when loaded
  if (data.layout != undefined && !isLayoutNode(data.layout) && !isMosaicNode(data.layout)) {
    errors.push(`invalid "layout"`);
  }

  if (data.version != undefined && typeof data.version !== "number") {
    errors.push(`invalid "version"`);
  }

  if (errors.length > 0) {
    throw new Error(errors.join(", "));
  }

  return data as LayoutData;
}
