/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTranslation } from "react-i18next";

import { CatalogRecording } from "@lichtblick/suite-base/components/Catalog/types";
import { useCatalogFolder } from "@lichtblick/suite-base/components/Catalog/useCatalogFolder";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import {
  IDataSourceFactory,
  RecentSource,
  usePlayerSelection,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";

import Start from "./Start";

jest.mock("react-i18next", () => ({
  useTranslation: jest.fn(),
}));

jest.mock("@lichtblick/suite-base/context/PlayerSelectionContext", () => ({
  usePlayerSelection: jest.fn(),
}));

jest.mock("@lichtblick/suite-base/context/Workspace/useWorkspaceActions", () => ({
  useWorkspaceActions: jest.fn(),
}));

jest.mock("@lichtblick/suite-base/components/DataSourceDialog/DontShowThisAgainCheckbox", () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock("@lichtblick/suite-base/components/Catalog/Catalog", () => ({
  __esModule: true,
  default: ({ query }: { query: string }) => <div data-testid="catalog">{query}</div>,
}));

jest.mock("@lichtblick/suite-base/components/Catalog/useCatalogFolder", () => ({
  useCatalogFolder: jest.fn(),
}));

jest.mock("@lichtblick/suite-base/context/AnalyticsContext", () => ({
  useAnalytics: () => ({ logEvent: jest.fn() }),
}));

const wsSource = {
  id: "foxglove-websocket",
  type: "connection",
  displayName: "Foxglove WebSocket",
  formConfig: {
    fields: [
      { id: "url", label: "URL", defaultValue: "ws://localhost:8765" },
      { id: "other", label: "Other", defaultValue: "default" },
    ],
  },
  initialize: () => undefined,
} as unknown as IDataSourceFactory;

describe("Start Component", () => {
  const mockSelectRecent = jest.fn();
  const mockSelectSource = jest.fn();
  const mockRemoveRecent = jest.fn();
  const mockTogglePinRecent = jest.fn();
  const mockClearRecents = jest.fn();
  const mockOpenDialog = jest.fn();

  const mockRecentSources: RecentSource[] = [
    {
      id: "recent-1",
      title: "ws://localhost:8766/dir/example.mcap",
      type: "connection",
      sourceId: "foxglove-websocket",
    },
    { id: "recent-2", title: "local.bag", type: "file", pinned: true },
  ];

  const catalogRecording: CatalogRecording = {
    id: "local.bag",
    name: "local.bag",
    source: { type: "local-file", path: "local.bag" },
    start: { sec: 0, nsec: 0 },
    end: { sec: 90, nsec: 0 },
    topics: [{ name: "/camera", schema: "sensor_msgs/Image" }],
  };

  const setup = (recentSources: RecentSource[] = mockRecentSources) => {
    (useCatalogFolder as jest.Mock).mockReturnValue({ recordings: [catalogRecording] });
    (usePlayerSelection as jest.Mock).mockReturnValue({
      recentSources,
      availableSources: [wsSource],
      selectRecent: mockSelectRecent,
      selectSource: mockSelectSource,
      removeRecent: mockRemoveRecent,
      togglePinRecent: mockTogglePinRecent,
      clearRecents: mockClearRecents,
    });
    render(<Start />);
  };

  const typeUrl = (value: string) => {
    fireEvent.change(screen.getByPlaceholderText("openUrlPlaceholder"), {
      target: { value },
    });
  };

  beforeEach(() => {
    (useTranslation as jest.Mock).mockReturnValue({
      t: (key: string, options?: { version?: string; count?: number }) =>
        key === "version" && options
          ? `v${options.version}`
          : options?.count != undefined
            ? `${key} ${options.count}`
            : key,
      i18n: { language: "en" },
    });
    (useWorkspaceActions as jest.Mock).mockReturnValue({
      dialogActions: { dataSource: { open: mockOpenDialog } },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("lists recents by file name and opens them", () => {
    setup();

    fireEvent.click(screen.getByText("example.mcap"));
    fireEvent.click(screen.getByText("local.bag"));

    expect(mockSelectRecent).toHaveBeenNthCalledWith(1, "recent-1");
    expect(mockSelectRecent).toHaveBeenNthCalledWith(2, "recent-2");
  });

  it("pins, unpins, removes and clears recents", () => {
    setup();

    fireEvent.click(screen.getByLabelText("pin"));
    fireEvent.click(screen.getByLabelText("unpin"));
    fireEvent.click(screen.getAllByLabelText("removeRecent")[0]!);
    fireEvent.click(screen.getByText("clearRecents"));

    expect(mockTogglePinRecent).toHaveBeenNthCalledWith(1, "recent-1");
    expect(mockTogglePinRecent).toHaveBeenNthCalledWith(2, "recent-2");
    expect(mockRemoveRecent).toHaveBeenCalledWith("recent-1");
    expect(mockClearRecents).toHaveBeenCalled();
  });

  it("opens a typed URL with the detected source and default params", () => {
    setup();

    typeUrl("localhost:9000");
    fireEvent.click(screen.getByText("open"));

    expect(mockSelectSource).toHaveBeenCalledWith("foxglove-websocket", {
      type: "connection",
      params: { url: "ws://localhost:9000", other: "default" },
    });
  });

  it("re-opens the matching recent for a previously used URL", () => {
    setup();

    typeUrl("ws://localhost:8766/dir/example.mcap");
    fireEvent.click(screen.getByText("open"));

    expect(mockSelectRecent).toHaveBeenCalledWith("recent-1");
    expect(mockSelectSource).not.toHaveBeenCalled();
  });

  it("disables open for URLs without a matching source", () => {
    setup();

    typeUrl("https://example.com/page");

    expect(screen.getByText("open").closest("button")).toBeDisabled();
    expect(screen.getByText("unrecognizedUrl")).toBeInTheDocument();
  });

  it("opens the file and connection dialogs", () => {
    setup();

    fireEvent.click(screen.getByText("openLocalFiles"));
    fireEvent.click(screen.getByText("moreConnectionOptions"));

    expect(mockOpenDialog).toHaveBeenNthCalledWith(1, "file");
    expect(mockOpenDialog).toHaveBeenNthCalledWith(2, "connection");
  });

  it("shows the first recents and expands to all", () => {
    setup(
      Array.from({ length: 12 }, (_, i) => ({
        id: `id-${i}`,
        title: `file-${i}.mcap`,
      })),
    );

    expect(screen.getByText("file-4.mcap")).toBeInTheDocument();
    expect(screen.queryByText("file-11.mcap")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("showAllRecents 12"));
    expect(screen.getByText("file-11.mcap")).toBeInTheDocument();
  });

  it("shows the catalog summary of a recent file", () => {
    setup();

    expect(screen.getByText(/1:30.* · topicCount 1/)).toBeInTheDocument();
  });

  it("searches recents by name and by catalog topics, and passes the query to the catalog", () => {
    setup();
    const search = screen.getByPlaceholderText("searchPlaceholder");

    fireEvent.change(search, { target: { value: "example" } });
    expect(screen.getByText("example.mcap")).toBeInTheDocument();
    expect(screen.queryByText("local.bag")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "topic:/camera" } });
    expect(screen.queryByText("example.mcap")).not.toBeInTheDocument();
    expect(screen.getByText("local.bag")).toBeInTheDocument();
    expect(screen.getByTestId("catalog")).toHaveTextContent("topic:/camera");

    fireEvent.change(search, { target: { value: "nothing-matches" } });
    expect(screen.getByText("noRecentMatches")).toBeInTheDocument();
  });

  it("filters by source kind and hides the catalog for remote sources", () => {
    setup();

    fireEvent.click(screen.getByText("kindFile"));
    expect(screen.queryByText("example.mcap")).not.toBeInTheDocument();
    expect(screen.getByTestId("catalog")).toBeInTheDocument();

    fireEvent.click(screen.getByText("kindLive"));
    expect(screen.getByText("example.mcap")).toBeInTheDocument();
    expect(screen.queryByText("local.bag")).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalog")).not.toBeInTheDocument();
  });

  it("opens sample data from the footer", () => {
    setup();

    fireEvent.click(screen.getByText("exploreSampleData"));

    expect(mockOpenDialog).toHaveBeenCalledWith("demo");
  });

  it("does not render recent sources section if there are no recent sources", () => {
    setup([]);

    expect(screen.queryByText("recentDataSources")).not.toBeInTheDocument();
  });

  it("renders the app version", () => {
    setup();

    expect(screen.getByText(`v${APP_CONFIG.version}`)).toBeInTheDocument();
  });
});
