/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2020-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.
import { getPanelIdForType, getPanelTypeFromId, validateLayoutData } from "./layout";

describe("layout", () => {
  it("encodes the panel type in the panel id", () => {
    const id = getPanelIdForType("Plot");
    expect(id).toMatch(/^Plot!/);
    expect(getPanelTypeFromId(id)).toEqual("Plot");
  });

  describe("validateLayoutData", () => {
    it("rejects a malformed layout tree", () => {
      expect(() => validateLayoutData({ ...validData(), layout: { direction: "row" } })).toThrow(
        'invalid "layout"',
      );
    });

    it("accepts the current layout tree format", () => {
      const data = { ...validData(), layout: { panels: ["Plot!1"] } };
      expect(validateLayoutData(data)).toBe(data);
    });

    function validData(): Record<string, unknown> {
      return {
        configById: {},
        globalVariables: {},
        userNodes: {},
        playbackConfig: { speed: 1 },
      };
    }

    it("returns the data when all required fields are valid", () => {
      // Given a fully populated layout
      const data = {
        ...validData(),
        layout: { first: "Plot!1", second: "Plot!2", direction: "row" },
        version: 1,
      };

      // When validating it
      // Then the same object is returned without throwing
      expect(validateLayoutData(data)).toBe(data);
    });

    it("accepts optional layout as a string and omitted version", () => {
      // Given a layout whose root is a single panel id
      const data = { ...validData(), layout: "Plot!1" };

      // When validating it
      // Then it is accepted
      expect(validateLayoutData(data)).toBe(data);
    });

    it.each([undefined, null, 42, "string", []])(
      "throws when the value is not an object (%p)",
      (value) => {
        // Given a non-object value
        // When validating it
        // Then it throws
        expect(() => validateLayoutData(value)).toThrow("expected an object");
      },
    );

    it.each(["configById", "globalVariables"] as const)(
      "throws when required object field %s is missing",
      (field) => {
        // Given a layout missing a required object field
        const data = validData();
        delete data[field];

        // When validating it
        // Then it throws referencing that field
        expect(() => validateLayoutData(data)).toThrow(`missing or invalid "${field}"`);
      },
    );

    it("accepts a layout that omits userNodes", () => {
      // Given a valid layout without a userNodes field
      const data = validData();
      delete data.userNodes;

      // When validating it
      // Then it is accepted
      expect(validateLayoutData(data)).toBe(data);
    });

    it("throws when userNodes is present but not an object", () => {
      // Given a layout whose userNodes field is not an object
      const data = { ...validData(), userNodes: [] };

      // When validating it
      // Then it throws
      expect(() => validateLayoutData(data)).toThrow('invalid "userNodes"');
    });

    it("throws when userNodes is null", () => {
      // Given a layout whose userNodes field is explicitly null
      const data = { ...validData(), userNodes: null };

      // When validating it
      // Then it throws
      expect(() => validateLayoutData(data)).toThrow('invalid "userNodes"');
    });

    it("throws when playbackConfig is missing", () => {
      // Given a layout without playbackConfig
      const data = validData();
      delete data.playbackConfig;

      // When validating it
      // Then it throws
      expect(() => validateLayoutData(data)).toThrow('missing or invalid "playbackConfig"');
    });

    it("throws when playbackConfig.speed is not a number", () => {
      // Given a layout whose playbackConfig has a non-numeric speed
      const data = { ...validData(), playbackConfig: { speed: "fast" } };

      // When validating it
      // Then it throws
      expect(() => validateLayoutData(data)).toThrow('missing or invalid "playbackConfig"');
    });

    it("throws when layout has an invalid type", () => {
      // Given a layout whose layout field is a number
      const data = { ...validData(), layout: 5 };

      // When validating it
      // Then it throws
      expect(() => validateLayoutData(data)).toThrow('invalid "layout"');
    });

    it("throws when version has an invalid type", () => {
      // Given a layout whose version is a string
      const data = { ...validData(), version: "1" };

      // When validating it
      // Then it throws
      expect(() => validateLayoutData(data)).toThrow('invalid "version"');
    });

    it("aggregates multiple errors into a single message", () => {
      // Given a layout missing several fields
      const data = { globalVariables: {} };

      // When validating it
      // Then all invalid fields are reported
      expect(() => validateLayoutData(data)).toThrow(
        'missing or invalid fields: "configById", "playbackConfig"',
      );
    });
  });
});
