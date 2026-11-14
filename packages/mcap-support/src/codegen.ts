// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Building blocks for generated code that cannot be injected into.
 *
 * Generated source is a list of `Code` values, and a `Code` can only come from:
 * - a `js` template literal, whose literal text is part of this repository's source,
 * - `ident()`, which only accepts plain identifiers (used as property names),
 * - `int()`, which only accepts non-negative safe integers,
 * - `Locals.next()`, which makes `v0`, `v1`, ...
 *
 * `js` only takes `Code` values in its holes (checked by the types and again at runtime), so
 * schema text (type names, field names, array lengths) can never reach the generated source as
 * raw text. Anything that does not pass `ident()` or `int()` makes the generator give up, and the
 * caller falls back to an interpreting decoder.
 */
// Only this module holds the token, so only the helpers below can make a `Code`.
const TRUSTED = Symbol("trusted");

export class Code {
  readonly #text: string;

  public constructor(token: typeof TRUSTED, text: string) {
    if (token !== TRUSTED) {
      throw new Error("Code can only be created in codegen.ts");
    }
    this.#text = text;
  }

  public toString(): string {
    return this.#text;
  }
}

const trusted = (text: string) => new Code(TRUSTED, text);

/** Thrown while generating code for a schema the generator does not handle. */
export class Unsupported extends Error {}

export function js(strings: TemplateStringsArray, ...parts: Code[]): Code {
  let text = strings[0]!;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!(part instanceof Code)) {
      throw new Unsupported(); // only reachable by bypassing the types
    }
    text += part.toString() + strings[i + 1]!;
  }
  return trusted(text);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A property name, for `obj.name` and `{ name: value }`. Anything else is unsupported. */
export function ident(name: unknown): Code {
  if (typeof name !== "string" || !IDENTIFIER.test(name) || name === "__proto__") {
    throw new Unsupported();
  }
  return trusted(name);
}

/** A non-negative integer literal. Anything else is unsupported. */
export function int(value: unknown): Code {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Unsupported();
  }
  return trusted(String(value));
}

export class Locals {
  #next = 0;

  public next(): Code {
    return trusted(`v${this.#next++}`);
  }
}

const MAX_SOURCE_LENGTH = 512 * 1024;

/** Collects lines of generated code and gives up on schemas that would make it too large. */
export class CodeBuilder {
  #lines: string[] = [];
  #length = 0;

  public emit(code: Code): void {
    const line = code.toString();
    this.#length += line.length + 1;
    if (this.#length > MAX_SOURCE_LENGTH) {
      throw new Unsupported();
    }
    this.#lines.push(line);
  }

  /**
   * Compiles the collected lines into a function with the given parameters. Returns undefined
   * when a Content-Security-Policy blocks `new Function` (EvalError). Other errors, such as a
   * Trusted Types TypeError, are thrown; callers must treat any error as "fall back".
   */
  public compile<F>(...params: Code[]): F | undefined {
    try {
      // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
      return new Function(...params.map(String), this.#lines.join("\n")) as F;
    } catch (error) {
      if (error instanceof EvalError) {
        return undefined;
      }
      throw error;
    }
  }
}
