/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import templates from "@lichtblick/suite-base/players/UserScriptPlayer/transformerWorker/typescript/templates";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { Templates } from "./Templates";

vi.mock(
  "@lichtblick/suite-base/players/UserScriptPlayer/transformerWorker/typescript/templates",
  () => ({
    __esModule: true,
    default: [
      { name: "Skeleton Template", description: "An empty script", template: "skeleton-code" },
      { name: "Marker Template", description: "Publishes markers", template: "marker-code" },
    ],
  }),
);

function renderTemplates(props: Partial<React.ComponentProps<typeof Templates>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const addNewNode = props.addNewNode ?? vi.fn();

  render(
    <ThemeProvider isDark={false}>
      <Templates onClose={onClose} addNewNode={addNewNode} />
    </ThemeProvider>,
  );

  return { onClose, addNewNode };
}

describe("Templates", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("should render the name and description of each template", () => {
    // Given

    // When
    renderTemplates();

    // Then
    templates.forEach((template) => {
      expect(screen.getByText(template.name)).toBeInTheDocument();
      expect(screen.getByText(template.description)).toBeInTheDocument();
    });
  });

  it("should call addNewNode with the template when a template is clicked", () => {
    // Given
    const { addNewNode } = renderTemplates();

    // When
    fireEvent.click(screen.getByText(templates[0]!.name));

    // Then
    expect(addNewNode).toHaveBeenCalledWith(templates[0]!.template);
  });

  it("should call onClose when the collapse button is clicked", () => {
    // Given
    const { onClose } = renderTemplates();

    // When
    fireEvent.click(screen.getByTitle("Collapse"));

    // Then
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
