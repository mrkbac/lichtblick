// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { NumericType, PackedElementField } from "@foxglove/schemas";

import { PointField, PointFieldType } from "../../ros";

export type FieldReader = (view: DataView, pointOffset: number) => number;

// eslint-disable-next-line @lichtblick/no-boolean-parameters
function int8Reader(fieldOffset: number, normalize: boolean): FieldReader {
  return (view: DataView, pointOffset: number) => {
    const value = view.getInt8(pointOffset + fieldOffset);
    if (normalize) {
      return Math.max(value / 0x7f, -1);
    }
    return value;
  };
}

// eslint-disable-next-line @lichtblick/no-boolean-parameters
function uint8Reader(fieldOffset: number, normalize: boolean): FieldReader {
  return (view: DataView, pointOffset: number) => {
    const value = view.getUint8(pointOffset + fieldOffset);
    if (normalize) {
      return value / 0xff;
    }
    return value;
  };
}

// eslint-disable-next-line @lichtblick/no-boolean-parameters
function int16Reader(fieldOffset: number, normalize: boolean): FieldReader {
  return (view: DataView, pointOffset: number) => {
    const value = view.getInt16(pointOffset + fieldOffset, true);
    if (normalize) {
      return Math.max(value / 0x7fff, -1);
    }
    return value;
  };
}

// eslint-disable-next-line @lichtblick/no-boolean-parameters
function uint16Reader(fieldOffset: number, normalize: boolean): FieldReader {
  return (view: DataView, pointOffset: number) => {
    const value = view.getUint16(pointOffset + fieldOffset, true);
    if (normalize) {
      return value / 0xffff;
    }
    return value;
  };
}

// eslint-disable-next-line @lichtblick/no-boolean-parameters
function int32Reader(fieldOffset: number, normalize: boolean): FieldReader {
  return (view: DataView, pointOffset: number) => {
    const value = view.getInt32(pointOffset + fieldOffset, true);
    if (normalize) {
      return Math.max(value / 0x7fffffff, -1);
    }
    return value;
  };
}

// eslint-disable-next-line @lichtblick/no-boolean-parameters
function uint32Reader(fieldOffset: number, normalize: boolean): FieldReader {
  return (view: DataView, pointOffset: number) => {
    const value = view.getUint32(pointOffset + fieldOffset, true);
    if (normalize) {
      return value / 0xffffffff;
    }
    return value;
  };
}

function float32Reader(fieldOffset: number): FieldReader {
  return (view: DataView, pointOffset: number) => view.getFloat32(pointOffset + fieldOffset, true);
}

/**
 * Decodes IEEE 754 half-precision bits. Fallback for engines without DataView.getFloat16
 * (Chrome < 135, Safari < 18.2).
 */
export function halfToFloat(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  const sign = (bits & 0x8000) !== 0 ? -1 : 1;
  if (exponent === 0) {
    return sign * fraction * 2 ** -24; // zero and subnormals
  }
  if (exponent === 0x1f) {
    return fraction === 0 ? sign * Infinity : NaN;
  }
  return sign * (1024 + fraction) * 2 ** (exponent - 25);
}

// lib.es2025 types getFloat16 as always present, but older browsers lack it
const hasNativeFloat16 = typeof (DataView.prototype as Partial<DataView>).getFloat16 === "function";

function float16Reader(fieldOffset: number): FieldReader {
  return hasNativeFloat16
    ? (view: DataView, pointOffset: number) => view.getFloat16(pointOffset + fieldOffset, true)
    : (view: DataView, pointOffset: number) =>
        halfToFloat(view.getUint16(pointOffset + fieldOffset, true));
}

function float64Reader(fieldOffset: number): FieldReader {
  return (view: DataView, pointOffset: number) => view.getFloat64(pointOffset + fieldOffset, true);
}

export function isSupportedField(field: PackedElementField | PointField): boolean {
  // Only PointFields with count === 1 are supported (doesn't apply to PackedElementFields)
  if ("count" in field && field.count !== 1) {
    return false;
  }
  return true;
}

export function getReader(
  field: PackedElementField | PointField,
  stride: number,
  /** @see https://www.khronos.org/opengl/wiki/Normalized_Integer */
  // Performance-sensitive: this code is called for every point cloud message
  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  normalize = false,
  forceType?: PointFieldType | NumericType,
): FieldReader | undefined {
  if (!isSupportedField(field)) {
    return undefined;
  }

  if (!("type" in field)) {
    const type = forceType ?? field.datatype;
    switch (type) {
      case PointFieldType.INT8:
        return field.offset + 1 <= stride ? int8Reader(field.offset, normalize) : undefined;
      case PointFieldType.UINT8:
        return field.offset + 1 <= stride ? uint8Reader(field.offset, normalize) : undefined;
      case PointFieldType.INT16:
        return field.offset + 2 <= stride ? int16Reader(field.offset, normalize) : undefined;
      case PointFieldType.UINT16:
        return field.offset + 2 <= stride ? uint16Reader(field.offset, normalize) : undefined;
      case PointFieldType.INT32:
        return field.offset + 4 <= stride ? int32Reader(field.offset, normalize) : undefined;
      case PointFieldType.UINT32:
        return field.offset + 4 <= stride ? uint32Reader(field.offset, normalize) : undefined;
      case PointFieldType.FLOAT32:
        return field.offset + 4 <= stride ? float32Reader(field.offset) : undefined;
      case PointFieldType.FLOAT64:
        return field.offset + 8 <= stride ? float64Reader(field.offset) : undefined;
      default:
        return undefined;
    }
  } else {
    const type = (forceType ?? field.type) as NumericType;
    switch (type) {
      case NumericType.INT8:
        return field.offset + 1 <= stride ? int8Reader(field.offset, normalize) : undefined;
      case NumericType.UINT8:
        return field.offset + 1 <= stride ? uint8Reader(field.offset, normalize) : undefined;
      case NumericType.INT16:
        return field.offset + 2 <= stride ? int16Reader(field.offset, normalize) : undefined;
      case NumericType.UINT16:
        return field.offset + 2 <= stride ? uint16Reader(field.offset, normalize) : undefined;
      case NumericType.INT32:
        return field.offset + 4 <= stride ? int32Reader(field.offset, normalize) : undefined;
      case NumericType.UINT32:
        return field.offset + 4 <= stride ? uint32Reader(field.offset, normalize) : undefined;
      case NumericType.FLOAT32:
        return field.offset + 4 <= stride ? float32Reader(field.offset) : undefined;
      case NumericType.FLOAT64:
        return field.offset + 8 <= stride ? float64Reader(field.offset) : undefined;
      case NumericType.FLOAT16:
        return field.offset + 2 <= stride ? float16Reader(field.offset) : undefined;
      default:
        return undefined;
    }
  }
}
