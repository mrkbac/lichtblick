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
    return {
      'CallExpression > MemberExpression.callee[property.name="randomUUID"][object.name="crypto"]':
        (node) => {
          context.report({ node: node.parent, messageId: "randomUUID" });
        },
    };
  },
};
