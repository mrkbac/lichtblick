// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageDefinitionField } from "@foxglove/message-definition";

import { MessageDefinitionMap } from "./types";

/**
 * Reduce a JSON Schema `type` union (e.g. `["number", "null"]`) to a single type: `null` is
 * dropped (a missing value), `integer | number` widens to `number`. Any other mix can't map to one
 * field type and returns "mixed", so the field is left out of the datatypes instead of failing
 * the whole channel.
 */
function resolveType(type: unknown): unknown {
  if (!Array.isArray(type)) {
    return type;
  }
  const types = [...new Set(type.filter((t) => t !== "null"))];
  if (types.length === 1) {
    return types[0];
  }
  if (types.length === 2 && types.includes("number") && types.includes("integer")) {
    return "number";
  }
  return types.length === 0 ? "null" : "mixed";
}

/**
 * Parse a JSON Schema and produce datatypes and a deserializer function.
 */
export function parseJsonSchema(
  rootJsonSchema: Record<string, unknown>,
  rootTypeName: string,
): {
  datatypes: MessageDefinitionMap;

  /**
   * A function that should be called after parsing a value from a JSON string to do any necessary
   * post-processing (e.g. base64 decoding)
   */
  postprocessValue: (value: Record<string, unknown>) => unknown;
} {
  const datatypes: MessageDefinitionMap = new Map();

  function addFieldsRecursive(
    schema: Record<string, unknown>,
    typeName: string,
    keyPath: string[],
  ): (value: Record<string, unknown>) => unknown {
    let postprocessObject: (value: Record<string, unknown>) => unknown = (value) => value;
    const fields: MessageDefinitionField[] = [];
    if (resolveType(schema.type) !== "object") {
      throw new Error(
        `Expected "type": "object" for schema ${typeName}, got ${JSON.stringify(schema.type)}`,
      );
    }
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const [fieldName, fieldSchema] of Object.entries(properties)) {
      if (Array.isArray(fieldSchema.oneOf)) {
        if (fieldSchema.oneOf.every((alternative) => typeof alternative.const === "number")) {
          for (const alternative of fieldSchema.oneOf) {
            fields.push({
              name: alternative.title,
              type: "uint32",
              isConstant: true,
              value: alternative.const,
            });
          }
          fields.push({ name: fieldName, type: "uint32" });
          continue;
        } else {
          throw new Error(
            `Unsupported type for ${keyPath
              .concat(fieldName)
              .join(".")}: oneOf alternatives must have number values`,
          );
        }
      }
      const fieldType = resolveType(fieldSchema.type);
      const itemType =
        fieldType === "array"
          ? resolveType((fieldSchema.items as Record<string, unknown> | undefined)?.type)
          : undefined;
      if (fieldType === "mixed" || itemType === "mixed") {
        continue;
      }
      switch (fieldType) {
        case "boolean":
          fields.push({ name: fieldName, type: "bool" });
          break;
        case "string":
          switch (fieldSchema.contentEncoding) {
            case undefined:
              fields.push({ name: fieldName, type: "string" });
              break;
            case "base64": {
              fields.push({ name: fieldName, type: "uint8", isArray: true });
              const prevPostprocess = postprocessObject;
              postprocessObject = (value) => {
                const str = value[fieldName];
                if (typeof str === "string") {
                  value[fieldName] = Uint8Array.fromBase64(str);
                }
                return prevPostprocess(value);
              };
              break;
            }
            default:
              throw new Error(
                `Unsupported contentEncoding ${JSON.stringify(
                  fieldSchema.contentEncoding,
                )} in ${keyPath.concat(fieldName).join(".")}`,
              );
          }
          break;
        case "number":
          fields.push({ name: fieldName, type: "float64" });
          break;
        case "integer":
          fields.push({
            name: fieldName,
            type:
              (typeof fieldSchema.minimum === "number" && fieldSchema.minimum >= 0) ||
              (typeof fieldSchema.exclusiveMinimum === "number" &&
                fieldSchema.exclusiveMinimum >= 0)
                ? "uint32"
                : "int32",
          });
          break;
        case "object": {
          const nestedTypeName = `${typeName}.${fieldName}`;
          const postprocessNestedObject = addFieldsRecursive(
            fieldSchema,
            nestedTypeName,
            keyPath.concat(fieldName),
          );
          const prevPostprocess = postprocessObject;
          postprocessObject = (value) => {
            const fieldValue = value[fieldName];
            if (fieldValue != undefined && typeof fieldValue === "object") {
              value[fieldName] = postprocessNestedObject(fieldValue as Record<string, unknown>);
            }
            return prevPostprocess(value);
          };
          fields.push({ name: fieldName, type: nestedTypeName, isComplex: true });
          break;
        }
        case "array": {
          const itemSchema = fieldSchema.items as Record<string, unknown>;
          switch (itemType) {
            case "boolean":
              fields.push({ name: fieldName, type: "bool", isArray: true });
              break;
            case "string":
              if (itemSchema.contentEncoding != undefined) {
                throw new Error(
                  `Unsupported contentEncoding ${JSON.stringify(
                    itemSchema.contentEncoding,
                  )} for array item ${keyPath.concat(fieldName).join(".")}`,
                );
              }
              fields.push({ name: fieldName, type: "string", isArray: true });
              break;
            case "number":
              fields.push({ name: fieldName, type: "float64", isArray: true });
              break;
            case "integer":
              fields.push({
                name: fieldName,
                type:
                  (typeof itemSchema.minimum === "number" && itemSchema.minimum >= 0) ||
                  (typeof itemSchema.exclusiveMinimum === "number" &&
                    itemSchema.exclusiveMinimum >= 0)
                    ? "uint32"
                    : "int32",
                isArray: true,
              });
              break;
            case "object": {
              const nestedTypeName = `${typeName}.${fieldName}`;
              const postprocessArrayItem = addFieldsRecursive(
                fieldSchema.items as Record<string, unknown>,
                nestedTypeName,
                keyPath.concat(fieldName),
              );
              const prevPostprocess = postprocessObject;
              postprocessObject = (value) => {
                const arr = value[fieldName];
                if (Array.isArray(arr)) {
                  value[fieldName] = arr.map((item: unknown) =>
                    // items may be null when the item type is ["object", "null"]
                    item != undefined && typeof item === "object"
                      ? postprocessArrayItem(item as Record<string, unknown>)
                      : item,
                  );
                }
                return prevPostprocess(value);
              };
              fields.push({
                name: fieldName,
                type: nestedTypeName,
                isComplex: true,
                isArray: true,
              });
              break;
            }
            default:
              throw new Error(
                `Unsupported type ${JSON.stringify(itemSchema.type)} for array item ${keyPath
                  .concat(fieldName)
                  .join(".")}`,
              );
          }
          break;
        }
        case "null":
        default:
          throw new Error(
            `Unsupported type ${JSON.stringify(fieldSchema.type)} for ${keyPath
              .concat(fieldName)
              .join(".")}`,
          );
      }
    }
    datatypes.set(typeName, { definitions: fields });
    return postprocessObject;
  }

  const postprocessValue = addFieldsRecursive(rootJsonSchema, rootTypeName, []);
  return { datatypes, postprocessValue };
}
