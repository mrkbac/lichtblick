// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { settingsRows } from "@lichtblick/suite-base/components/PanelDocs/PanelDocs";
import { panelButtons } from "@lichtblick/suite-base/i18n/en/panelButtons";

import { getBuiltin } from "./index";

const t = ((key: string) => key) as unknown as TFunction<"panels">;
const panels = getBuiltin(t).map((info) => [info.type, info] as const);

// Keys and gestures belong in the panel's shortcuts.ts, where they're bound and listed.
const INPUT_WORDS =
  /\b(esc|escape|enter|backspace|ctrl|cmd|shift-\w+|alt-\w+|right-click|double-click|right-drag|middle-drag)\b|⌘/i;

describe("built-in panel docs", () => {
  it.each(panels)("%s has an icon for the panel picker", (_type, info) => {
    expect(info.icon).toBeDefined();
  });

  it.each(panels)("%s has docs generated from its declarations", async (_type, info) => {
    expect(info.docs).toBeDefined();
    const docs = (await info.docs!()).default;
    expect(docs.intro.length).toBeGreaterThan(0);
    expect(docs.intro.length).toBeLessThan(140);

    for (const section of docs.sections ?? []) {
      for (const [term, text] of section.items) {
        expect(`${term}: ${text}`).not.toMatch(INPUT_WORDS);
      }
    }
    for (const row of settingsRows(docs.settings?.() ?? {})) {
      expect(row.help.trim()).not.toBe("");
      expect(`${row.label}: ${row.help}`).not.toMatch(INPUT_WORDS);
    }
  });

  it("documents every declared panel button in some panel's guide", async () => {
    const documented = new Set<string>();
    for (const [, info] of panels) {
      for (const button of (await info.docs!()).default.buttons ?? []) {
        documented.add(button.id);
      }
    }
    expect(Object.keys(panelButtons).filter((id) => !documented.has(id))).toEqual([]);
  });
});
