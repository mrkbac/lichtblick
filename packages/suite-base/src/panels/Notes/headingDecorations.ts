// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { editor } from "monaco-editor/editor/editor.api.js";

/** Style Markdown headings without changing their source or styling fenced code as headings. */
export function headingDecorations(text: string, fontSize: number): editor.IModelDeltaDecoration[] {
  const decorations: editor.IModelDeltaDecoration[] = [];
  let fence: string | undefined;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence != undefined) {
      if (
        marker != undefined &&
        marker[1]!.startsWith(fence[0]!) &&
        marker[1]!.length >= fence.length &&
        marker[2]!.trim() === ""
      ) {
        fence = undefined;
      }
      continue;
    }
    if (marker && (!marker[1]!.startsWith("`") || !marker[2]!.includes("`"))) {
      fence = marker[1];
      continue;
    }
    const heading = /^ {0,3}(#{1,6})(?:[\t ]|$)/.exec(line);
    if (heading) {
      const scale = [2, 1.6, 1.35, 1.15, 1, 1][heading[1]!.length - 1]!;
      decorations.push({
        range: {
          startLineNumber: index + 1,
          startColumn: 1,
          endLineNumber: index + 1,
          endColumn: line.length + 1,
        },
        options: {
          fontSize: `${fontSize * scale}px`,
          inlineClassName: `notes-heading notes-heading-${heading[1]!.length}`,
          inlineClassNameAffectsLetterSpacing: true,
          fontWeight: "600",
          lineHeight: scale,
        },
      });
    }
  }
  return decorations;
}
