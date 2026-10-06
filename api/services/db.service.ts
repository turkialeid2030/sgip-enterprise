import { AsyncLocalStorage } from "async_hooks";
/**
 * Database Service — single pg-based DAO layer.
 * This is the ONLY file that talks to PostgreSQL.
 * No PrismaClient anywhere. No mixing.
 *
 * All other modules import `db` from this file.
 */
import { Pool, PoolClient, QueryResult } from "pg";

// ── Pool singleton ────────────────────────────────────────────
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString:    process.env.DATABASE_URL
        ?? (() => {
          if (process.env.NODE_ENV === "production") {
            // Item 7: no admin fallback, no default credentials.
            throw new Error("SGIP: DATABASE_URL is required in production — startup aborted.");
          }
          // Local development only. Never an owner/admin account.
          return "postgresql://sgip_app:dev_only@localhost:5432/sgip_dev";
        })(),
      max:                 20,
      idleTimeoutMillis:   30_000,
      connectionTimeoutMillis: 5_000,
    });
    _pool.on("error", (err) => {
      // Named error — never silent
      console.error("[DB] Unexpected pool error:", err.message);
    });
  }
  return _pool;
}

// ── Tenant database contract (P0) ─────────────────────────────
/**
 * Every query against a tenant-scoped table MUST carry a database-level tenant
 * context. RLS is FORCED on those tables, so a query without app.tenant_id sees
 * (and writes) nothing — a raw pool.query() is therefore both a security gap
 * and a functional break.
 *
 * The context is TRANSACTION-LOCAL (set_config(..., true)) so a pooled
 * connection can never carry a previous tenant's context into the next request.
 */
export class TenantContextError extends Error {
  code = "TENANT_CONTEXT_REQUIRED";
  statusCode = 403;
}

function assertTenantId(tenantId: string): void {
  if (!tenantId || !tenantId.trim() || tenantId === "undefined" || tenantId === "null") {
    throw new TenantContextError("A tenant context is required for this operation.");
  }
  if (/['";\\]/.test(tenantId)) {
    throw new TenantContextError("Tenant id contains invalid characters.");
  }
}

/**
 * Run `fn` inside a transaction with the tenant context bound to the connection.
 * This is the ONLY sanctioned path for tenant-scoped data.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: {
    query:    <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
    queryOne: <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R | null>;
  }) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // transaction-local: released with the transaction, never leaks via the pool
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const tx = {
      query: async <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> => {
        const r = await client.query<R>(sql, params); return r.rows;
      },
      queryOne: async <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R | null> => {
        const r = await client.query<R>(sql, params); return r.rows[0] ?? null;
      },
    };
    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Request-scoped tenancy (P0) ───────────────────────────────
/**
 * Every DAO calls query()/queryOne(). Rewriting each call site would leave the
 * next new DAO unguarded, so the guard lives in the contract itself:
 *
 *   1. middleware binds the tenant from the JWT into an AsyncLocalStorage scope
 *   2. query() detects whether the SQL touches a tenant-scoped table
 *   3. if it does, the query is executed inside a transaction with
 *      transaction-local app.tenant_id
 *   4. if it does and no tenant scope is bound, the query is REFUSED
 *
 * This makes "forgot to set the tenant context" a hard failure rather than a
 * silent cross-tenant read.
 */
export const TENANT_SCOPED_TABLES = new Set<string>([
  "User", "Tenant", "TenantConfig", "TenantViolation",
  "GovernanceEntity", "GraphEdge", "AgentOutput", "AuditLog", "MemoryEntry",
  "GovernancePolicy", "PolicyEvaluation", "ApprovalRequest", "SoDViolation",
  "GovernanceDecision", "FrameworkAssessment", "MaturityScore", "RACIEntry",
  "CultureSignal", "ImmutableDecision", "EvidenceRecord", "Attestation",
  "governance_events", "governance_snapshots", "evidence_records", "audit_trail",
]);

const tenantScope = new AsyncLocalStorage<{ tenantId: string }>();

/** Bind a tenant for the duration of `fn` (used by request middleware). */
export function runInTenantScope<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  assertTenantId(tenantId);
  return tenantScope.run({ tenantId }, fn);
}

export function currentTenantId(): string | null {
  return tenantScope.getStore()?.tenantId ?? null;
}

/** Does this SQL touch a table that RLS protects? */
export function touchesTenantTable(sql: string): string | null {
  for (const m of sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+"?([A-Za-z_][\w]*)"?/gi)) {
    if (TENANT_SCOPED_TABLES.has(m[1])) return m[1];
  }
  return null;
}

/**
 * Audited mutation contract (V5.2).
 *
 * A business mutation and its audit record MUST commit or roll back together.
 * Two separate transactions allow a governance change to exist with no trace —
 * unacceptable for a GRC platform. If the audit insert fails, the mutation is
 * rolled back and the caller receives an error.
 */
export async function auditedMutation<T>(
  tenantId: string,
  fn: (tx: {
    query:    <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
    queryOne: <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R | null>;
  }) => Promise<T>,
  audit: (tx: {
    query: <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
  }, result: T) => Promise<void>,
): Promise<T> {
  return withTenant(tenantId, async (tx) => {
    const result = await fn(tx);
    // Same transaction. A failure here rolls the mutation back.
    await audit(tx, result);
    return result;
  });
}

// ── Core query helpers ────────────────────────────────────────
/**
 * Tenant-aware. A query against a tenant-scoped table runs inside a transaction
 * carrying app.tenant_id, or is refused when no tenant scope is bound.
 */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const table = touchesTenantTable(sql);
  if (table) {
    const tid = currentTenantId();
    if (!tid) {
      throw new TenantContextError(
        `Refused: query touches tenant-scoped table '${table}' with no tenant context bound.`);
    }
    return withTenant(tid, (tx) => tx.query<T>(sql, params));
  }
  const result: QueryResult<T> = await getPool().query(sql, params);
  return result.rows;
}

export async function queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function queryCount(
  table: string,
  wheres: Record<string, unknown> = {},
  tenantId?: string,
): Promise<number> {
  const conditions: string[] = [];
  const params:     unknown[] = [];
  let p = 1;
  if (tenantId) { conditions.push(`"tenantId" = $${p++}`); params.push(tenantId); }
  for (const [k, v] of Object.entries(wheres)) {
    if (v !== undefined && v !== null) {
      conditions.push(`"${k}" = $${p++}`);
      params.push(v);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM "${table}" ${where}`,
    params,
  );
  return parseInt(row?.count ?? "0");
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;   // rethrow — never swallow
  } finally {
    client.release();
  }
}

export async function connectDB(): Promise<void> {
  try {
    await query("SELECT 1");
    console.log("[DB] PostgreSQL connected ✓");
  } catch (err) {
    const msg = (err as Error).message;
    if (process.env.NODE_ENV === "production") {
      // Item 3: fail closed. A production API must not run without its database.
      throw Object.assign(new Error(`SGIP: PostgreSQL connection failed in production — ${msg}`),
        { code: "DB_CONNECT_FAILED" });
    }
    console.warn("[DB] PostgreSQL unavailable (non-production):", msg);
  }
}

export async function disconnectDB(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    console.log("[DB] Pool closed");
  }
}
