/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import type { Mock } from "vitest";
import "@testing-library/jest-dom/vitest";

import { IdbLayoutStorage } from "@lichtblick/suite-base/IdbLayoutStorage";
import { SharedRootContext } from "@lichtblick/suite-base/context/SharedRootContext";
import UserProfileLocalStorageProvider from "@lichtblick/suite-base/providers/UserProfileLocalStorageProvider";

import { StudioApp } from "./StudioApp";
import StudioToastProvider from "./components/StudioToastProvider";
import CurrentLayoutProvider from "./providers/CurrentLayoutProvider";
import LayoutManagerProvider from "./providers/LayoutManagerProvider";

// Mock all the heavy dependencies
const mockMultiProvider = vi.fn(function ({
  providers,
  children,
}: {
  providers: React.JSX.Element[];
  children?: React.ReactNode;
}) {
  return (
    <div data-testid="multi-provider" data-provider-count={providers.length}>
      {children}
    </div>
  );
});

vi.mock("./Workspace", () => ({
  __esModule: true,
  default: ({ deepLinks, AppBarComponent, ...props }: any) => (
    <div
      data-testid="workspace"
      data-deep-links={Array.isArray(deepLinks) ? JSON.stringify(deepLinks) : String(deepLinks)}
    >
      <div data-testid="workspace-props">
        {JSON.stringify(props, (_key, value) => {
          // Convert functions to string representation for testing
          if (typeof value === "function") {
            return "function";
          }
          return value;
        })}
      </div>
      {AppBarComponent != undefined && <div data-testid="app-bar-component">AppBarComponent</div>}
    </div>
  ),
}));

vi.mock("./components/MultiProvider", () => ({
  __esModule: true,
  default: (props: { providers: React.JSX.Element[]; children?: React.ReactNode }) =>
    mockMultiProvider(props),
}));

vi.mock("./components/DocumentTitleAdapter", () => ({
  __esModule: true,
  default: () => <div data-testid="document-title-adapter" />,
}));

vi.mock("./components/SendNotificationToastAdapter", () => ({
  __esModule: true,
  default: () => <div data-testid="notification-toast-adapter" />,
}));

vi.mock("./providers/PanelCatalogProvider", () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="panel-catalog-provider">{children}</div>,
}));

vi.mock("./screens/LaunchPreference", () => ({
  LaunchPreference: ({ children }: any) => <div data-testid="launch-preference">{children}</div>,
}));

vi.mock("@lichtblick/suite-base/IdbLayoutStorage", () => ({
  IdbLayoutStorage: vi.fn().mockImplementation(function () {
    return {
      mockLayoutStorage: true,
    };
  }),
}));

vi.mock("@lichtblick/suite-base/context/OrganizationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lichtblick/suite-base/context/OrganizationContext")>()),
  useOrganizationSession: () => ({ status: "disabled" }),
}));

// Mock the LayoutManager to avoid private fields issue
vi.mock("./services/LayoutManager/LayoutManager", () => ({
  LayoutManager: vi.fn().mockImplementation(function () {
    return {
      supportsSharing: false,
      getLayouts: vi.fn().mockResolvedValue([]),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
  }),
}));

// Mock LayoutManagerProvider
vi.mock("./providers/LayoutManagerProvider", () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="layout-manager-provider">{children}</div>,
}));

describe("StudioApp", () => {
  const mockSharedRootContext = {
    dataSources: [],
    extensionLoaders: [],
    deepLinks: [],
    enableLaunchPreferenceScreen: false,
    AppBarComponent: undefined,
  };

  const renderWithContext = (contextValue: any = mockSharedRootContext) => {
    return render(
      <SharedRootContext.Provider value={contextValue}>
        <StudioApp />
      </SharedRootContext.Provider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Clear console.error mock to avoid setupTestFramework.ts throwing
    if (typeof (console.error as any).mockClear === "function") {
      (console.error as any).mockClear();
    }

    // Mock URL constructor
    global.URL = vi.fn().mockImplementation(function (_url) {
      return {
        searchParams: {
          get: vi.fn().mockReturnValue(undefined),
        },
      };
    }) as any;

    // Mock document.addEventListener
    vi.spyOn(document, "addEventListener").mockImplementation(function () {
      return undefined;
    });
    vi.spyOn(document, "removeEventListener").mockImplementation(function () {
      return undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render basic StudioApp structure", () => {
    renderWithContext();

    expect(screen.getByTestId("multi-provider")).toBeInTheDocument();
    expect(screen.getByTestId("document-title-adapter")).toBeInTheDocument();
    expect(screen.getByTestId("notification-toast-adapter")).toBeInTheDocument();
    expect(screen.getByTestId("panel-catalog-provider")).toBeInTheDocument();
    expect(screen.getByTestId("workspace")).toBeInTheDocument();
  });

  it("should pass deepLinks to Workspace component", () => {
    const deepLinks = [{ url: "test://link1" }, { url: "test://link2" }];
    renderWithContext({
      ...mockSharedRootContext,
      deepLinks,
    });

    const workspace = screen.getByTestId("workspace");
    expect(workspace).toHaveAttribute("data-deep-links", JSON.stringify(deepLinks));
  });

  it("should render AppBarComponent when provided", () => {
    const AppBarComponent = () => <div>Custom AppBar</div>;
    renderWithContext({
      ...mockSharedRootContext,
      AppBarComponent,
    });

    expect(screen.getByTestId("app-bar-component")).toBeInTheDocument();
  });

  it("should render LaunchPreference when enableLaunchPreferenceScreen is true", () => {
    renderWithContext({
      ...mockSharedRootContext,
      enableLaunchPreferenceScreen: true,
    });

    expect(screen.getByTestId("launch-preference")).toBeInTheDocument();
  });

  it("should not render LaunchPreference when enableLaunchPreferenceScreen is false", () => {
    renderWithContext({
      ...mockSharedRootContext,
      enableLaunchPreferenceScreen: false,
    });

    expect(screen.queryByTestId("launch-preference")).not.toBeInTheDocument();
  });

  it("should create providers array with correct count", () => {
    renderWithContext();

    const multiProvider = screen.getByTestId("multi-provider");
    const providerCount = parseInt(multiProvider.getAttribute("data-provider-count") ?? "0", 10);

    // Should have base providers (exact count may vary, but should be reasonable)
    expect(providerCount).toBeGreaterThan(5);
  });

  it("puts the toast provider outside the layout providers that show toasts", () => {
    renderWithContext();

    const providerTypes = mockMultiProvider.mock.calls[0]![0].providers.map(
      (provider) => provider.type,
    );
    expect(providerTypes.indexOf(StudioToastProvider)).toBeLessThan(
      providerTypes.indexOf(CurrentLayoutProvider),
    );
    expect(providerTypes.indexOf(UserProfileLocalStorageProvider)).toBeLessThan(
      providerTypes.indexOf(LayoutManagerProvider),
    );
  });

  it("should handle context menu prevention", () => {
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");
    renderWithContext();

    expect(addEventListenerSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
  });

  it("should create IdbLayoutStorage", () => {
    renderWithContext();

    expect(vi.mocked(IdbLayoutStorage)).toHaveBeenCalled();
  });

  describe("context menu handler", () => {
    let contextMenuHandler: any;

    beforeEach(() => {
      renderWithContext();

      // Get the context menu handler that was registered
      const addEventListenerCalls = (document.addEventListener as Mock).mock.calls;
      const contextMenuCall = addEventListenerCalls.find((call) => call[0] === "contextmenu");
      contextMenuHandler = contextMenuCall?.[1];
    });

    it("should prevent context menu on non-input elements", () => {
      const mockEvent = {
        target: document.createElement("div"),
        preventDefault: vi.fn(),
      } as any;

      const result = contextMenuHandler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should allow context menu on input elements", () => {
      const mockEvent = {
        target: document.createElement("input"),
        preventDefault: vi.fn(),
      } as any;

      contextMenuHandler(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });

    it("should allow context menu on textarea elements", () => {
      const mockEvent = {
        target: document.createElement("textarea"),
        preventDefault: vi.fn(),
      } as any;

      contextMenuHandler(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  it("should cleanup event listeners on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderWithContext();

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
  });
});
