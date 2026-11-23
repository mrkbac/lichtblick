// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Stack from "@lichtblick/suite-base/components/Stack";

import { NumberInput } from "./NumberInput";

type VecProps<T extends (undefined | number)[]> = {
  size: T["length"];
  disabled?: boolean;
  onChange: (value: T) => void;
  precision?: number;
  readOnly?: boolean;
  step?: number;
  placeholder?: readonly (undefined | string)[];
  value: undefined | Readonly<T>;
  min?: number;
  max?: number;
};

export function VecInput<T extends (undefined | number)[]>(props: VecProps<T>): React.JSX.Element {
  const {
    size,
    disabled = false,
    onChange,
    precision,
    readOnly = false,
    step,
    value,
    min,
    max,
    placeholder,
  } = props;

  return (
    <Stack gap={0.25}>
      {Array.from({ length: size }, (_, i) => (
        <NumberInput
          key={i}
          data-testid={`Vec${size}Input-${i}`}
          size="small"
          disabled={disabled}
          readOnly={readOnly}
          variant="filled"
          fullWidth
          precision={precision}
          step={step}
          placeholder={placeholder?.[i]}
          value={value?.[i]}
          min={min}
          max={max}
          onChange={(newValue) => {
            const newVec = (value ? [...value] : new Array<number>(size).fill(0)) as T;
            newVec[i] = newValue;
            onChange(newVec);
          }}
        />
      ))}
    </Stack>
  );
}
