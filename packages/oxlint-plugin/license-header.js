// SPDX-License-Identifier: MPL-2.0

// Vendored from @lichtblick/eslint-plugin (MPL-2.0).

// A custom eslint rule checking for the existence of an MPL license header,
// while allowing certain prefixes that cannot be moved below the license header.

const LICENSE_TYPE = "MPL-2.0";
const ALLOWED_PREFIX_LINES = ["/** @jest-environment jsdom */", "/** @vitest-environment jsdom */"];

module.exports = {
  meta: {
    type: "suggestion",
    fixable: "code",
    schema: [],
    messages: {
      wrongHeaderError:
        "There is an error with the file header. Please check if the header exists or if there is a mistake in it.",
      prefixLinesError:
        "There are lines before the header that are not allowed. Please move them below the header.",
    },
  },

  create: (context) => {
    // New files get the SPDX license identifier alone. An optional copyright line directly above it
    // is accepted and kept as is, so existing upstream notices are never rewritten (MPL-2.0 §3.4).
    const EXPECTED_HEADER = `// SPDX-License-Identifier: ${LICENSE_TYPE}`;

    const HEADER_REGEX = /(?:\/\/ SPDX-FileCopyrightText: .+\n)?\/\/ SPDX-License-Identifier: (.+)/;

    return {
      Program: (node) => {
        const sourceCode = context.sourceCode;
        const fullText = sourceCode.getText();

        const match = fullText.match(HEADER_REGEX);

        const headerStartIndex = match?.index ?? -1;
        const headerEndIndex = match ? headerStartIndex + match[0].length : -1;

        const preHeaderText =
          headerStartIndex > -1 ? fullText.slice(0, headerStartIndex).trim() : fullText.trim();
        const prefixLines = preHeaderText.split("\n").filter(Boolean);
        const prefixLinesAreValid = prefixLines.every((line) =>
          ALLOWED_PREFIX_LINES.includes(line.trim()),
        );

        const isHeaderCorrect = match?.[1] === LICENSE_TYPE;

        if (!prefixLinesAreValid) {
          context.report({
            node,
            messageId: "prefixLinesError",
            fix: (fixer) => {
              const fixes = [];
              if (match) {
                // Move the existing header (copyright line included) to the top unchanged.
                fixes.push(fixer.removeRange([headerStartIndex, headerEndIndex]));
              }
              fixes.push(
                fixer.insertTextBeforeRange([0, 0], (match?.[0] ?? EXPECTED_HEADER) + "\n\n"),
              );
              return fixes;
            },
          });
          return;
        }
        if (!isHeaderCorrect) {
          context.report({
            node,
            messageId: "wrongHeaderError",
            fix: (fixer) => {
              if (!match) {
                // Only allowed prefix lines (or nothing) precede: append the header after them.
                const separator = fullText === "" || fullText.endsWith("\n") ? "" : "\n";
                return fixer.insertTextAfterRange(
                  [0, fullText.length],
                  `${separator}${EXPECTED_HEADER}`,
                );
              }
              // Fix only the license identifier; keep any copyright line.
              return fixer.replaceTextRange(
                [headerEndIndex - match[1].length, headerEndIndex],
                LICENSE_TYPE,
              );
            },
          });
        }
      },
    };
  },
};
