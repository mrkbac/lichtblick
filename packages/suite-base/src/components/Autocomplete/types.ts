// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TextFieldProps } from "@mui/material";

export type AutocompleteProps = {
  className?: string;
  disabled?: boolean;
  filterText?: string;
  hasError?: boolean;
  items: readonly string[];
  onChange?: (event: React.SyntheticEvent, text: string) => void;
  onSelect: (value: string, autocomplete: IAutocomplete) => void;
  placeholder?: string;
  readOnly?: boolean;
  value?: string;
  variant?: TextFieldProps["variant"];
};

export interface IAutocomplete {
  setSelectionRange(selectionStart: number, selectionEnd: number): void;
  focus(): void;
  blur(): void;
}
