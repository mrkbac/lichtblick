// SPDX-License-Identifier: MPL-2.0

/**
 * `crypto.randomUUID()` only exists in secure contexts (https or localhost). The app is also served
 * over plain HTTP (e.g. the Docker image on a LAN), where calling it throws, so use the
 * `randomUUID()` helper in @lichtblick/suite-base/util/randomUUID, which falls back.
 */
module.exports = {
  meta: {
    type: "problem",
    schema: [],
    defaultOptions: [],
    messages: {
      randomUUID:
        "crypto.randomUUID() throws outside secure contexts (plain HTTP). Use randomUUID() from @lichtblick/suite-base/util/randomUUID.",
    },
  },

  create(context) {
    // crypto.randomUUID(), globalThis.crypto.randomUUID(), window.crypto.randomUUID(), …
    const isCrypto = (object) =>
      (object.type === "Identifier" && object.name === "crypto") ||
      (object.type === "MemberExpression" && object.property.name === "crypto");
    return {
      'CallExpression > MemberExpression.callee[property.name="randomUUID"]': (node) => {
        if (isCrypto(node.object)) {
          context.report({ node: node.parent, messageId: "randomUUID" });
        }
      },
    };
  },
};
