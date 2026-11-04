// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageDefinitionField } from "@lichtblick/message-definition";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

/** Type definition as returned by rosapi's `service_request_details` / `service_response_details`. */
export type RosapiTypeDef = {
  type: string;
  fieldnames: string[];
  fieldtypes: string[];
  // -1: not an array, 0: variable length array, >0: fixed length array
  fieldarraylen: number[];
};

// rosapi on ROS 2 may report IDL primitive names
const IDL_PRIMITIVES: Record<string, string> = {
  boolean: "bool",
  octet: "uint8",
  byte: "uint8",
  char: "uint8",
  float: "float32",
  double: "float64",
  wstring: "string",
};

function normalizePrimitive(type: string): string {
  // bounded strings, e.g. "string<=10"
  const base = type.replace(/<=?\d+$/, "");
  return IDL_PRIMITIVES[base] ?? base;
}

/** Converts rosapi type definitions into datatypes usable by panels. */
export function rosapiTypeDefsToDatatypes(typedefs: readonly RosapiTypeDef[]): RosDatatypes {
  const datatypes: RosDatatypes = new Map();
  for (const typedef of typedefs) {
    const definitions = typedef.fieldnames.map((name, i): MessageDefinitionField => {
      const rawType = typedef.fieldtypes[i] ?? "";
      const arrayLength = typedef.fieldarraylen[i] ?? -1;
      const isComplex = rawType.includes("/");
      return {
        name,
        type: isComplex ? rawType : normalizePrimitive(rawType),
        isComplex,
        isArray: arrayLength >= 0,
        arrayLength: arrayLength > 0 ? arrayLength : undefined,
      };
    });
    datatypes.set(typedef.type, { definitions });
  }
  return datatypes;
}
