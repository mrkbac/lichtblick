// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ComponentType, useMemo } from "react";

import { useCrash } from "@lichtblick/hooks";
import { PanelExtensionContext } from "@lichtblick/suite";
import { CaptureErrorBoundary } from "@lichtblick/suite-base/components/CaptureErrorBoundary";
import Panel from "@lichtblick/suite-base/components/Panel";
import { PanelExtensionAdapter } from "@lichtblick/suite-base/components/PanelExtensionAdapter";
import { createSyncRoot } from "@lichtblick/suite-base/panels/createSyncRoot";
import ThemeProvider from "@lichtblick/suite-base/theme/ThemeProvider";
import { SaveConfig } from "@lichtblick/suite-base/types/panels";

type Config = Record<string, unknown>;

/**
 * Wraps a built-in panel written against the extension API (`{ context }`) as a regular panel:
 * renders it in its own sync root behind an error boundary, optionally forcing the dark theme.
 */
export function extensionPanel(
  panelType: string,
  Component: ComponentType<{ context: PanelExtensionContext }>,
  { dark = false }: { dark?: boolean } = {},
): ReturnType<typeof Panel<Config, { config: Config; saveConfig: SaveConfig<Config> }>> {
  function initPanel(crash: ReturnType<typeof useCrash>, context: PanelExtensionContext) {
    const panel = <Component context={context} />;
    return createSyncRoot(
      <CaptureErrorBoundary onError={crash}>
        {dark ? <ThemeProvider isDark>{panel}</ThemeProvider> : panel}
      </CaptureErrorBoundary>,
      context.panelElement,
    );
  }

  function ExtensionPanelAdapter({
    config,
    saveConfig,
  }: {
    config: Config;
    saveConfig: SaveConfig<Config>;
  }) {
    const crash = useCrash();
    const boundInitPanel = useMemo(() => initPanel.bind(undefined, crash), [crash]);
    return (
      <PanelExtensionAdapter
        config={config}
        saveConfig={saveConfig}
        initPanel={boundInitPanel}
        highestSupportedConfigVersion={1}
      />
    );
  }

  return Panel(
    Object.assign(ExtensionPanelAdapter, { panelType, defaultConfig: {} }),
  );
}
