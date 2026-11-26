// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { TopicAliasFunction, ExtensionPanelRegistration, PanelSettings } from "@lichtblick/suite";
import ExtensionBuilder from "@lichtblick/suite-base/testing/builders/ExtensionBuilder";
import { InstalledMessageConverter } from "@lichtblick/suite-base/types/messageConverters";
import sendNotification from "@lichtblick/suite-base/util/sendNotification";
import { BasicBuilder } from "@lichtblick/test-builders";

import { buildContributionPoints } from "./buildContributionPoints";

// Failed activations are logged and also shown to the user
function expectNotified(): void {
  vi.mocked(console.error).mockClear();
  (sendNotification as unknown as { expectCalledDuringTest: () => void }).expectCalledDuringTest();
}

describe("buildContributionPoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize contribution objects", async () => {
    const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});
    const extensionInfo = ExtensionBuilder.extensionInfo();

    const result = await buildContributionPoints(extensionInfo, "");

    expect(result).toHaveProperty("panels", {});
    expect(result).toHaveProperty("messageConverters", []);
    expect(result).toHaveProperty("topicAliasFunctions", []);
    expect(result).toHaveProperty("panelSettings", {});
    consoleErrorMock.mockRestore();
    expectNotified();
  });

  it("should register a panel", async () => {
    const extensionInfo = ExtensionBuilder.extensionInfo();
    const panelName = BasicBuilder.string();
    const panelId = `${extensionInfo.qualifiedName}.${panelName}`;
    const registration: ExtensionPanelRegistration = {
      name: panelName,
      initPanel: vi.fn(),
    };

    (globalThis as any).panel = registration;
    const extensionSource = `
      module.exports = {
        activate: (ctx) => {
          ctx.registerPanel(globalThis.panel);
        }
      };
    `;

    const result = await buildContributionPoints(extensionInfo, extensionSource);

    expect(result.panels[panelId]).toBeDefined();
    expect(result.panels[panelId]).toEqual(
      expect.objectContaining({
        extensionId: extensionInfo.id,
        extensionName: extensionInfo.qualifiedName,
        extensionNamespace: extensionInfo.namespace,
        registration: expect.objectContaining({
          name: panelName,
          initPanel: expect.any(Function),
        }),
      }),
    );
    delete (globalThis as any).panel;
  });

  it("should warn when trying to register a duplicate panel", async () => {
    const logWarnMock = vi.spyOn(console, "warn").mockImplementation(() => {});
    const extensionInfo = ExtensionBuilder.extensionInfo();
    const panelName = BasicBuilder.string();
    const panelId = `${extensionInfo.qualifiedName}.${panelName}`;
    const registration: ExtensionPanelRegistration = {
      name: panelName,
      initPanel: vi.fn(),
    };

    (globalThis as any).panel = registration;
    const extensionSource = `
      module.exports = {
        activate: (ctx) => {
          ctx.registerPanel(globalThis.panel);
          ctx.registerPanel(globalThis.panel);
        }
      };
    `;

    const result = await buildContributionPoints(extensionInfo, extensionSource);

    expect(result.panels[panelId]).toBeDefined();
    expect(logWarnMock).toHaveBeenCalledWith(
      expect.stringContaining(`Panel ${panelId} is already registered`),
    );
    delete (globalThis as any).panel;
    logWarnMock.mockRestore();
  });

  it("should register a message converter", async () => {
    const extensionInfo = ExtensionBuilder.extensionInfo();
    const messageConverter: InstalledMessageConverter = {
      fromSchemaName: BasicBuilder.string(),
      toSchemaName: BasicBuilder.string(),
      panelSettings: {},
      extensionId: extensionInfo.id,
      converter: vi.fn(),
    };

    (globalThis as any).messageConverter = messageConverter;
    const extensionSource = `
      module.exports = {
        activate: (ctx) => {
          ctx.registerMessageConverter(globalThis.messageConverter);
        }
      };
    `;

    const result = await buildContributionPoints(extensionInfo, extensionSource);

    expect(result.messageConverters).toHaveLength(1);
    expect(result.messageConverters).toHaveLength(1);
    expect(result.messageConverters[0]).toEqual({
      ...messageConverter,
      extensionNamespace: extensionInfo.namespace,
      extensionId: extensionInfo.id,
    });
    delete (globalThis as any).messageConverter;
  });

  it("should register a message converter with panel settings", async () => {
    const extensionInfo = ExtensionBuilder.extensionInfo();
    const panelSettingsA: PanelSettings<unknown> = {
      defaultConfig: BasicBuilder.genericDictionary(String),
      handler: vi.fn(),
      settings: vi.fn(),
    };
    const panelSettingsB: PanelSettings<unknown> = {
      defaultConfig: BasicBuilder.genericDictionary(String),
      handler: vi.fn(),
      settings: vi.fn(),
    };
    const messageConverter: InstalledMessageConverter = {
      fromSchemaName: BasicBuilder.string(),
      toSchemaName: BasicBuilder.string(),
      panelSettings: {
        panelSettingsA,
        panelSettingsB,
      },
      converter: vi.fn(),
    };

    (globalThis as any).messageConverter = messageConverter;
    const extensionSource = `
      module.exports = {
        activate: (ctx) => {
          ctx.registerMessageConverter(globalThis.messageConverter);
        }
      };
    `;

    const result = await buildContributionPoints(extensionInfo, extensionSource);

    expect(result.panelSettings).toBeDefined();
    expect(Object.keys(result.panelSettings)).toHaveLength(2);
    expect(result.messageConverters).toHaveLength(1);
    expect(result.messageConverters[0]?.extensionId).toEqual(extensionInfo.id);
    expect(result.panelSettings.panelSettingsA).toHaveProperty(messageConverter.fromSchemaName);
    expect(result.panelSettings.panelSettingsA![messageConverter.fromSchemaName]).toEqual(
      panelSettingsA,
    );
    expect(result.panelSettings.panelSettingsB).toHaveProperty(messageConverter.fromSchemaName);
    expect(result.panelSettings.panelSettingsB![messageConverter.fromSchemaName]).toEqual(
      panelSettingsB,
    );
    delete (globalThis as any).messageConverter;
  });

  it("loads Foxglove-style modules: default export, async activate, external API require", async () => {
    const extensionSource = `
      require("@foxglove/extension");
      exports.default = {
        activate: async (ctx) => {
          await Promise.resolve();
          ctx.registerMessageConverter({ type: "schema", fromSchemaName: "a", toSchemaName: "b", converter: (m) => m });
        }
      };
    `;

    const result = await buildContributionPoints(ExtensionBuilder.extensionInfo(), extensionSource);

    expect(result.messageConverters).toEqual([
      expect.objectContaining({ fromSchemaName: "a", toSchemaName: "b" }),
    ]);
  });

  it("logs a rejected async activate and keeps earlier registrations", async () => {
    const logErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});
    const extensionSource = `
      module.exports = {
        activate: async (ctx) => {
          ctx.registerMessageConverter({ fromSchemaName: "a", toSchemaName: "b", converter: (m) => m });
          await Promise.resolve();
          throw new Error("boom");
        }
      };
    `;

    const result = await buildContributionPoints(ExtensionBuilder.extensionInfo(), extensionSource);

    expect(result.messageConverters).toHaveLength(1);
    expect(logErrorMock).toHaveBeenCalled();
    logErrorMock.mockRestore();
    expectNotified();
  });

  it("registers Foxglove data loaders", async () => {
    const extensionInfo = ExtensionBuilder.extensionInfo();
    const extensionSource = `
      module.exports = {
        activate: (ctx) => {
          ctx.registerDataLoader({ type: "file", wasmUrl: "data:application/wasm;base64,", supportedFileType: ".txt" });
        }
      };
    `;

    const result = await buildContributionPoints(extensionInfo, extensionSource);

    expect(result.dataLoaders).toEqual([
      {
        extensionId: extensionInfo.id,
        extensionName: extensionInfo.displayName,
        extensionNamespace: extensionInfo.namespace,
        args: {
          type: "file",
          wasmUrl: "data:application/wasm;base64,",
          supportedFileType: ".txt",
        },
      },
    ]);
  });

  it("registers topic aliases correctly", async () => {
    const extensionInfo = ExtensionBuilder.extensionInfo();
    const aliasFunction: TopicAliasFunction = vi.fn();

    (globalThis as any).topicAliasFunction = aliasFunction;
    const extensionSource = `
      module.exports = {
        activate: (ctx) => {
          ctx.registerTopicAliases(globalThis.topicAliasFunction);
        }
      };
    `;

    const result = await buildContributionPoints(extensionInfo, extensionSource);

    expect(result.topicAliasFunctions).toHaveLength(1);
    expect(result.topicAliasFunctions[0]!.extensionId).toBe(extensionInfo.id);
    expect(result.topicAliasFunctions[0]!.aliasFunction).toBe(aliasFunction);
    delete (globalThis as any).topicAliasFunction;
  });

  describe("errors during setup", () => {
    const setupErrorCases: [string, string][] = [
      [
        "activate throws after registering",
        `ctx.registerMessageConverter({ fromSchemaName: "a", toSchemaName: "b", converter: (m) => m });
         throw new Error("boom");`,
      ],
      ["a registration call throws", `ctx.registerPanel(undefined);`],
      [
        "a converter has no fromSchemaName",
        `ctx.registerMessageConverter({ toSchemaName: "b", converter: (m) => m });`,
      ],
      [
        "a converter has an empty toSchemaName",
        `ctx.registerMessageConverter({ fromSchemaName: "a", toSchemaName: "", converter: (m) => m });`,
      ],
      ["activate rejects", `await Promise.resolve(); throw new Error("boom");`],
    ];

    it.each(setupErrorCases)("reports to the user when %s", async (_name, body) => {
      const extensionInfo = ExtensionBuilder.extensionInfo();
      const extensionSource = `module.exports = { activate: async (ctx) => { ${body} } };`;

      await buildContributionPoints(extensionInfo, extensionSource);

      expect(sendNotification).toHaveBeenCalledWith(
        expect.stringContaining(extensionInfo.displayName),
        expect.any(Error),
        "user",
        "error",
      );
      expectNotified();
    });

    it("does not register a converter with invalid schema names", async () => {
      const extensionSource = `module.exports = { activate: (ctx) => {
        ctx.registerMessageConverter({ toSchemaName: "b", converter: (m) => m });
      } };`;

      const result = await buildContributionPoints(
        ExtensionBuilder.extensionInfo(),
        extensionSource,
      );

      expect(result.messageConverters).toEqual([]);
      expect(result.panelSettings).toEqual({});
      expectNotified();
    });
  });
});
