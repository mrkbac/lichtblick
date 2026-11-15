// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Types for `import url from "./zstd.wasm"`: the bundlers turn it into a URL (asset/resource or
// asset/inline, and a data: URL in vitest). A sibling file so every program that compiles this
// package (the app, quicklook, the packages build) resolves it without extra typings.
declare const url: string;
export default url;
