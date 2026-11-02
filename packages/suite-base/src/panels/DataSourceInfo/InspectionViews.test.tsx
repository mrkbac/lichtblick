/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SchemaFields } from "./InspectionViews";

it("presents schema fields, fixed arrays, and constants as structured cells", () => {
  render(
    <SchemaFields
      schemaName="Example"
      datatypes={
        new Map([
          [
            "Example",
            {
              definitions: [
                { name: "position", type: "float64", isArray: true, arrayLength: 3 },
                { name: "LIMIT", type: "int32", isConstant: true, value: 42, valueText: "42" },
              ],
            },
          ],
        ])
      }
    />,
  );
  expect(screen.getByRole("cell", { name: "position" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Array [3]" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Constant 42" })).toBeInTheDocument();
  expect(document.querySelector("pre")).toBeNull();
});

it("opens nested schema types without dumping their JSON", () => {
  render(
    <SchemaFields
      schemaName="Root"
      datatypes={
        new Map([
          ["Root", { definitions: [{ name: "pose", type: "Pose", isComplex: true }] }],
          ["Pose", { definitions: [{ name: "x", type: "float64" }] }],
        ])
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pose →" }));
  expect(screen.getByRole("cell", { name: "x" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Root schema" }));
  expect(screen.getByRole("cell", { name: "pose" })).toBeInTheDocument();
});
