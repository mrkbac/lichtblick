// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * @type {import("eslint").Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: "problem",
    // A suggestion, not an autofix: without type info the receiver may not be an array.
    hasSuggestions: true,
    messages: {
      annotateReturnType: "Move the type argument to the callback return type",
      preferReturnTypeAnnotation: `Annotate the function return type explicitly instead of passing generic arguments to Array#map, to avoid return type widening (https://github.com/microsoft/TypeScript/issues/241)`,
    },
  },
  create: (context) => {
    return {
      [`CallExpression[arguments.length>=1][typeArguments.params.length=1][arguments.0.type=ArrowFunctionExpression]:not([arguments.0.returnType]) > MemberExpression.callee[property.name="map"]`]:
        (/** @type {import("estree").MemberExpression} */ node) => {
          /** @type {import("estree").CallExpression} */
          const callExpr = node.parent;

          // Syntactic only: oxlint JS plugins have no type information, so any `.map<T>(arrow)`
          // is reported, not just Array#map.
          const sourceCode = context.sourceCode;

          const arrowToken = sourceCode.getTokenBefore(
            callExpr.arguments[0].body,
            (token) => token.type === "Punctuator" && token.value === "=>",
          );
          if (!arrowToken) {
            return;
          }
          const maybeCloseParenToken = sourceCode.getTokenBefore(arrowToken);
          const closeParenToken =
            maybeCloseParenToken.type === "Punctuator" && maybeCloseParenToken.value === ")"
              ? maybeCloseParenToken
              : undefined;

          context.report({
            node: callExpr.typeArguments,
            messageId: "preferReturnTypeAnnotation",
            suggest: [
              {
                messageId: "annotateReturnType",
                *fix(fixer) {
                  const returnType = sourceCode.getText(callExpr.typeArguments.params[0]);
                  yield fixer.remove(callExpr.typeArguments);
                  if (closeParenToken) {
                    yield fixer.insertTextAfter(closeParenToken, `: ${returnType}`);
                  } else {
                    yield fixer.insertTextBefore(callExpr.arguments[0], "(");
                    yield fixer.insertTextAfter(
                      callExpr.arguments[0].params[callExpr.arguments[0].params.length - 1],
                      `): ${returnType}`,
                    );
                  }
                },
              },
            ],
          });
        },
    };
  },
};
