// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Ported from @lichtblick/eslint-plugin (MPL-2.0). The original resolved parameter types with the
// TypeScript checker; oxlint JS plugins have no type information, so this version looks at the
// written annotation (or a boolean default value) instead. Aliases of `boolean` are not caught.

const NULLISH_TYPES = new Set([
  "TSUndefinedKeyword",
  "TSNullKeyword",
  "TSVoidKeyword",
  "TSNeverKeyword",
]);

function isBooleanType(type) {
  if (type.type === "TSBooleanKeyword") {
    return true;
  }
  if (type.type === "TSLiteralType") {
    return typeof type.literal.value === "boolean";
  }
  if (type.type === "TSUnionType") {
    return (
      type.types.some(isBooleanType) &&
      type.types.every((part) => isBooleanType(part) || NULLISH_TYPES.has(part.type))
    );
  }
  return false;
}

function isBooleanParam(param) {
  const target = param.type === "AssignmentPattern" ? param.left : param;
  if (target.typeAnnotation) {
    return isBooleanType(target.typeAnnotation.typeAnnotation);
  }
  return (
    param.type === "AssignmentPattern" &&
    param.right.type === "Literal" &&
    typeof param.right.value === "boolean"
  );
}

function getData(param) {
  let paramName;
  if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
    paramName = param.left.name;
  } else if (param.type === "Identifier") {
    paramName = param.name;
  }

  let funcName;
  if (param.parent.id) {
    funcName = param.parent.id.name;
  } else if (param.parent.parent?.type === "VariableDeclarator") {
    funcName = param.parent.parent.id.name;
  } else if (
    ["Property", "MethodDefinition", "TSAbstractMethodDefinition"].includes(
      param.parent.parent?.type,
    )
  ) {
    funcName = param.parent.parent.key.name;
  } else if (param.parent.parent?.type === "TSTypeAnnotation") {
    if (
      ["TSPropertySignature", "ClassProperty", "PropertyDefinition"].includes(
        param.parent.parent.parent?.type,
      )
    ) {
      funcName = param.parent.parent.parent?.key.name;
    } else {
      funcName = param.parent.parent.parent?.name;
    }
  }

  return { paramName, funcName };
}

function getSuggestions(param, context) {
  const sourceCode = context.sourceCode;
  const suggestions = [];

  let pattern;
  let typeAnnotation;
  if (param.type === "AssignmentPattern" && param.left.type === "Identifier") {
    pattern = `{ ${param.left.name} = ${sourceCode.getText(param.right)} }`;
    typeAnnotation = `{ ${sourceCode.getText(param.left)}${
      param.left.typeAnnotation == undefined ? ": boolean" : ""
    } }`;
  } else if (param.type === "Identifier") {
    pattern = `{ ${param.name} }`;
    typeAnnotation = `{ ${sourceCode.getText(param)}${
      param.typeAnnotation == undefined ? ": boolean" : ""
    } }`;
  }

  if (pattern && typeAnnotation) {
    suggestions.push({
      messageId: "wrapParamInObject",
      data: { pattern },
      fix(fixer) {
        return fixer.replaceText(param, `${pattern}: ${typeAnnotation}`);
      },
    });
  }

  return suggestions;
}

module.exports = {
  meta: {
    type: "suggestion",
    hasSuggestions: true,
    fixable: "code",
    schema: [
      {
        type: "object",
        properties: {
          allowLoneParameter: {
            type: "boolean",
            default: false,
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [],
    messages: {
      booleanTrap: `Don't use raw boolean value{{paramInfo}} as a parameter{{funcInfo}}; call sites will appear ambiguous (the "boolean trap")`,
      wrapParamInObject: `Replace with {{pattern}}`,
    },
  },

  create(context) {
    const { allowLoneParameter } = context.options[0] ?? { allowLoneParameter: false };
    return {
      ":function > AssignmentPattern.params, :function > [typeAnnotation].params, TSFunctionType > [typeAnnotation].params, TSEmptyBodyFunctionExpression > [typeAnnotation].params":
        (param) => {
          if (allowLoneParameter && param.parent.params.length === 1) {
            return;
          }
          if (isBooleanParam(param)) {
            const { paramName, funcName } = getData(param);
            context.report({
              node: param,
              messageId: "booleanTrap",
              data: {
                paramInfo: paramName ? ` '${paramName}'` : "",
                funcInfo: funcName ? ` to '${funcName}'` : "",
              },
              suggest: getSuggestions(param, context),
            });
          }
        },
    };
  },
};
