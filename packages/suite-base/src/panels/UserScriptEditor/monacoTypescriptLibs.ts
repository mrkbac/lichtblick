// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Stands in for Monaco's lib maps (`lib.js`, `lib.index.js`), see the resolve.alias in rspack.ts.
// Kept apart from monacoTypescript.ts because the editor's main thread imports `lib.index.js`.
// The editor gets its lib .d.ts from the user script project config (Editor.tsx adds it as an
// extra lib with noLib), so Monaco needs none of its own.
export const libFileMap: Record<string, string> = {};
export const libFileSet: Record<string, boolean> = {};
