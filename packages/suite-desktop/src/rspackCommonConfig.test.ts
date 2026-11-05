// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RspackConfigParams } from "./RspackConfigParams";
import { createCommonWebpackConfig } from "./rspackCommonConfig";

function createTestParams(overrides: Partial<RspackConfigParams> = {}): RspackConfigParams {
  return {
    packageJson: {
      productName: "Test Product",
      name: "test-product",
      version: "1.0.0",
      description: "Test Description",
      productDescription: "Test Product Description",
      license: "MPL-2.0",
      author: { name: "Test Author", email: "test@example.com" },
      homepage: "https://example.com",
    },
    mainContext: "/test/main",
    mainEntrypoint: "./index.ts",
    rendererContext: "/test/renderer",
    rendererEntrypoint: "./index.tsx",
    quicklookContext: "/test/quicklook",
    quicklookEntrypoint: "./index.ts",
    preloadContext: "/test/preload",
    preloadEntrypoint: "./index.ts",
    outputPath: "/test/output",
    prodSourceMap: "source-map",
    ...overrides,
  };
}

vi.mock("@rspack/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@rspack/core")>();
  return {
    ...original,
    // the configs only use rspack.DefinePlugin
    rspack: {
      DefinePlugin: vi.fn().mockImplementation(function (defs) {
        return {
          pluginName: "DefinePlugin",
          definitions: defs,
        };
      }),
    },
  };
});

// --- mock other heavy plugins ---
vi.mock("ts-checker-rspack-plugin", () => ({
  TsCheckerRspackPlugin: vi.fn().mockImplementation(function () {
    return {
      pluginName: "TsCheckerRspackPlugin",
    };
  }),
}));

describe("createCommonWebpackConfig", () => {
  it("should configure development mode with source maps", () => {
    // Given
    const params = createTestParams();

    // When
    const config = createCommonWebpackConfig(params, { isDev: true });

    // Then
    expect(config.devtool).toBe("eval-cheap-module-source-map");
    expect(config.resolve?.extensions).toContain(".tsx");
    expect((config.module?.rules?.[0] as any).loader).toBe("builtin:swc-loader");
  });

  it("should configure production mode with source maps", () => {
    // Given
    const params = createTestParams();

    // When
    const config = createCommonWebpackConfig(params, { isDev: false });

    // Then
    expect(config.devtool).toBe("source-map");
  });

  it("should inject DefinePlugin with product metadata", () => {
    // Given
    const params = createTestParams();

    // When
    const config = createCommonWebpackConfig(params, { isDev: true });
    const plugins = config.plugins as any[];
    const definePlugin = plugins.find((p) => p.pluginName === "DefinePlugin");

    // Then
    expect(definePlugin).toBeDefined();
    const defs = definePlugin.definitions;

    expect(defs.LICHTBLICK_PRODUCT_NAME).toBe(JSON.stringify("Test Product"));
    expect(defs.LICHTBLICK_PRODUCT_VERSION).toBe(JSON.stringify("1.0.0"));
    expect(defs.LICHTBLICK_PRODUCT_HOMEPAGE).toBe(JSON.stringify("https://example.com"));
  });

  it("should include TsCheckerRspackPlugin", () => {
    // Given
    const params = createTestParams();

    // When
    const config = createCommonWebpackConfig(params, { isDev: true });
    const plugins = config.plugins as any[];

    // Then
    const hasTsChecker = plugins.some((p) => p.pluginName === "TsCheckerRspackPlugin");
    expect(hasTsChecker).toBe(true);
  });

  it("should propagate API_URL, DEV_WORKSPACE and OTLP_ENDPOINT from environment if set", () => {
    // Given
    process.env.API_URL = "https://api.example.com";
    (process.env as any).DEV_WORKSPACE = "workspace-1";
    process.env.OTLP_ENDPOINT = "http://localhost:4318";
    const params = createTestParams();

    // When
    const config = createCommonWebpackConfig(params, { isDev: true });
    const definePlugin = (config.plugins as any[]).find((p) => p.pluginName === "DefinePlugin");

    // Then
    expect(definePlugin.definitions.API_URL).toBe(JSON.stringify("https://api.example.com"));
    expect(definePlugin.definitions.DEV_WORKSPACE).toBe(JSON.stringify("workspace-1"));
    expect(definePlugin.definitions.OTLP_ENDPOINT).toBe(JSON.stringify("http://localhost:4318"));
  });

  it("should leave API_URL, DEV_WORKSPACE and OTLP_ENDPOINT undefined if not set", () => {
    // Given
    delete process.env.API_URL;
    delete (process.env as any).DEV_WORKSPACE;
    delete process.env.OTLP_ENDPOINT;
    const params = createTestParams();

    // When
    const config = createCommonWebpackConfig(params, { isDev: true });
    const definePlugin = (config.plugins as any[]).find((p) => p.pluginName === "DefinePlugin");

    // Then
    expect(definePlugin.definitions.API_URL).toBeUndefined();
    expect(definePlugin.definitions.DEV_WORKSPACE).toBeUndefined();
    expect(definePlugin.definitions.OTLP_ENDPOINT).toBeUndefined();
  });
});
