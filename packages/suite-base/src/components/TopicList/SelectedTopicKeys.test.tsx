/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";
import { createRef } from "react";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";

import { SelectedTopicKeys } from "./SelectedTopicKeys";
import { useTopicMessageNavigation } from "./useTopicMessageNavigation";

vi.mock("@lichtblick/suite-base/components/MessagePipeline");
vi.mock("./useTopicMessageNavigation");

describe("SelectedTopicKeys", () => {
  it("steps the topic on N inside the list and keeps the key from app-wide listeners", () => {
    vi.mocked(useMessagePipeline).mockReturnValue(true);
    const nav = {
      handleNextMessage: vi.fn(),
      handlePreviousMessage: vi.fn(),
      isNavigating: false,
      canNavigateNext: true,
      canNavigatePrevious: true,
    };
    vi.mocked(useTopicMessageNavigation).mockReturnValue(nav);
    const list = document.createElement("div");
    document.body.appendChild(list);
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement }).current = list;
    const appWide = vi.fn();
    document.addEventListener("keydown", appWide);
    render(<SelectedTopicKeys topicName="/a" containerRef={ref} />);

    list.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "N", shiftKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));

    expect(nav.handleNextMessage).toHaveBeenCalledTimes(1);
    expect(nav.handlePreviousMessage).toHaveBeenCalledTimes(1);
    // Only the press outside the list reached the document
    expect(appWide).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", appWide);
  });
});
