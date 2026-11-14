// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// `arr.push(...items)` passes every item as a call argument, which throws
// "RangeError: Maximum call stack size exceeded" once `items` reaches ~100k entries. Message
// batches and histories get that large with long recordings, so ban the pattern outright.
module.exports = {
  meta: {
    type: "problem",
    messages: {
      spread:
        "Don't spread into push(): it throws RangeError for large arrays. Use pushAll() from @lichtblick/den/collection or a for-of loop.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.name === "push" &&
          node.arguments.some((arg) => arg.type === "SpreadElement")
        ) {
          context.report({ node, messageId: "spread" });
        }
      },
    };
  },
};
