// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Every `URL.createObjectURL()` pins its Blob until someone revokes it. Each call site must be the
 * single owner that revokes the URL, and says so in a disable comment; everything else goes
 * through that owner.
 */
module.exports = {
  meta: {
    type: "problem",
    schema: [],
    defaultOptions: [],
    messages: {
      objectUrl:
        "URL.createObjectURL() leaks its Blob unless revoked. Go through the owner that revokes it, or disable this rule here with a comment naming who revokes the URL.",
    },
  },

  create(context) {
    return {
      'CallExpression > MemberExpression.callee[property.name="createObjectURL"]': (node) => {
        context.report({ node: node.parent, messageId: "objectUrl" });
      },
    };
  },
};
