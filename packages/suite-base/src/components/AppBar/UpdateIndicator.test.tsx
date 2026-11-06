/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";

import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";

import { UpdateIndicator } from "./UpdateIndicator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const fakeWorker = () => Object.assign(new EventTarget(), { state: "", postMessage: vi.fn() });

function mockRegistration(registration: { active?: unknown; waiting?: unknown }) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: async () => Object.assign(new EventTarget(), registration),
    }),
  });
}

const renderIndicator = () =>
  render(
    <ThemeProvider isDark={false}>
      <UpdateIndicator />
    </ThemeProvider>,
  );

describe("UpdateIndicator", () => {
  it("applies the waiting update only when clicked", async () => {
    const waiting = fakeWorker();
    mockRegistration({ active: fakeWorker(), waiting });
    renderIndicator();

    const button = await screen.findByTestId("update-indicator");
    expect(waiting.postMessage).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("stays hidden on the very first install", async () => {
    mockRegistration({ waiting: fakeWorker() });
    renderIndicator();
    await Promise.resolve();
    expect(screen.queryByTestId("update-indicator")).toBeNull();
  });
});
