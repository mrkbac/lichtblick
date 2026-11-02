// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import { AppEvent } from "../IAnalytics";
import type RateLimiter from "./rateLimiter";

const mockSeverityNumber = { INFO: "INFO" } as const;
const mockGetDeviceId = vi.fn(() => "device-id");
const mockSessionId = "session-id";
const mockEmit = vi.fn();
const mockSpanEnd = vi.fn();
const mockStartSpan = vi.fn(() => ({ end: mockSpanEnd }));
const mockGetLogger = vi.fn(() => ({ emit: mockEmit }));
const mockGetTracer = vi.fn(() => ({ startSpan: mockStartSpan }));
const mockForceFlush = vi.fn().mockResolvedValue(undefined);
const mockShutdown = vi.fn().mockResolvedValue(undefined);
const mockTracerForceFlush = vi.fn().mockResolvedValue(undefined);
const mockTracerShutdown = vi.fn().mockResolvedValue(undefined);
const mockLoggerProvider = vi.fn().mockImplementation(() => ({
  getLogger: mockGetLogger,
  forceFlush: mockForceFlush,
  shutdown: mockShutdown,
}));
const mockTracerProvider = vi.fn().mockImplementation(() => ({
  getTracer: mockGetTracer,
  forceFlush: mockTracerForceFlush,
  shutdown: mockTracerShutdown,
}));
const mockBatchLogRecordProcessor = vi.fn().mockImplementation((options) => options);
const mockBatchSpanProcessor = vi.fn().mockImplementation((exporter) => ({ exporter }));
const mockOTLPLogExporter = vi.fn().mockImplementation((options) => ({ options }));
const mockOTLPTraceExporter = vi.fn().mockImplementation((options) => ({ options }));
const mockResourceFromAttributes = vi.fn().mockImplementation((attributes) => ({ attributes }));
const mockSetLogger = vi.fn();
const mockDiagConsoleLogger = vi.fn().mockImplementation(() => ({ name: "diag-logger" }));
const mockSetGlobalLoggerProvider = vi.fn().mockImplementation((provider) => provider);
const mockSetGlobalTracerProvider = vi.fn().mockImplementation((provider) => provider);
const mockDiagWarn = vi.fn();

vi.mock("./identity", () => ({
  __esModule: true,
  getDeviceId: mockGetDeviceId,
  sessionId: mockSessionId,
}));

vi.mock("@opentelemetry/api", () => ({
  diag: {
    setLogger: (...args: unknown[]) => mockSetLogger(...args),
    warn: (...args: unknown[]) => mockDiagWarn(...args),
  },
  trace: {
    setGlobalTracerProvider: (...args: unknown[]) => mockSetGlobalTracerProvider(...args),
  },
  DiagConsoleLogger: function MockDiagConsoleLogger() {
    return mockDiagConsoleLogger();
  },
  DiagLogLevel: {
    WARN: "WARN",
  },
}));

vi.mock("@opentelemetry/api-logs", () => ({
  SeverityNumber: mockSeverityNumber,
  logs: {
    setGlobalLoggerProvider: (...args: unknown[]) => mockSetGlobalLoggerProvider(...args),
  },
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (...args: unknown[]) => mockResourceFromAttributes(...args),
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: function MockOTLPLogExporter(options: unknown) {
    return mockOTLPLogExporter(options);
  },
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: function MockOTLPTraceExporter(options: unknown) {
    return mockOTLPTraceExporter(options);
  },
}));

vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: function MockBatchLogRecordProcessor(options: unknown) {
    return mockBatchLogRecordProcessor(options);
  },
  LoggerProvider: function MockLoggerProvider(options: unknown) {
    return mockLoggerProvider(options);
  },
}));

vi.mock("@opentelemetry/sdk-trace-web", () => ({
  BatchSpanProcessor: function MockBatchSpanProcessor(exporter: unknown) {
    return mockBatchSpanProcessor(exporter);
  },
  WebTracerProvider: function MockWebTracerProvider(options: unknown) {
    return mockTracerProvider(options);
  },
}));

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("OtelAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("configures a logger provider with the expected resource attributes", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");

    // When
    new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "desktop",
    });

    // Then
    const loggerProviderOptions = mockLoggerProvider.mock.calls[0]?.[0] as {
      processors: unknown[];
      resource: unknown;
    };
    const tracerProviderOptions = mockTracerProvider.mock.calls[0]?.[0] as {
      resource: unknown;
      spanProcessors: unknown[];
    };

    expect(mockResourceFromAttributes).toHaveBeenCalledWith({
      [ATTR_SERVICE_NAME]: "lichtblick",
      [ATTR_SERVICE_VERSION]: "1.2.3",
      platform: "desktop",
    });
    expect(mockOTLPLogExporter).toHaveBeenCalledWith({
      url: "http://collector:4318/v1/logs",
    });
    expect(mockBatchLogRecordProcessor).toHaveBeenCalledWith({
      exporter: { options: { url: "http://collector:4318/v1/logs" } },
    });
    expect(mockLoggerProvider).toHaveBeenCalledWith({
      resource: { attributes: expect.any(Object) },
      processors: [{ exporter: { options: { url: "http://collector:4318/v1/logs" } } }],
    });
    expect(mockOTLPTraceExporter).toHaveBeenCalledWith({
      url: "http://collector:4318/v1/traces",
    });
    expect(mockBatchSpanProcessor).toHaveBeenCalledWith({
      options: { url: "http://collector:4318/v1/traces" },
    });
    expect(mockTracerProvider).toHaveBeenCalledWith({
      resource: { attributes: expect.any(Object) },
      spanProcessors: [{ exporter: { options: { url: "http://collector:4318/v1/traces" } } }],
    });
    expect(tracerProviderOptions.resource).toBe(loggerProviderOptions.resource);
    expect(mockDiagConsoleLogger).toHaveBeenCalledTimes(1);
    expect(mockSetLogger).toHaveBeenCalledWith({ name: "diag-logger" }, "WARN");
    expect(mockSetGlobalLoggerProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        forceFlush: mockForceFlush,
        getLogger: mockGetLogger,
        shutdown: mockShutdown,
      }),
    );
    expect(mockSetGlobalTracerProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        forceFlush: mockTracerForceFlush,
        getTracer: mockGetTracer,
        shutdown: mockTracerShutdown,
      }),
    );
    expect(mockGetLogger).toHaveBeenCalledWith("lichtblick");
    expect(mockGetTracer).toHaveBeenCalledWith("lichtblick");
  });

  it("emits one OpenTelemetry log record for each app event when rate limiting allows it", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");
    const allow = vi.fn(() => true);
    const rateLimiter = {
      allow,
    } as unknown as RateLimiter;
    const analytics = new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "web",
      rateLimiter,
    });

    // When
    analytics.logEvent(AppEvent.APP_INIT, { source: "test", count: 2 });

    // Then
    expect(allow).toHaveBeenCalledWith(AppEvent.APP_INIT);
    expect(mockGetDeviceId).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith({
      body: AppEvent.APP_INIT,
      severityNumber: mockSeverityNumber.INFO,
      attributes: {
        source: "test",
        count: 2,
        device_id: "device-id",
        session_id: mockSessionId,
      },
    });
    expect(mockStartSpan).toHaveBeenCalledTimes(1);
    expect(mockStartSpan).toHaveBeenCalledWith(AppEvent.APP_INIT, {
      attributes: {
        source: "test",
        count: 2,
        device_id: "device-id",
        session_id: mockSessionId,
      },
    });
    expect(mockSpanEnd).toHaveBeenCalledTimes(1);
  });

  it("drops attributes with mixed-type arrays instead of forwarding them", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");
    const allow = vi.fn(() => true);
    const rateLimiter = {
      allow,
    } as unknown as RateLimiter;
    const analytics = new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "web",
      rateLimiter,
    });

    // When
    analytics.logEvent(AppEvent.APP_INIT, { source: "test", mixed: [1, "a"] });

    // Then
    expect(mockEmit).toHaveBeenCalledWith({
      body: AppEvent.APP_INIT,
      severityNumber: mockSeverityNumber.INFO,
      attributes: {
        source: "test",
        device_id: "device-id",
        session_id: mockSessionId,
      },
    });
    expect(mockDiagWarn).toHaveBeenCalledWith(
      expect.stringContaining('dropping unsupported attribute "mixed"'),
    );
  });

  it("drops events silently when rate limiting blocks them", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");
    const allow = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const rateLimiter = {
      allow,
    } as unknown as RateLimiter;
    const analytics = new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "web",
      rateLimiter,
    });

    // When
    analytics.logEvent(AppEvent.APP_INIT, { source: "blocked" });
    analytics.logEvent(AppEvent.APP_INIT, { source: "allowed" });

    // Then
    expect(allow).toHaveBeenNthCalledWith(1, AppEvent.APP_INIT);
    expect(allow).toHaveBeenNthCalledWith(2, AppEvent.APP_INIT);
    expect(mockGetDeviceId).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith({
      body: AppEvent.APP_INIT,
      severityNumber: mockSeverityNumber.INFO,
      attributes: {
        source: "allowed",
        device_id: "device-id",
        session_id: mockSessionId,
      },
    });
    expect(mockStartSpan).toHaveBeenCalledTimes(1);
    expect(mockStartSpan).toHaveBeenCalledWith(AppEvent.APP_INIT, {
      attributes: {
        source: "allowed",
        device_id: "device-id",
        session_id: mockSessionId,
      },
    });
    expect(mockSpanEnd).toHaveBeenCalledTimes(1);
  });

  it("flush resolves when both providers flush successfully", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");
    const analytics = new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "desktop",
    });

    // When
    await expect(analytics.flush()).resolves.toBeUndefined();

    // Then
    expect(mockForceFlush).toHaveBeenCalledTimes(1);
    expect(mockTracerForceFlush).toHaveBeenCalledTimes(1);
  });

  it("flush waits for both providers to settle before rejecting", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");
    const loggerFlush = deferredPromise<void>();
    const tracerError = new Error("trace flush failed");
    mockForceFlush.mockReturnValueOnce(loggerFlush.promise);
    mockTracerForceFlush.mockRejectedValueOnce(tracerError);

    const analytics = new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "desktop",
    });

    // When
    const flushPromise = analytics.flush();
    const onSettled = vi.fn();
    void flushPromise.then(
      () => {
        onSettled("resolved");
      },
      (error: unknown) => {
        onSettled(error);
      },
    );

    await Promise.resolve();

    // Then
    expect(mockForceFlush).toHaveBeenCalledTimes(1);
    expect(mockTracerForceFlush).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();

    loggerFlush.resolve();

    const flushError = await flushPromise.catch((error: unknown) => error);
    expect(flushError).toBeInstanceOf(AggregateError);
    expect(flushError).toMatchObject({
      message: "OtelAnalytics.flush() failed for one or more providers",
      errors: [tracerError],
    });
  });

  it("shutdown resolves when both providers shut down successfully", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");
    const analytics = new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "desktop",
    });

    // When
    await expect(analytics.shutdown()).resolves.toBeUndefined();

    // Then
    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockTracerShutdown).toHaveBeenCalledTimes(1);
  });

  it("shutdown waits for both providers to settle before rejecting", async () => {
    // Given
    const { default: OtelAnalytics } = await import("./OtelAnalytics");
    const loggerShutdown = deferredPromise<void>();
    const tracerError = new Error("trace shutdown failed");
    mockShutdown.mockReturnValueOnce(loggerShutdown.promise);
    mockTracerShutdown.mockRejectedValueOnce(tracerError);

    const analytics = new OtelAnalytics({
      endpoint: "http://collector:4318",
      version: "1.2.3",
      platform: "desktop",
    });

    // When
    const shutdownPromise = analytics.shutdown();
    const onSettled = vi.fn();
    void shutdownPromise.then(
      () => {
        onSettled("resolved");
      },
      (error: unknown) => {
        onSettled(error);
      },
    );

    await Promise.resolve();

    // Then
    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockTracerShutdown).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();

    loggerShutdown.resolve();

    const shutdownError = await shutdownPromise.catch((error: unknown) => error);
    expect(shutdownError).toBeInstanceOf(AggregateError);
    expect(shutdownError).toMatchObject({
      message: "OtelAnalytics.shutdown() failed for one or more providers",
      errors: [tracerError],
    });
  });
});
