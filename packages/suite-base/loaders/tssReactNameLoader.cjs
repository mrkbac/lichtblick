// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Dev-only loader: in files that import makeStyles from "tss-react/mui", turns `makeStyles()` into
 * `makeStyles({ name: "<file>" })` so generated class names say which component they belong to.
 *
 * @param {string} source
 * @returns {string}
 */
module.exports = function tssReactNameLoader(source) {
  if (!/import\s*\{[^}]*\bmakeStyles\b[^}]*\}\s*from\s*"tss-react\/mui"/.test(source)) {
    return source;
  }
  const name = this.resourcePath
    .replace(/^.*packages\/[^/]*\//, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  return source.replace(/\bmakeStyles\(\)/g, `makeStyles({ name: ${JSON.stringify(name)} })`);
};
