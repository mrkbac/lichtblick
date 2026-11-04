/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import type { Mock } from "vitest";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";
import useAlertCount from "@lichtblick/suite-base/hooks/useAlertCount";
import { PlayerPresence } from "@lichtblick/suite-base/players/types";

import DataSourceSidebar from "./DataSourceSidebar";

vi.mock("react-i18next", () => ({
  useTranslation: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/components/MessagePipeline", () => ({
  useMessagePipeline: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/hooks/useAlertCount", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("@lichtblick/suite-base/components/SidebarContent", () => ({
  SidebarContent: ({
    children,
    trailingItems,
  }: React.PropsWithChildren<{ trailingItems?: React.ReactNode }>) => (
    <div>
      {trailingItems}
      {children}
    </div>
  ),
}));

vi.mock("@lichtblick/suite-base/components/TopicList", () => ({
  TopicList: () => <div data-testid="topic-list" />,
}));

vi.mock("@lichtblick/suite-base/components/WssErrorModal", () => ({
  __esModule: true,
  default: () => <div data-testid="wss-error-modal" />,
}));

vi.mock("../AlertList/AlertsList", () => ({
  AlertsList: () => <div data-testid="alerts-list" />,
}));

vi.mock("../DataSourceInfoView", () => ({
  DataSourceInfoView: () => <div data-testid="data-source-info-view" />,
}));

describe("DataSourceSidebar - Alerts tab badge", () => {
  const mockUseMessagePipeline = useMessagePipeline as Mock;
  const mockUseAlertCount = useAlertCount as Mock;
  const mockUseWorkspaceActions = useWorkspaceActions as Mock;

  beforeEach(() => {
    (useTranslation as Mock).mockReturnValue({ t: (key: string) => key });
    mockUseMessagePipeline.mockReturnValue(PlayerPresence.PRESENT);
    mockUseWorkspaceActions.mockReturnValue({
      dialogActions: { dataSource: { open: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should not show the badge when alertCount is 0", () => {
    // Given
    mockUseAlertCount.mockReturnValue({ playerAlerts: [], sessionAlerts: [], alertCount: 0 });

    // When
    render(<DataSourceSidebar />);

    // Then
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("should show the badge with count 1 when alertCount is 1", () => {
    // Given
    mockUseAlertCount.mockReturnValue({
      playerAlerts: [{ message: "error", severity: "error" }],
      sessionAlerts: [],
      alertCount: 1,
    });

    // When
    render(<DataSourceSidebar />);

    // Then
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("should show the correct count in the badge for multiple alerts", () => {
    // Given
    mockUseAlertCount.mockReturnValue({
      playerAlerts: [
        { message: "error 1", severity: "error" },
        { message: "error 2", severity: "warn" },
      ],
      sessionAlerts: [{ message: "session error", severity: "error" }],
      alertCount: 3,
    });

    // When
    render(<DataSourceSidebar />);

    // Then
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("should not render the Alerts tab when playerPresence is NOT_PRESENT", () => {
    // Given
    mockUseAlertCount.mockReturnValue({ playerAlerts: [], sessionAlerts: [], alertCount: 5 });
    mockUseMessagePipeline.mockReturnValue(PlayerPresence.NOT_PRESENT);

    // When
    render(<DataSourceSidebar />);

    // Then
    expect(screen.queryByText("Alerts")).not.toBeInTheDocument();
  });

  it("should not render the Alerts tab when disableToolbar is true", () => {
    // Given
    mockUseAlertCount.mockReturnValue({
      playerAlerts: [{ message: "error", severity: "error" }],
      sessionAlerts: [],
      alertCount: 1,
    });

    // When
    render(<DataSourceSidebar disableToolbar />);

    // Then
    expect(screen.queryByText("Alerts")).not.toBeInTheDocument();
  });
});
