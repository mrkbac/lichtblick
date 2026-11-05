// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Vendored from @lichtblick/eslint-plugin (MPL-2.0).

/**
 * Whether `node` sits in the `try` block of a try/catch inside its own function, where turning a
 * returned rejection into `throw` would hand it to the `catch` instead.
 */
function isInsideTryWithCatch(node) {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (/Function/.test(parent.type)) {
      return false;
    }
    if (parent.type === "TryStatement" && parent.block === child && parent.handler) {
      return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: "suggestion",
    fixable: "code",
    schema: [],
    defaultOptions: [],
    messages: {
      returnResolve: `Values must be returned directly from async functions`,
      returnReject: `Errors must be thrown directly from async functions`,
    },
  },

  create(context) {
    return {
      [`:matches(:function[async=true] ReturnStatement, ArrowFunctionExpression[async=true]) > CallExpression > MemberExpression[object.name="Promise"][property.name=/^(resolve|reject)$/].callee`]:
        (node) => {
          // The AST selector ensures that we are somewhere within an async function, but we might
          // be in a nested function that is not async. Check that the innermost function scope is
          // actually async.
          const functionScope = context.sourceCode.getScope(node).variableScope;
          if (functionScope.type !== "function" || !functionScope.block.async) {
            return;
          }
          const sourceCode = context.sourceCode;
          const returnOrArrowFunction = node.parent.parent;
          const callExpr = node.parent;
          const isReturn = returnOrArrowFunction.type === "ReturnStatement";
          const isArrowFunction = !isReturn;
          const isReject = node.property.name === "reject";
          const canFix = !(isReject && isInsideTryWithCatch(returnOrArrowFunction));
          context.report({
            node: isReject && isReturn ? returnOrArrowFunction : callExpr,
            messageId: isReject ? "returnReject" : "returnResolve",
            fix: canFix ? fix : undefined,
          });

          function fix(fixer) {
            if (callExpr.arguments.length === 0 && !isReject) {
              return fixer.replaceText(callExpr, "undefined");
            }
            if (isReject) {
              const reason =
                callExpr.arguments.length === 0
                  ? "undefined"
                  : sourceCode.getText(callExpr.arguments[0]);
              if (isArrowFunction) {
                return fixer.replaceText(returnOrArrowFunction.body, `{ throw ${reason}; }`);
              } else {
                return fixer.replaceText(returnOrArrowFunction, `throw ${reason};`);
              }
            }
            const firstArgToken = sourceCode.getFirstToken(callExpr.arguments[0]);
            const needsParens =
              isArrowFunction && firstArgToken.type === "Punctuator" && firstArgToken.value === "{";
            const argText = sourceCode.getText(callExpr.arguments[0]);
            return fixer.replaceText(callExpr, needsParens ? `(${argText})` : argText);
          }
        },
    };
  },
};
