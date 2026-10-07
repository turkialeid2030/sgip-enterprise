/**
 * Kafka Event Publisher
 * Publishes governance events to Kafka when KAFKA_BROKERS is set.
 * Falls back silently to in-process-only when Kafka is unavailable.
 */
interface GovernanceEvent { id:string; tenantId:string; entityType:string; entityId:string; topic:string; payload:Record<string,unknown>; [k:string]:unknown; }

interface KafkaProducer {
  send(params: { topic: string; messages: Array<{ key: string; value: string }> }): Promise<void>;
  disconnect(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let producer: any = null;
let kafkaAvailable = false;

export async function initKafkaPublisher(): Promise<void> {
  const brokers = process.env.KAFKA_BROKERS?.split(",").filter(Boolean);
  if (!brokers?.length) {
    console.log("[Kafka] No KAFKA_BROKERS set — event streaming disabled");
    return;
  }
  try {
    // Dynamic import — only needed when Kafka is configured
    const { Kafka } = await import("kafkajs");
    const kafka = new Kafka({
      clientId: process.env.KAFKA_CLIENT_ID ?? "sgip-governance-api",
      brokers,
      connectionTimeout: 5000,
      retry: { initialRetryTime: 500, retries: 3 },
    });
    const p = kafka.producer({ allowAutoTopicCreation: false });
    await p.connect();
    producer = p as unknown as KafkaProducer;
    kafkaAvailable = true;
    console.log(`[Kafka] Producer connected to ${brokers.join(", ")} ✅`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Kafka] Producer init failed — running without Kafka: ${msg}`);
    kafkaAvailable = false;
  }
}

export async function publishGovernanceEvent(event: GovernanceEvent): Promise<void> {
  if (!kafkaAvailable || !producer) return;
  try {
    await producer.send({
      topic: "governance.events",
      messages: [{
        key:   `${event.tenantId}:${event.entityType}:${event.entityId}`,
        value: JSON.stringify({
          ...event,
          _published: new Date().toISOString(),
          _source:    "sgip-governance-api",
        }),
      }],
    });
  } catch (err: unknown) {
    // Non-fatal — event is already in the local store
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Kafka] Publish failed (non-fatal): ${msg}`);
  }
}

export async function publishGovernanceAlert(tenantId: string, alert: {type:string; message:string; severity:string}): Promise<void> {
  if (!kafkaAvailable || !producer) return;
  try {
    await producer.send({
      topic: "governance.alerts",
      messages: [{ key: tenantId, value: JSON.stringify({ tenantId, ...alert, ts: new Date().toISOString() }) }],
    });
  } catch { /* non-fatal */ }
}

export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect().catch(() => {});
    producer = null;
    kafkaAvailable = false;
  }
}

export function isKafkaAvailable(): boolean { return kafkaAvailable; }
