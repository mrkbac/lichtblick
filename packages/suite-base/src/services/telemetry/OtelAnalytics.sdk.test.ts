// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Runs OtelAnalytics against the real OpenTelemetry SDK; only the OTLP exporters are swapped for
// in-memory ones, so no network is involved. Catches SDK API breaks that the mocked unit test can't.

import type { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import { AppEvent } from "../IAnalytics";
import OtelAnalytics from "./OtelAnalytics";

const { logExporter, spanExporter, exporterUrls } = vi.hoisted(() => ({
  logExporter: { current: undefined as InMemoryLogRecordExporter | undefined },
  spanExporter: { current: undefined as InMemorySpanExporter | undefined },
  exporterUrls: [] as string[],
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", async () => {
  const { InMemoryLogRecordExporter: Exporter } = await import("@opentelemetry/sdk-logs");
  return {
    OTLPLogExporter: function FakeOTLPLogExporter({ url }: { url: string }) {
      exporterUrls.push(url);
      logExporter.current = new Exporter();
      return logExporter.current;
    },
  };
});

vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const { InMemorySpanExporter: Exporter } = await import("@opentelemetry/sdk-trace");
  return {
    OTLPTraceExporter: function FakeOTLPTraceExporter({ url }: { url: string }) {
      exporterUrls.push(url);
      spanExporter.current = new Exporter();
      return spanExporter.current;
    },
  };
});

describe("OtelAnalytics with the real OpenTelemetry SDK", () => {
  it("exports a log record and a span per event with the service resource", async () => {
    const analytics = new OtelAnalytics({
      endpoint: "http://localhost:4318",
      version: "1.2.3",
      platform: "web",
    });

    analytics.logEvent(AppEvent.APP_INIT, { source: "test" });
    await analytics.flush();

    expect(exporterUrls).toEqual([
      "http://localhost:4318/v1/logs",
      "http://localhost:4318/v1/traces",
    ]);

    const records = logExporter.current!.getFinishedLogRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.body).toBe(AppEvent.APP_INIT);
    expect(records[0]!.attributes).toMatchObject({ source: "test" });
    expect(records[0]!.resource.attributes).toMatchObject({
      [ATTR_SERVICE_NAME]: "lichtblick",
      [ATTR_SERVICE_VERSION]: "1.2.3",
      platform: "web",
    });

    const spans = spanExporter.current!.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe(AppEvent.APP_INIT);
    expect(spans[0]!.attributes).toMatchObject({ source: "test" });
    expect(spans[0]!.resource.attributes).toMatchObject({
      [ATTR_SERVICE_NAME]: "lichtblick",
    });

    await expect(analytics.shutdown()).resolves.toBeUndefined();
  });
});
