/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import TextContent from "@lichtblick/suite-base/components/TextContent";
import { BasicBuilder } from "@lichtblick/test-builders";

function setup({ children }: { children: React.ReactNode }) {
  return render(<TextContent>{children}</TextContent>);
}

describe("TextContent", () => {
  const sampleText = BasicBuilder.string();
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("rendering children", () => {
    it("should render non-string children directly", () => {
      // When
      setup({ children: <span data-testid="custom-child">{sampleText}</span> });
      // Then
      expect(screen.getByTestId("custom-child")).toHaveTextContent(sampleText);
    });

    it("should render string children as markdown", () => {
      // When
      setup({ children: `# ${sampleText}` });
      // Then
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(sampleText);
    });

    it("should render markdown links as anchors", () => {
      // When
      setup({ children: `[${sampleText}](https://example.com)` });
      // Then
      const link = screen.getByRole("link", { name: sampleText });
      expect(link).toHaveAttribute("href", "https://example.com");
    });
  });

  describe("raw HTML", () => {
    it("should not render raw HTML", () => {
      // When
      setup({ children: `<span data-testid="raw-html">${sampleText}</span>` });
      // Then
      expect(screen.queryByTestId("raw-html")).not.toBeInTheDocument();
    });
  });
});
