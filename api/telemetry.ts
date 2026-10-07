/**
 * SGIP OpenTelemetry — Graceful activation
 * Full tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * No-op when not configured.
 */

const ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const SERVICE  = process.env.OTEL_SERVICE_NAME ?? "sgip-governance-api";

if (ENDPOINT) {
  // Dynamic import avoids startup failure when packages unavailable
  void (async () => {
    try {
      const [{ NodeSDK }, { OTLPTraceExporter }, { getNodeAutoInstrumentations }] = await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/exporter-trace-otlp-grpc"),
        import("@opentelemetry/auto-instrumentations-node"),
      ]);
      const sdk = new NodeSDK({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
traceExporter: new OTLPTraceExporter({ url: `${ENDPOINT}/opentelemetry.proto.collector.trace.v1.TraceService/Export` }) as any,
        instrumentations: [getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-dns": { enabled: false },
          "@opentelemetry/instrumentation-net": { enabled: false },
        })],
      });
      sdk.start();
      console.log(`[OTel] Tracing active → ${ENDPOINT} (${SERVICE})`);
      process.on("SIGTERM", async () => { await sdk.shutdown().catch(() => {}); });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[OTel] Startup failed (non-fatal): ${msg}`);
    }
  })();
} else {
  console.log("[OTel] Disabled — set OTEL_EXPORTER_OTLP_ENDPOINT to enable tracing");
}

export {};
