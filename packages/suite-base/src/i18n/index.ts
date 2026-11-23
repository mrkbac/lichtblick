// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import * as en from "./en";
import { APP_CONFIG } from "../constants/config";

export const translations = { en };

export const defaultNS = "general";

export async function initI18n(): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources: translations,
    lng: "en",
    fallbackLng: "en",
    defaultNS,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
      // `{{appName}}` works in every string without passing it at the call site
      defaultVariables: { appName: APP_CONFIG.productName },
    },
  });
}

export const sharedI18nObject = i18n;
