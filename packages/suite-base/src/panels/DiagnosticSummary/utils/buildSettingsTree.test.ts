// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TFunction } from "i18next";

import { buildStatusPanelSettingsTree } from "@lichtblick/suite-base/panels/DiagnosticStatus/utils/buildStatusPanelSettingsTree";
import { DiagnosticTopics } from "@lichtblick/suite-base/panels/DiagnosticSummary/hooks/useDiagnosticTopics";
import DiagnosticsBuilder from "@lichtblick/suite-base/testing/builders/DiagnosticsBuilder";

import { buildSettingsTree } from "./buildSettingsTree";

const t = ((key: string) => key) as unknown as TFunction<"diagnostics">;

const topics: DiagnosticTopics = {
  available: ["/diagnostics", "/diagnostics_agg"],
  selected: ["/diagnostics", "/missing"],
  subscribed: ["/diagnostics"],
};

describe("buildSettingsTree", () => {
  it("builds general fields from the config", () => {
    const config = DiagnosticsBuilder.summaryConfig({
      sortByLevel: false,
      secondsUntilStale: 7,
      showHistory: undefined,
    });

    const tree = buildSettingsTree(config, topics, t);

    expect(tree.general?.fields?.sortByLevel?.value).toBe(false);
    expect(tree.general?.fields?.secondsUntilStale?.value).toBe(7);
    expect(tree.general?.fields?.showHistory?.value).toBe(true);
  });

  it("lists every topic with a visibility toggle and flags missing ones", () => {
    const tree = buildSettingsTree(DiagnosticsBuilder.summaryConfig(), topics, t);

    expect(tree.topics?.children).toEqual({
      "/diagnostics": { label: "/diagnostics", visible: true, error: undefined },
      "/diagnostics_agg": { label: "/diagnostics_agg", visible: false, error: undefined },
      "/missing": { label: "/missing", visible: true, error: "topicNotAvailable" },
    });
    expect(tree.topics?.error).toBeUndefined();
  });

  it("shows an error when there are no diagnostics topics", () => {
    const tree = buildSettingsTree(
      DiagnosticsBuilder.summaryConfig(),
      { available: [], selected: [], subscribed: [] },
      t,
    );
    expect(tree.topics?.error).toBe("noTopics");
  });
});

describe("buildStatusPanelSettingsTree", () => {
  it("builds general fields and the topics node", () => {
    const config = DiagnosticsBuilder.statusConfig({ numericPrecision: 3, secondsUntilStale: 2 });

    const tree = buildStatusPanelSettingsTree(config, topics, t);

    expect(tree.general?.fields?.numericPrecision?.value).toBe(3);
    expect(tree.general?.fields?.secondsUntilStale?.value).toBe(2);
    expect(Object.keys(tree.topics?.children ?? {})).toHaveLength(3);
  });
});
