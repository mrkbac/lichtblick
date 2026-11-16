/** @jest-environment jsdom */

// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";

import { FieldEditor } from "@lichtblick/suite-base/components/SettingsTreeEditor/FieldEditor";
import { EditorSettingsTreeField } from "@lichtblick/suite-base/components/SettingsTreeEditor/types";

const messagePathInput = vi.hoisted(() => vi.fn((_props: Record<string, unknown>) => null));
vi.mock("@lichtblick/suite-base/components/MessagePathSyntax/MessagePathInput", () => ({
  default: messagePathInput,
}));

// How message path field flags from both extension APIs reach the input.
describe("FieldEditor messagepath flags", () => {
  const renderField = (field: Partial<EditorSettingsTreeField>) => {
    render(
      <FieldEditor
        actionHandler={vi.fn()}
        path={["root", "path"]}
        field={{ input: "messagepath", label: "Path", ...field } as EditorSettingsTreeField}
      />,
    );
    return messagePathInput.mock.lastCall?.[0];
  };

  beforeEach(() => {
    messagePathInput.mockClear();
  });

  it.each([
    [{ supportsMathModifiers: true }, true],
    [{ supportsMessagePathFunctions: true }, true],
    [{ supportsMathModifiers: false, supportsMessagePathFunctions: true }, false],
    [{}, undefined],
  ])("maps %o to supportsMathModifiers=%s", (flags, expected) => {
    expect(renderField(flags)?.supportsMathModifiers).toBe(expected);
  });

  it.each([
    [{ supportsTimeSeriesMessagePathFunctions: true }, true],
    [{ supportsTimeSeriesMessagePathFunctions: false }, false],
    [{}, undefined],
  ])("maps %o to supportsStreamModifiers=%s", (flags, expected) => {
    expect(renderField(flags)?.supportsStreamModifiers).toBe(expected);
  });

  it("passes validTopics and validTypes through", () => {
    const props = renderField({ validTopics: ["/a"], validTypes: ["float64"] });
    expect(props).toEqual(
      expect.objectContaining({ validTopics: ["/a"], validTypes: ["float64"] }),
    );
  });
});
