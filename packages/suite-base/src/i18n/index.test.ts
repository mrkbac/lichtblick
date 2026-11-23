// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import i18n from "i18next";

import { defaultNS, initI18n, sharedI18nObject } from "./index";

describe("initI18n", () => {
  it("initializes English with the shared instance", async () => {
    await initI18n();

    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe("en");
    expect(i18n.options.defaultNS).toBe(defaultNS);
    expect(i18n.hasResourceBundle("en", defaultNS)).toBe(true);
    expect(sharedI18nObject).toBe(i18n);
  });
});
