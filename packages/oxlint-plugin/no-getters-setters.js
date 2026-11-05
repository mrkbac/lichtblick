// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Replaces the ESLint `no-restricted-syntax` getter/setter selectors (oxlint has no
// no-restricted-syntax).
module.exports = {
  meta: {
    type: "suggestion",
    messages: {
      get: "Property getters are not allowed; prefer function syntax instead.",
      set: "Property setters are not allowed; prefer function syntax instead.",
    },
  },
  create(context) {
    const check = (node) => {
      if (node.kind === "get" || node.kind === "set") {
        context.report({ node, messageId: node.kind });
      }
    };
    return { MethodDefinition: check, Property: check };
  },
};
