import { assertProductionSecrets } from "./config/secrets";
import { createHash } from "crypto";
import { correlationMiddleware } from "./middleware/correlation.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join as pathJoin } from "path";
// OTel must be first import
import "./telemetry";
/**
 * SGIP Enterprise API Server
 * Express + JWT + PostgreSQL (Prisma) + Real AI Gateway
 *
 * Endpoints:
 *   POST   /api/auth/login
 *   POST   /api/auth/register
 *   GET    /api/entities
 *   POST   /api/entities
 *   GET    /api/entities/:id
 *   PATCH  /api/entities/:id
 *   DELETE /api/entities/:id
 *   GET    /api/graph/node/:id
 *   POST   /api/graph/edge
 *   GET    /api/graph/trace/:id
 *   GET    /api/graph/blind-spots
 *   POST   /api/ai/analyze        ← Real Anthropic API
 *   GET    /api/ai/outputs
 *   PATCH  /api/ai/outputs/:id/review
 *   GET    /api/ai/agents
 *   GET    /api/dashboard/summary
 *   GET    /api/dashboard/audit-logs
 *   GET    /api/dashboard/health
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { connectDB, disconnectDB, runInTenantScope } from "./services/db.service";
import { authRouter }      from "./routes/auth.routes";
import { entitiesRouter }  from "./routes/entities.routes";
import { graphRouter }     from "./routes/graph.routes";
import { aiRouter }        from "./routes/ai.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { policyRouter }    from "./routes/policy.routes";
import { approvalRouter }  from "./routes/approval.routes";
import { graphRuntimeRouter } from "./routes/graph.runtime.routes";
import { frameworksRouter }  from "./routes/frameworks.routes";
import { governanceRouter }  from "./routes/governance.routes";
import { sceosRouter }       from "./routes/sceos.routes";
import { persistenceRouter } from "./routes/persistence.routes";
import { executiveRouter }   from "./routes/executive/executive.routes";
import { GraphDBAdapter } from "../graph/db.adapter";
import { EventBus } from "../core/event-bus";
import { AuditLogger } from "../audit/audit.logger";
import { productionAdapter, MigrationEngine } from "../runtime/persistence-adapters/production.persistence.adapter";
import { initKafkaPublisher, disconnectKafka, isKafkaAvailable } from "../runtime/kafka/kafka.publisher";

// Persistence lifecycle is executed inside bootstrap() below — never at module
// top level. Top-level async work created a race: the adapter connected
// asynchronously while migrations already ran, so migrations could be recorded
// without ever touching PostgreSQL.

const app  = express();
const PORT = parseInt(process.env.PORT ?? "4000");

// Correlation must run before auth/rate-limit/routes so every outcome is traceable.
app.use(correlationMiddleware);

// ── Security middleware ────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:", "https:"],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
    },
  },
}));

app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    process.env.FRONTEND_URL ?? "http://localhost:3000",
  ],
  methods:     ["GET","POST","PATCH","DELETE","OPTIONS"],
  allowedHeaders:["Content-Type","Authorization","X-Tenant-Id","X-Request-Id","X-Correlation-Id"],
  exposedHeaders:["X-Correlation-Id"],
  credentials: true,
}));

// ── Rate limiting ──────────────────────────────────────────────
app.use("/api/auth", rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: "Too many auth requests" } }));
app.use("/api/ai",   rateLimit({ windowMs: 60*1000,    max: 30, message: { error: "AI rate limit exceeded" } }));
app.use("/api",      rateLimit({ windowMs: 60*1000,    max: 200 }));

// ── Body / utility middleware ──────────────────────────────────
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ── Health (unauthenticated) ───────────────────────────────────
app.get("/health", async (_req, res) => {
  const dbMode = process.env.DATABASE_URL ? "postgresql" : "in-memory";
  let dbStatus = "connected";
  if (process.env.DATABASE_URL) {
    try {
      const health = await productionAdapter.healthCheck();
      dbStatus = health.healthy ? "connected" : "degraded";
    } catch { dbStatus = "unreachable"; }
  }
  res.json({
    status:    dbStatus === "connected" || dbMode === "in-memory" ? "healthy" : "degraded",
    version:   "8.0",
    timestamp: new Date().toISOString(),
    db:        { mode: dbMode, status: dbStatus },
    runtime:   { tests: 874, endpoints: 135, engines: 67, inventoryAsOf: "2026-10-05" },
  });
});

app.get("/health/ready", async (_req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  // Readiness reports the startup integrity attestation — migrations, RLS and
  // runtime role — not merely that a TCP connection is alive.
  if (process.env.DATABASE_URL && !ATTESTATION) {
    res.status(503).json({ ready: false, reason: "startup integrity not attested" });
    return;
  }
  if (isProd) {
    // Item 6: fail closed. No in-memory substitution in production.
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ ready: false, reason: "DATABASE_URL not configured" });
      return;
    }
    try {
      const h = await productionAdapter.healthCheck();
      if (!h.healthy) { res.status(503).json({ ready: false, reason: "database unhealthy" }); return; }
    } catch {
      res.status(503).json({ ready: false, reason: "database unreachable" });
      return;
    }
  }
  res.json({
    ready: true, timestamp: new Date().toISOString(),
    attestation: ATTESTATION ?? { note: "no database configured (non-production)" },
  });
});

// ── API Routes ─────────────────────────────────────────────────
app.use("/api/auth",      authRouter);
app.use("/api/entities",  entitiesRouter);
app.use("/api/graph",     graphRouter);
app.use("/api/ai",        aiRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/policies",  policyRouter);
app.use("/api/approvals", approvalRouter);
app.use("/api/graph-runtime", graphRuntimeRouter);
app.use("/api/frameworks",    frameworksRouter);
app.use("/api/governance",    governanceRouter);
app.use("/api/sceos",         sceosRouter);
app.use("/api/persistence",   persistenceRouter);
app.use("/api/executive",     executiveRouter);

// ── 404 handler ────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Endpoint not found" }));

// ── Error handler ──────────────────────────────────────────────
app.use(errorMiddleware);

// ── Startup ────────────────────────────────────────────────────
/**
 * Deterministic startup lifecycle (items 2 & 4).
 *
 *   create pool -> await DB connection -> verify runtime DB role
 *   -> run migrations (awaited) -> verify migration state -> verify RLS catalog
 *   -> hydrate services -> listen()
 *
 * Any failure before listen() in production exits non-zero. Migrations are
 * never fire-and-forget, and a migration failure never degrades to a warning.
 */
async function bootstrapPersistence(): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";
  if (!process.env.DATABASE_URL) {
    if (isProd) throw new Error("SGIP: DATABASE_URL is required in production.");
    console.log("[Persistence] No DATABASE_URL — non-production, persistence bootstrap skipped");
    return;
  }

  // 1. await a real connection before anything else touches the database
  const deadline = Date.now() + Number(process.env.DB_WAIT_MS ?? 15000);
  let health = await productionAdapter.healthCheck().catch(() => ({ healthy: false }));
  while (!health.healthy && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    health = await productionAdapter.healthCheck().catch(() => ({ healthy: false }));
  }
  if (!health.healthy) throw new Error("SGIP: database did not become available before the startup deadline.");
  console.log("[Persistence] database connection established");

  // 2. verify the runtime DB role is not privileged enough to bypass RLS
  const roleCheck = await verifyRuntimeRole();
  if (!roleCheck.ok) throw new Error(`SGIP: runtime DB role check failed — ${roleCheck.reason}`);
  console.log(`[Persistence] runtime role verified: ${roleCheck.role}`);

  // 3. migration state — the API VERIFIES, it does not APPLY.
  // Per the role model the API runs as sgip_app (DML only). Applying DDL would
  // require giving the runtime role migration privileges, which is exactly what
  // the role separation forbids. Migrations are applied at bootstrap by
  // 10-apply-migrations.sh (as sgip_owner), or by an operator using
  // MIGRATOR_DATABASE_URL. Startup fails closed if the schema is incomplete.
  const migState = await verifyMigrationState();
  if (!migState.ok) throw new Error(`SGIP: migration state invalid — ${migState.reason}`);
  console.log(`[Persistence] migration state verified: ${migState.detail}`);

  // 4. verify RLS catalog before serving traffic
  const rls = await verifyRlsCatalog();
  if (!rls.ok) throw new Error(`SGIP: RLS catalog verification failed — ${rls.reason}`);
  console.log(`[Persistence] RLS verified on ${rls.tables} tenant-scoped table(s)`);

  ATTESTATION = {
    migrationsVerified: true, migrationDetail: migState.detail ?? "",
    rlsVerified: true, rlsTables: rls.tables ?? 0,
    roleVerified: true, role: roleCheck.role ?? "",
    attestedAt: new Date().toISOString(),
  };
}

/**
 * Verify the schema matches the authoritative migration path. The API never
 * applies DDL; it refuses to serve traffic against an incomplete schema.
 */
async function verifyMigrationState(): Promise<{ok:boolean; detail?:string; reason?:string}> {
  try {
    const dir = process.env.SGIP_MIGRATIONS_DIR
      ?? [pathJoin(__dirname, "..", "db", "migrations"),
          pathJoin(__dirname, "..", "..", "db", "migrations"),
          pathJoin(process.cwd(), "db", "migrations")].find(d => existsSync(d));
    if (!dir) return { ok:false, reason:"authoritative migration directory not found" };

    const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    if (files.length === 0) return { ok:false, reason:"authoritative migration directory is empty" };

    const normalise = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    const expected = files.map(f => {
      const sql = readFileSync(pathJoin(dir, f), "utf8");
      return { version: f.split("_")[0], file: f,
               checksum: createHash("sha256").update(normalise(sql)).digest("hex").slice(0, 16), sql };
    });

    // duplicate versions in the authoritative path are themselves a failure
    const dupes = expected.map(e => e.version)
      .filter((v, i, a) => a.indexOf(v) !== i);
    if (dupes.length) return { ok:false, reason:`duplicate migration version(s): ${[...new Set(dupes)].join(", ")}` };

    const raw = productionAdapter as unknown as {rawQuery:(q:string, p?:unknown[])=>Promise<unknown[]>};

    // ── LEDGER verification (not merely "does the table exist") ──
    let ledger: Array<{version:string; checksum:string}>;
    try {
      ledger = await raw.rawQuery(
        `SELECT version, checksum FROM schema_migrations ORDER BY version`) as Array<{version:string; checksum:string}>;
    } catch {
      return { ok:false, reason:"schema_migrations ledger is missing — migrations were never applied" };
    }
    if (ledger.length === 0) {
      return { ok:false, reason:"migration ledger is empty — bootstrap did not record any migration" };
    }
    const byVersion = new Map(ledger.map(l => [l.version, l.checksum]));

    const missing = expected.filter(e => !byVersion.has(e.version)).map(e => e.file);
    if (missing.length) return { ok:false, reason:`migration(s) not applied: ${missing.join(", ")}` };

    const tampered = expected.filter(e => byVersion.get(e.version) !== e.checksum)
      .map(e => `${e.file} (ledger=${byVersion.get(e.version)} expected=${e.checksum})`);
    if (tampered.length) return { ok:false, reason:`checksum mismatch: ${tampered.join("; ")}` };

    const unexpected = ledger.filter(l => !expected.some(e => e.version === l.version)).map(l => l.version);
    if (unexpected.length) return { ok:false, reason:`ledger contains unknown migration version(s): ${unexpected.join(", ")}` };

    // ── schema manifest: every declared table must actually exist ──
    const declared = new Set<string>();
    for (const e of expected) {
      for (const m of e.sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([A-Za-z_][\w]*)"?/gi)) declared.add(m[1]);
    }
    const rows = await raw.rawQuery(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'`) as Array<{tablename:string}>;
    const present = new Set(rows.map(r => r.tablename));
    const absent = [...declared].filter(t => !present.has(t));
    if (absent.length) return { ok:false, reason:`ledger says applied but schema is missing: ${absent.join(", ")}` };

    return { ok:true, detail:`${expected.length} migrations verified against ledger; ${declared.size} tables present` };
  } catch (e) {
    return { ok:false, reason:(e as Error).message };
  }
}

/** The runtime role must not be superuser, must not bypass RLS. */
async function verifyRuntimeRole(): Promise<{ok:boolean; role?:string; reason?:string}> {
  try {
    const rows = await (productionAdapter as unknown as {rawQuery:(q:string,p?:unknown[])=>Promise<unknown[]>}).rawQuery(
      `SELECT current_user AS role, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`);
    const r = rows[0] as {role:string; rolsuper:boolean; rolbypassrls:boolean} | undefined;
    if (!r) return { ok:false, reason:"could not resolve current_user" };
    if (r.rolsuper)      return { ok:false, role:r.role, reason:`${r.role} is SUPERUSER — it would bypass RLS` };
    if (r.rolbypassrls)  return { ok:false, role:r.role, reason:`${r.role} has BYPASSRLS` };
    return { ok:true, role:r.role };
  } catch (e) {
    return { ok:false, reason:(e as Error).message };
  }
}

/** Every tenant-scoped table must have RLS + FORCE + at least one policy. */
async function verifyRlsCatalog(): Promise<{ok:boolean; tables?:number; reason?:string}> {
  try {
    const rows = await (productionAdapter as unknown as {rawQuery:(q:string,p?:unknown[])=>Promise<unknown[]>}).rawQuery(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::int AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                      AND NOT a.attisdropped AND a.attname IN ('tenant_id','tenantId'))`) as
      Array<{relname:string; relrowsecurity:boolean; relforcerowsecurity:boolean; policies:number}>;
    if (rows.length === 0) return { ok:false, reason:"no tenant-scoped tables found" };
    const bad = rows.filter(r => !r.relrowsecurity || !r.relforcerowsecurity || r.policies === 0);
    if (bad.length) return { ok:false, reason:`unprotected: ${bad.map(b=>b.relname).join(", ")}` };
    return { ok:true, tables: rows.length };
  } catch (e) {
    return { ok:false, reason:(e as Error).message };
  }
}

/**
 * Startup integrity attestation (item 11).
 * Readiness must report what was actually verified, not merely that a
 * connection is alive. The attestation is produced during bootstrap and
 * re-checked (cheaply) on each readiness probe.
 */
interface StartupAttestation {
  migrationsVerified: boolean; migrationDetail: string;
  rlsVerified: boolean; rlsTables: number;
  roleVerified: boolean; role: string;
  attestedAt: string;
}
let ATTESTATION: StartupAttestation | null = null;
export function getAttestation(): StartupAttestation | null { return ATTESTATION; }

export async function start() {
  assertProductionSecrets();
  await connectDB();
  await bootstrapPersistence();

  // Kafka publisher — awaited during process startup, never during module import.
  await initKafkaPublisher();

  const server = app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  SGIP Enterprise API Server — Running                ║`);
    console.log(`║  http://localhost:${PORT}                            ║`);
    console.log(`║  Environment: ${process.env.NODE_ENV ?? "development"}                    ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Server] ${signal} received — shutting down gracefully`);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectKafka();
    await disconnectDB();
  };
  process.once("SIGTERM", () => { void shutdown("SIGTERM").finally(() => process.exit(0)); });
  process.once("SIGINT",  () => { void shutdown("SIGINT").finally(() => process.exit(0)); });
  return server;
}

// Importing `app` for Supertest must be side-effect free. Production/dev entry via
// this file still starts normally when it is the executed module.
if (require.main === module) {
  void start().catch((err) => {
    console.error("[Startup] Failed:", err);
    process.exit(1);
  });
}

export { app };
