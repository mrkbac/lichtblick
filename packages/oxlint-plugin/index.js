// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Custom lint rules, loaded by oxlint as a JS plugin (see .oxlintrc.json `jsPlugins`).
module.exports = {
  meta: { name: "@lichtblick" },
  rules: {
    "license-header": require("./license-header"),
    "link-target": require("./link-target"),
    "lodash-ramda-imports": require("./lodash-ramda-imports"),
    "no-boolean-parameters": require("./no-boolean-parameters"),
    "no-getters-setters": require("./no-getters-setters"),
    "no-push-spread": require("./no-push-spread"),
    "no-return-promise-resolve": require("./no-return-promise-resolve"),
    "ramda-usage": require("./ramda-usage"),
    "strict-equality": require("./strict-equality"),
  },
};
