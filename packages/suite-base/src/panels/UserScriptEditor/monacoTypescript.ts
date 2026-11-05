// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Stands in for Monaco's bundled TypeScript (`typescriptServices.js`), see the resolve.alias in
// rspack.ts. Monaco's TS worker then runs on the same `typescript` package as the user script
// compiler, so the app ships one TypeScript. Only Monaco's TS worker may import this file.
import ts from "typescript/lib/typescript";

export const typescript = ts;
export const {
  createClassifier,
  createLanguageService,
  displayPartsToString,
  EndOfLineState,
  flattenDiagnosticMessageText,
  IndentStyle,
  ScriptKind,
  ScriptTarget,
  TokenClass,
} = ts;
