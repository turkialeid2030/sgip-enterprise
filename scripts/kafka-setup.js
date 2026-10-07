#!/usr/bin/env node
/**
 * SGIP Kafka Topics Setup Script
 * Run once after Kafka broker is ready.
 * Usage: node scripts/kafka-setup.js
 *
 * Topics created:
 *   governance.events   — main event stream (12 partitions, 3 replicas)
 *   governance.dlq      — dead letter queue for failed events
 *   governance.alerts   — real-time governance alerts
 *   governance.audit    — immutable audit trail stream
 */

const { Kafka } = require("kafkajs");

const TOPICS = [
  {
    topic: "governance.events",
    numPartitions: 12,
    replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || "1"),
    configEntries: [
      { name: "retention.ms",        value: "604800000" },  // 7 days
      { name: "min.insync.replicas", value: process.env.KAFKA_REPLICATION_FACTOR === "3" ? "2" : "1" },
      { name: "compression.type",    value: "lz4" },
      { name: "cleanup.policy",      value: "delete" },
    ],
  },
  {
    topic: "governance.dlq",
    numPartitions: 3,
    replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || "1"),
    configEntries: [
      { name: "retention.ms",    value: "2592000000" },  // 30 days
      { name: "compression.type",value: "lz4" },
    ],
  },
  {
    topic: "governance.alerts",
    numPartitions: 6,
    replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || "1"),
    configEntries: [
      { name: "retention.ms",    value: "86400000" },    // 1 day
      { name: "compression.type",value: "lz4" },
    ],
  },
  {
    topic: "governance.audit",
    numPartitions: 6,
    replicationFactor: parseInt(process.env.KAFKA_REPLICATION_FACTOR || "1"),
    configEntries: [
      { name: "retention.ms",    value: "-1" },          // Infinite retention for audit
      { name: "compression.type","value": "lz4" },
      { name: "cleanup.policy",  value: "compact,delete" },
    ],
  },
];

async function main() {
  const brokers = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");
  console.log(`[Kafka Setup] Connecting to brokers: ${brokers.join(", ")}`);

  const kafka = new Kafka({
    clientId: "sgip-setup",
    brokers,
    connectionTimeout: 10000,
    retry: { initialRetryTime: 1000, retries: 5 },
  });

  const admin = kafka.admin();
  await admin.connect();
  console.log("[Kafka Setup] Connected ✅");

  // Get existing topics
  const existing = await admin.listTopics();
  console.log(`[Kafka Setup] Existing topics: ${existing.join(", ") || "(none)"}`);

  const toCreate = TOPICS.filter(t => !existing.includes(t.topic));
  if (toCreate.length === 0) {
    console.log("[Kafka Setup] All topics already exist ✅");
    await admin.disconnect();
    return;
  }

  await admin.createTopics({
    waitForLeaders: true,
    topics: toCreate,
  });

  console.log("[Kafka Setup] Topics created:");
  for (const t of toCreate) {
    console.log(`  ✅ ${t.topic} (${t.numPartitions} partitions, RF=${t.replicationFactor})`);
  }

  await admin.disconnect();
  console.log("[Kafka Setup] Complete ✅");
}

main().catch(err => {
  console.error("[Kafka Setup] Failed:", err.message);
  process.exit(1);
});
