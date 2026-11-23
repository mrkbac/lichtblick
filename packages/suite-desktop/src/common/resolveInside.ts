// SPDX-License-Identifier: MPL-2.0

import { isAbsolute, relative, resolve, sep } from "path";

/** Resolve `segments` under `root`, throwing if the result is `root` itself or lies outside it. */
export function resolveInside(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments);
  const rel = relative(resolve(root), target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path ${segments.join("/")} escapes ${root}`);
  }
  return target;
}
