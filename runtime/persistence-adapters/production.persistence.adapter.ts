import { readdirSync, readFileSync, existsSync } from "fs";
import { join as pathJoin } from "path";
import { createHash } from "crypto";
/**
 * Production Persistence Adapters — Phase 8.1+8.2
 *
 * Pluggable adapter architecture for all persistence layers.
 * Default: in-memory (current) — swap to PostgreSQL via adapter injection.
 *
 * PostgreSQLPersistenceAdapter: connects to DB, sets RLS app.tenant_id per transaction.
 * This fixes P0 issue: SET LOCAL app.tenant_id not called per connection.
 *
 * Architecture:
 *   InMemoryAdapter  — default (current behavior, zero-config)
 *   PostgreSQLAdapter — production (connects to configured DATABASE_URL)
 *
 * All adapters implement PersistenceAdapter<T> interface.
 * All writes are tenant-scoped and idempotency-checked.
 * All reads SET LOCAL app.tenant_id for RLS enforcement.
 */
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

export interface PersistenceRecord {
  id:            string;
  tenantId:      string;
  entityType:    string;
  entityId:      string;
  version:       number;
  payload:       Record<string, unknown>;
  idempotencyKey?:string;
  hash:          string;
  previousHash:  string;
  createdAt:     string;
  updatedAt:     string;
}

export interface PersistenceQuery {
  tenantId:       string;
  entityType?:    string;
  entityId?:      string;
  fromTimestamp?: string;
  toTimestamp?:   string;
  limit?:         number;
  offset?:        number;
}

export interface WriteResult {
  id:           string;
  success:      boolean;
  isDuplicate:  boolean;
  record?:      PersistenceRecord;
  error?:       string;
}

export interface MigrationRecord {
  id:          string;
  version:     string;
  description: string;
  appliedAt:   string;
  checksum:    string;
}

// ── Adapter Interface ─────────────────────────────────────────
export interface PersistenceAdapter {
  write(record: Omit<PersistenceRecord, "id" | "hash" | "previousHash" | "createdAt" | "updatedAt">): Promise<WriteResult>;
  query(q: PersistenceQuery): Promise<PersistenceRecord[]>;
  getById(tenantId: string, entityType: string, entityId: string): Promise<PersistenceRecord | null>;
  getLatest(tenantId: string, entityType: string): Promise<PersistenceRecord | null>;
  validateChain(tenantId: string, entityType: string): Promise<{valid:boolean; brokenAt?:string; reason?:string}>;
  healthCheck(): Promise<{healthy:boolean; latencyMs?:number; error?:string}>;
  applyMigration(migration: Omit<MigrationRecord,"id"|"appliedAt"> & { sql?: string }): Promise<void>;
  getAppliedMigrations(): Promise<MigrationRecord[]>;
}

// ── In-Memory Adapter (current behavior, zero config) ─────────
export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  private readonly store   = new Map<string, PersistenceRecord[]>();  // tenantId:entityType → records
  private readonly dedupeW = new Map<string, string>();               // tenantId:key → id
  private readonly migrations: MigrationRecord[] = [];

  private key(tenantId: string, entityType: string): string {
    return `${tenantId}:${entityType}`;
  }

  async write(record: Omit<PersistenceRecord,"id"|"hash"|"previousHash"|"createdAt"|"updatedAt">): Promise<WriteResult> {
    // Idempotency check
    if (record.idempotencyKey) {
      const dedupeKey = `${record.tenantId}:${record.idempotencyKey}`;
      if (this.dedupeW.has(dedupeKey)) {
        const existingId = this.dedupeW.get(dedupeKey)!;
        const k   = this.key(record.tenantId, record.entityType);
        const existing = (this.store.get(k) ?? []).find(r => r.id === existingId);
        return { id:existingId, success:true, isDuplicate:true, record:existing };
      }
    }

    const k       = this.key(record.tenantId, record.entityType);
    const records = this.store.get(k) ?? [];
    const prev    = records.at(-1);
    const prevHash= prev?.hash ?? "GENESIS";
    const id      = uuidv4();
    const now     = new Date().toISOString();
    const hash    = crypto.createHash("sha256")
      .update(`${id}:${record.tenantId}:${record.entityType}:${record.entityId}:${JSON.stringify(record.payload)}:${prevHash}`)
      .digest("hex");

    const full: PersistenceRecord = { ...record, id, hash, previousHash:prevHash, createdAt:now, updatedAt:now };
    Object.freeze(full);
    records.push(full);
    this.store.set(k, records);

    if (record.idempotencyKey) {
      this.dedupeW.set(`${record.tenantId}:${record.idempotencyKey}`, id);
    }
    return { id, success:true, isDuplicate:false, record:full };
  }

  async query(q: PersistenceQuery): Promise<PersistenceRecord[]> {
    const k = this.key(q.tenantId, q.entityType ?? "");
    let records: PersistenceRecord[] = [];
    if (q.entityType) {
      records = this.store.get(k) ?? [];
    } else {
      // Scan all types for this tenant
      for (const [key, recs] of this.store) {
        if (key.startsWith(`${q.tenantId}:`)) records.push(...recs);
      }
    }
    let filtered = records.filter(r => r.tenantId === q.tenantId);
    if (q.entityId)      filtered = filtered.filter(r => r.entityId === q.entityId);
    if (q.fromTimestamp) filtered = filtered.filter(r => r.createdAt >= q.fromTimestamp!);
    if (q.toTimestamp)   filtered = filtered.filter(r => r.createdAt <= q.toTimestamp!);
    if (q.offset)        filtered = filtered.slice(q.offset);
    return filtered.slice(0, q.limit ?? 1000);
  }

  async getById(tenantId: string, entityType: string, entityId: string): Promise<PersistenceRecord | null> {
    const recs = this.store.get(this.key(tenantId, entityType)) ?? [];
    return recs.filter(r => r.entityId === entityId && r.tenantId === tenantId).at(-1) ?? null;
  }

  async getLatest(tenantId: string, entityType: string): Promise<PersistenceRecord | null> {
    return (this.store.get(this.key(tenantId, entityType)) ?? []).at(-1) ?? null;
  }

  async validateChain(tenantId: string, entityType: string): Promise<{valid:boolean; brokenAt?:string; reason?:string}> {
    const recs = this.store.get(this.key(tenantId, entityType)) ?? [];
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      const expectedHash = crypto.createHash("sha256")
        .update(`${r.id}:${r.tenantId}:${r.entityType}:${r.entityId}:${JSON.stringify(r.payload)}:${r.previousHash}`)
        .digest("hex");
      if (r.hash !== expectedHash) return { valid:false, brokenAt:r.id, reason:`Hash mismatch at record ${r.id}` };
      if (i > 0 && r.previousHash !== recs[i-1].hash) return { valid:false, brokenAt:r.id, reason:`Chain break: previousHash mismatch at record ${r.id}` };
    }
    return { valid:true };
  }

  async healthCheck(): Promise<{healthy:boolean; latencyMs?:number}> {
    const start = Date.now();
    return { healthy:true, latencyMs:Date.now()-start };
  }

  async applyMigration(migration: Omit<MigrationRecord,"id"|"appliedAt"> & { sql?: string }): Promise<void> {
    this.migrations.push({ ...migration, id:uuidv4(), appliedAt:new Date().toISOString() });
  }

  async getAppliedMigrations(): Promise<MigrationRecord[]> { return [...this.migrations]; }

  getStats(tenantId: string) {
    let total = 0;
    for (const [key, recs] of this.store) {
      if (key.startsWith(`${tenantId}:`)) total += recs.length;
    }
    return { tenantId, total };
  }
}

// ── PostgreSQL Adapter (production) ───────────────────────────
// This adapter sets `SET LOCAL app.tenant_id` per transaction — fixing P0 RLS issue.
// Requires DATABASE_URL. FAILS CLOSED: if the database is unavailable this
// adapter THROWS. There is no in-memory substitution — a write that silently
// lands in memory and vanishes on restart is a data-integrity failure.
// In-memory persistence is available ONLY via PERSISTENCE_MODE=memory.
export class PostgreSQLPersistenceAdapter implements PersistenceAdapter {
  private pool: unknown = null;
  private dbAvailable = false;

  constructor(private readonly databaseUrl: string) {
    this.init().catch(() => { this.dbAvailable = false; });
  }

  private async init(): Promise<void> {
    // Production: import and init pg Pool
    // Not imported by default to avoid crashing when pg not available
    try {
      const { Pool } = await import("pg").catch(() => ({ Pool: null }));
      if (!Pool) { this.dbAvailable = false; return; }
      const pool = new (Pool as any)({ connectionString:this.databaseUrl, max:10, idleTimeoutMillis:30000 });
      // An idle-client error (e.g. the server was stopped) must not become an
      // unhandled event that terminates the process. Mark the adapter
      // unavailable so every operation fails closed with DB_UNAVAILABLE, and
      // let readiness report 503 instead of the API vanishing.
      pool.on("error", (err: Error) => {
        this.dbAvailable = false;
        console.error("[Persistence] pool error — marking database unavailable:", err.message);
      });
      await pool.query("SELECT 1");
      this.pool = pool;
      this.dbAvailable = true;
    } catch {
      this.dbAvailable = false;
    }
  }

  private async withRLS<T>(tenantId: string, fn: (client: unknown) => Promise<T>): Promise<T> {
    if (!this.dbAvailable || !this.pool) throw new Error("DB unavailable");
    const pool = this.pool as any;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // P0 FIX: Set tenant context for Row Level Security
      RLSIsolationEngine.validateTenantContext(tenantId);
      // Parameterized — never string-interpolated into SQL.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Escape hatch for catalog verification during startup. Fails closed. */
  async rawQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
    this.assertDb("rawQuery");
    const { rows } = await (this.pool as any).query(sql, params);
    return rows;
  }

  /** Fail closed. No memory substitution, ever. */
  private assertDb(op: string): void {
    if (!this.dbAvailable) {
      throw Object.assign(
        new Error(`SGIP: PostgreSQL unavailable — '${op}' refused. In-memory substitution is not permitted.`),
        { code: "DB_UNAVAILABLE", statusCode: 503, operation: op });
    }
  }

  async write(record: Omit<PersistenceRecord,"id"|"hash"|"previousHash"|"createdAt"|"updatedAt">): Promise<WriteResult> {
    this.assertDb("write");
    // Production DB write with RLS
    return this.withRLS(record.tenantId, async (client: any) => {
      // Idempotency check
      if (record.idempotencyKey) {
        const existing = await client.query(
          `SELECT id, payload FROM governance_events WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
          [record.tenantId, record.idempotencyKey]
        );
        if (existing.rows.length > 0) return { id:existing.rows[0].id, success:true, isDuplicate:true };
      }
      const prev = await client.query(
        `SELECT hash FROM governance_events WHERE tenant_id = $1 AND entity_type = $2 ORDER BY created_at DESC LIMIT 1`,
        [record.tenantId, record.entityType]
      );
      const prevHash = prev.rows[0]?.hash ?? "GENESIS";
      const id   = uuidv4();
      const now  = new Date().toISOString();
      const hash = crypto.createHash("sha256").update(`${id}:${record.tenantId}:${record.entityType}:${record.entityId}:${JSON.stringify(record.payload)}:${prevHash}`).digest("hex");
      await client.query(
        // Schema contract (item 6): topic/actor_id/actor_role are NOT NULL in
        // the authoritative schema; updated_at does NOT exist on this table.
        `INSERT INTO governance_events
           (id,tenant_id,entity_type,entity_id,version,topic,payload,idempotency_key,
            actor_id,actor_role,hash,previous_hash,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, record.tenantId, record.entityType, record.entityId, record.version,
         (record as {topic?:string}).topic ?? record.entityType,
         JSON.stringify(record.payload), record.idempotencyKey ?? null,
         (record as {actorId?:string}).actorId ?? "system",
         (record as {actorRole?:string}).actorRole ?? "system",
         hash, prevHash, now]
      );
      return { id, success:true, isDuplicate:false };
    });
  }

  async query(q: PersistenceQuery): Promise<PersistenceRecord[]> {
    this.assertDb("query");
    return this.withRLS(q.tenantId, async (client: any) => {
      const { rows } = await client.query(
        `SELECT * FROM governance_events WHERE tenant_id = $1 ${q.entityType?"AND entity_type = $2":""} ORDER BY created_at ASC LIMIT $${q.entityType?3:2}`,
        q.entityType ? [q.tenantId, q.entityType, q.limit??1000] : [q.tenantId, q.limit??1000]
      );
      return rows;
    });
  }

  async getById(tenantId: string, entityType: string, entityId: string): Promise<PersistenceRecord | null> {
    this.assertDb("getById");
    return this.withRLS(tenantId, async (client:any) => {
      const { rows } = await client.query(`SELECT * FROM governance_events WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY created_at DESC LIMIT 1`, [tenantId, entityType, entityId]);
      return rows[0] ?? null;
    });
  }

  async getLatest(tenantId: string, entityType: string): Promise<PersistenceRecord | null> {
    this.assertDb("getLatest");
    return this.withRLS(tenantId, async (client:any) => {
      const { rows } = await client.query(`SELECT * FROM governance_events WHERE tenant_id=$1 AND entity_type=$2 ORDER BY created_at DESC LIMIT 1`, [tenantId, entityType]);
      return rows[0] ?? null;
    });
  }

  async validateChain(tenantId: string, entityType: string): Promise<{valid:boolean; brokenAt?:string; reason?:string}> {
    this.assertDb("validateChain");
    return this.withRLS(tenantId, async (client:any) => {
      const { rows } = await client.query(`SELECT * FROM governance_events WHERE tenant_id=$1 AND entity_type=$2 ORDER BY created_at ASC`, [tenantId, entityType]);
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].previous_hash !== rows[i-1].hash) return { valid:false, brokenAt:rows[i].id, reason:"Chain break detected" };
      }
      return { valid:true };
    });
  }

  async healthCheck(): Promise<{healthy:boolean; latencyMs?:number; error?:string}> {
    const start = Date.now();
    if (!this.dbAvailable) return { healthy:false, latencyMs:0, error:"Database unavailable — running in degraded mode" };
    try {
      await (this.pool as any).query("SELECT 1");
      return { healthy:true, latencyMs:Date.now()-start };
    } catch (err) {
      return { healthy:false, latencyMs:Date.now()-start, error:(err as Error).message };
    }
  }

  /**
   * Execute the migration SQL, then record it — in ONE transaction.
   * A migration is NEVER recorded as applied unless its SQL actually ran.
   */
  async applyMigration(m: Omit<MigrationRecord,"id"|"appliedAt"> & { sql?: string }): Promise<void> {
    this.assertDb("applyMigration");
    if (!m.sql || !m.sql.trim()) {
      throw Object.assign(new Error(`Migration ${m.version} has no SQL — refusing to record it as applied.`),
        { code: "MIGRATION_NO_SQL" });
    }
    const expected = MigrationEngine.checksumOf(m.sql);
    if (m.checksum && m.checksum !== expected) {
      throw Object.assign(new Error(`Migration ${m.version} checksum mismatch: expected ${expected}, got ${m.checksum}`),
        { code: "MIGRATION_CHECKSUM_MISMATCH" });
    }
    const client = await (this.pool as any).connect();
    try {
      await client.query("BEGIN");
      await client.query(m.sql);                       // <- actually run it
      await client.query(
        `INSERT INTO schema_migrations(id,version,description,applied_at,checksum) VALUES($1,$2,$3,$4,$5)`,
        [uuidv4(), m.version, m.description, new Date().toISOString(), expected]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    this.assertDb("getAppliedMigrations");
    const { rows } = await (this.pool as any).query("SELECT * FROM schema_migrations ORDER BY applied_at ASC");
    return rows;
  }
}

// ── RLS Context Manager ───────────────────────────────────────
/**
 * RLS Isolation Engine — Phase 8.2
 * Validates and enforces tenant context in every database operation.
 * Prevents cross-tenant data leakage at the query level.
 */
export class RLSIsolationEngine {
  static validateTenantContext(tenantId: string): void {
    if (!tenantId || tenantId.trim() === "" || tenantId === "undefined" || tenantId === "null") {
      throw Object.assign(new Error("RLS violation: invalid or empty tenantId"), { code:"RLS_CONTEXT_MISSING", statusCode:403 });
    }
    // Prevent tenant injection attacks
    if (/[';\"]/.test(tenantId)) {
      throw Object.assign(new Error("RLS violation: tenantId contains invalid characters"), { code:"RLS_INJECTION_ATTEMPT", statusCode:403 });
    }
  }

  static buildRLSFilter(tenantId: string): string {
    this.validateTenantContext(tenantId);
    return `tenant_id = '${tenantId}'`;
  }

  static async verifyIsolation(adapter: PersistenceAdapter, tenantA: string, tenantB: string): Promise<{isolated:boolean; leakages:string[]}> {
    const aData = await adapter.query({ tenantId:tenantA, limit:100 });
    const bData = await adapter.query({ tenantId:tenantB, limit:100 });
    const leakages: string[] = [];
    // Check if any A data appears in B results
    const aIds = new Set(aData.map(r => r.id));
    for (const bRecord of bData) {
      if (aIds.has(bRecord.id)) leakages.push(`Cross-tenant leakage: record ${bRecord.id} visible to tenant ${tenantB}`);
    }
    return { isolated:leakages.length===0, leakages };
  }
}

// ── Migration Engine ──────────────────────────────────────────
/**
 * AUTHORITATIVE MIGRATION SOURCE (item 5).
 *
 * Three competing schema sources existed:
 *   1. db/migrations/*.sql              <- AUTHORITATIVE
 *   2. infra/postgres/init.sql          <- RETIRED (covered 2 of 12 tables)
 *   3. prisma/migrations/*.sql          <- LEGACY_READ_ONLY
 *
 * Resolution: db/migrations/*.sql is the single authoritative source for the
 * runtime persistence schema. MigrationEngine no longer CREATES schema;
 * it verifies that the authoritative schema is present and records lineage.
 * Any DDL it still carries must match init.sql exactly, and its checksums are
 * computed FROM THE SQL — never from a label.
 */
export const AUTHORITATIVE_SCHEMA_SOURCE = "db/migrations" as const;

export class MigrationEngine {
  /**
   * Migrations are LOADED from the authoritative path (db/migrations/*.sql).
   * Runtime application code carries NO DDL of its own — that was a second,
   * competing schema source.
   */
  private _migrations: Array<{version:string; description:string; checksum:string; sql:string}> | null = null;

  private get MIGRATIONS(): Array<{version:string; description:string; checksum:string; sql:string}> {
    if (this._migrations) return this._migrations;
    const dir = process.env.SGIP_MIGRATIONS_DIR
      ?? [pathJoin(__dirname, "..", "..", "db", "migrations"),
          pathJoin(__dirname, "..", "..", "..", "db", "migrations"),
          pathJoin(process.cwd(), "db", "migrations")].find(d => existsSync(d))
       ?? pathJoin(process.cwd(), "db", "migrations");
    if (!existsSync(dir)) {
      throw Object.assign(new Error(`SGIP: authoritative migration directory not found: ${dir}`),
        { code: "MIGRATION_SOURCE_MISSING" });
    }
    this._migrations = readdirSync(dir).filter(f => f.endsWith(".sql")).sort().map(f => {
      const sql = readFileSync(pathJoin(dir, f), "utf8");
      const version = f.split("_")[0];
      return { version, description: f.replace(/\.sql$/, ""),
               checksum: MigrationEngine.checksumOf(sql), sql };
    });
    return this._migrations;
  }

  constructor(private readonly adapter: PersistenceAdapter) {}

  async getAppliedVersions(): Promise<Set<string>> {
    const applied = await this.adapter.getAppliedMigrations();
    return new Set(applied.map(m => m.version));
  }

  async runPending(): Promise<{applied:string[]; skipped:string[]}> {
    this.normaliseChecksums();
    const applied   = await this.getAppliedVersions();
    const toApply:  string[] = [];
    const skipped:  string[] = [];
    for (const m of this.MIGRATIONS) {
      if (applied.has(m.version)) { skipped.push(m.version); continue; }
      // sql is mandatory — applyMigration refuses to record without executing.
      await this.adapter.applyMigration({ version:m.version, description:m.description, checksum:m.checksum, sql:m.sql });
      toApply.push(m.version);
    }
    return { applied:toApply, skipped };
  }

  /** Checksums are derived from the normalized SQL itself. */
  private static normalise(sql: string): string {
    return sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  }
  static checksumOf(sql: string): string {
    return crypto.createHash("sha256").update(MigrationEngine.normalise(sql)).digest("hex").slice(0, 16);
  }
  /** Fill in every declared checksum from its own SQL. Idempotent. */
  private normaliseChecksums(): void {
    for (const m of this.MIGRATIONS) {
      const c = MigrationEngine.checksumOf(m.sql);
      if (!m.checksum) (m as {checksum:string}).checksum = c;
      else if (m.checksum !== c) {
        throw Object.assign(new Error(
          `Migration ${m.version} checksum mismatch: declared ${m.checksum}, SQL yields ${c}`),
          { code: "MIGRATION_CHECKSUM_MISMATCH" });
      }
    }
  }

  getMigrations() { this.normaliseChecksums(); return this.MIGRATIONS.map(m => ({ version:m.version, description:m.description, checksum:m.checksum })); }
}

// ── Adapter Registry ──────────────────────────────────────────
const adapterCache = new Map<string, PersistenceAdapter>();
const defaultAdapter = new InMemoryPersistenceAdapter();

export function getPersistenceAdapter(config?: {type:"memory"|"postgresql"; url?:string}): PersistenceAdapter {
  const key = config?.type ?? "memory";
  if (!adapterCache.has(key)) {
    if (config?.type === "postgresql" && config.url) {
      adapterCache.set(key, new PostgreSQLPersistenceAdapter(config.url));
    } else {
      adapterCache.set(key, defaultAdapter);
    }
  }
  return adapterCache.get(key)!;
}

// Auto-configure from environment
const DB_URL = process.env.DATABASE_URL;
const IS_PROD = process.env.NODE_ENV === "production";
const PERSISTENCE_MODE = process.env.PERSISTENCE_MODE ?? "postgres";
if (IS_PROD && PERSISTENCE_MODE !== "postgres") {
  throw new Error(`SGIP: PERSISTENCE_MODE='${PERSISTENCE_MODE}' is not permitted in production.`);
}
if (IS_PROD && !DB_URL) {
  throw new Error("SGIP: DATABASE_URL is required in production. In-memory persistence is not permitted.");
}
export const productionAdapter: PersistenceAdapter = DB_URL
  ? new PostgreSQLPersistenceAdapter(DB_URL)
  : defaultAdapter;
