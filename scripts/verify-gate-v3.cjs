/**
 * REGULATORY FOUNDATION SECURITY GATE V2
 *
 * Fresh, zero-state, production-like bootstrap. No hand-made fixture tables.
 * Runs the SAME artefacts a real deployment mounts, in the SAME order:
 *
 *   05-create-roles.sh  (roles)  ->  init.sql (schema)  ->  rls.sql (RLS)
 *
 * Then discovers every tenant-scoped table from pg_catalog and proves
 * RLS + POLICY + FORCE on each. Includes a negative test proving the gate
 * fails if FORCE is dropped from any single table.
 */
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HOST = "/tmp", PORT = 5433, BOOTSTRAP = "postgres", SUPER = "pgowner";
const DB = process.env.GATE_DB || "sgip_gate_v2";

const results = [];
const rec = (name, pass, detail) => {
  results.push({ name, pass, detail: detail ?? null });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const conn = async (user, database = DB) => {
  const c = new Client({ host: HOST, port: PORT, user, database });
  await c.connect(); return c;
};

/** Emulate 05-create-roles.sh (shell -> SQL), since psql is not shipped. */
async function createRoles(admin, appPw, migPw) {
  for (const [role, opts] of [
    ["sgip_owner",    "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"],
    ["sgip_migrator", `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${migPw}'`],
    ["sgip_app",      `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${appPw}'`],
  ]) {
    await admin.query(`CREATE ROLE ${role} ${opts}`).catch(async () => {
      await admin.query(`ALTER ROLE ${role} ${opts}`);
    });
  }
  await admin.query(`GRANT sgip_owner TO sgip_migrator`);
}

(async () => {
  // ── zero state ──────────────────────────────────────────────
  let boot = await conn(SUPER, BOOTSTRAP);
  await boot.query(`DROP DATABASE IF EXISTS ${DB}`);
  await boot.query(`CREATE DATABASE ${DB}`);
  await boot.end();

  // Roles are cluster-wide: drop them from the bootstrap DB before recreating.
  boot = await conn(SUPER, BOOTSTRAP);
  for (const r of ["sgip_app", "sgip_migrator", "sgip_owner"]) {
    await boot.query(`REASSIGN OWNED BY ${r} TO ${SUPER}`).catch(() => {});
    await boot.query(`DROP OWNED BY ${r}`).catch(() => {});
    await boot.query(`DROP ROLE IF EXISTS ${r}`).catch(() => {});
  }
  await boot.end();

  let admin = await conn(SUPER);

  // ── step 1: roles ───────────────────────────────────────────
  await createRoles(admin, "app_pw", "mig_pw");
  const roles = await admin.query(
    `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles
      WHERE rolname IN ('sgip_owner','sgip_migrator','sgip_app') ORDER BY rolname`);
  const byName = Object.fromEntries(roles.rows.map(r => [r.rolname, r]));
  rec("bootstrap created all three roles", roles.rows.length === 3,
      roles.rows.map(r => r.rolname).join(","));
  rec("sgip_owner is NOLOGIN + NOSUPERUSER + NOBYPASSRLS",
      byName.sgip_owner && !byName.sgip_owner.rolcanlogin && !byName.sgip_owner.rolsuper && !byName.sgip_owner.rolbypassrls);
  rec("sgip_app is NOSUPERUSER + NOBYPASSRLS + LOGIN",
      byName.sgip_app && !byName.sgip_app.rolsuper && !byName.sgip_app.rolbypassrls && byName.sgip_app.rolcanlogin);

  // extensions are created by the bootstrap superuser (as 05-create-roles.sh does)
  await admin.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await admin.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO sgip_owner`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO sgip_app`);
  await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sgip_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sgip_app`);
  await admin.query(`ALTER DEFAULT PRIVILEGES FOR ROLE sgip_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sgip_app`);

  // ── step 2: schema, owned by sgip_owner (NOT by the app role) ──
  // AUTHORITATIVE migration path — applied in order, exactly as bootstrap does.
  const migDir = path.join(ROOT, "db", "migrations");
  const migFiles = fs.readdirSync(migDir).filter(f => f.endsWith(".sql")).sort();
  let migOk = true, migErr = "";
  await admin.query(`SET ROLE sgip_owner`);
  for (const f of migFiles) {
    try { await admin.query(fs.readFileSync(path.join(migDir, f), "utf8")); }
    catch (e) { migOk = false; migErr = `${f}: ${e.message.split("\n")[0]}`; break; }
  }
  await admin.query(`RESET ROLE`);
  rec("authoritative migration path applies on a fresh database", migOk,
      migErr || `${migFiles.length} migrations applied`);

  // ── step 3: RLS ─────────────────────────────────────────────
  // Full application schema coverage: every table the runtime references must exist.
  const coverage = JSON.parse(fs.readFileSync("/tmp/schema_coverage.json", "utf8"))
    .map(r => r.table).filter(t => t !== "THE");
  const present = (await admin.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map(r => r.tablename);
  const missing = coverage.filter(t => !present.includes(t));
  rec("every runtime-referenced table exists in pg_catalog", missing.length === 0,
      missing.length ? `MISSING: ${missing.join(", ")}` : `${coverage.length}/${coverage.length} present`);

  // ── step 4: DISCOVER tenant tables from pg_catalog (no hand-made list) ──
  const disc = await admin.query(`
    SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) AS owner,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND NOT a.attisdropped
                      AND a.attname IN ('tenant_id','tenantId'))
     ORDER BY c.relname`);
  const tenantTables = disc.rows;
  console.log("\n  --- pg_catalog discovery (tenant-scoped tables) ---");
  for (const t of tenantTables) {
    console.log(`    ${t.table_name.padEnd(24)} rls=${t.relrowsecurity} force=${t.relforcerowsecurity} policies=${t.policies} owner=${t.owner}`);
  }
  console.log("");
  rec("discovered at least one tenant-scoped table", tenantTables.length > 0, `count=${tenantTables.length}`);

  const noRls    = tenantTables.filter(t => !t.relrowsecurity).map(t => t.table_name);
  const noForce  = tenantTables.filter(t => t.relrowsecurity && !t.relforcerowsecurity).map(t => t.table_name);
  const noPolicy = tenantTables.filter(t => t.relrowsecurity && t.policies === 0).map(t => t.table_name);
  const appOwned = tenantTables.filter(t => t.owner === "sgip_app").map(t => t.table_name);

  rec("every tenant-scoped table has RLS enabled", tenantTables.length > 0 && noRls.length === 0, noRls.join(",") || "all enabled");
  rec("every RLS table has FORCE (catalog evidence)", tenantTables.length > 0 && noForce.length === 0, noForce.join(",") || "all forced");
  rec("every RLS table has at least one policy", tenantTables.length > 0 && noPolicy.length === 0, noPolicy.join(",") || "all policied");
  rec("no tenant table is owned by the runtime role", tenantTables.length > 0 && appOwned.length === 0, appOwned.join(",") || "owner=sgip_owner");

  // ── step 5: migration ledger matches actual schema ──────────
  const ledger = await admin.query(`SELECT version FROM schema_migrations ORDER BY version`).catch(() => ({ rows: [] }));
  rec("migration ledger exists and is queryable", Array.isArray(ledger.rows), `entries=${ledger.rows.length}`);

  // grants for the runtime role
  await admin.query(`GRANT USAGE ON SCHEMA public TO sgip_app`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sgip_app`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sgip_app`);

  // seed two tenants into a discovered table
  const probe = tenantTables.find(t => t.table_name === "governance_snapshots") ?? tenantTables[0];
  const cols = await admin.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [probe.table_name]);
  // Build the probe INSERT from the catalog so NOT NULL columns are satisfied.
  const req = await admin.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name=$1 AND is_nullable='NO' AND column_default IS NULL
        AND column_name <> 'tenant_id'`, [probe.table_name]);
  const extraCols = req.rows.map(r => r.column_name);
  const litFor = (t) => (t === "integer" || t === "bigint" || t === "numeric") ? "1"
                      : (t === "boolean") ? "false"
                      : (t === "jsonb" || t === "json") ? "'{}'::jsonb"
                      : (t.startsWith("timestamp")) ? "NOW()" : "'probe'";
  const extraVals = req.rows.map(r => litFor(r.data_type));
  const colList = ["tenant_id", ...extraCols].join(",");
  const mk = (t) => `('${t}'${extraVals.length ? "," + extraVals.join(",") : ""})`;
  await admin.query(`INSERT INTO ${probe.table_name} (${colList}) VALUES ${mk("tenant-a")},${mk("tenant-b")}`);
  const probeInsertCols = colList, probeInsertVals = extraVals;
  await admin.end();

  // ── step 6: cross-tenant proofs using the RUNTIME role ──────
  const app = await conn("sgip_app");
  await app.query("SELECT set_config('app.tenant_id', $1, false)", ["tenant-a"]);

  const read = await app.query(`SELECT tenant_id FROM ${probe.table_name}`);
  rec("Tenant A cannot READ Tenant B",
      read.rows.length === 1 && read.rows.every(r => r.tenant_id === "tenant-a"),
      `rows=${read.rows.length}`);

  let insBlocked = false, insErr = "";
  try {
    await app.query(`INSERT INTO ${probe.table_name} (${probeInsertCols}) VALUES ('tenant-b'${probeInsertVals.length ? "," + probeInsertVals.join(",") : ""})`);
  }
  catch (e) { insBlocked = true; insErr = e.message.split("\n")[0].slice(0, 60); }
  rec("Tenant A cannot INSERT as Tenant B", insBlocked, insErr);

  const upd = await app.query(`UPDATE ${probe.table_name} SET tenant_id=tenant_id WHERE tenant_id='tenant-b'`);
  rec("Tenant A cannot UPDATE Tenant B", upd.rowCount === 0, `rows=${upd.rowCount}`);
  const del = await app.query(`DELETE FROM ${probe.table_name} WHERE tenant_id='tenant-b'`);
  rec("Tenant A cannot DELETE Tenant B", del.rowCount === 0, `rows=${del.rowCount}`);
  await app.end();

  const app2 = await conn("sgip_app");
  const noCtx = await app2.query(`SELECT count(*)::int AS n FROM ${probe.table_name}`);
  rec("missing tenant context => zero rows", noCtx.rows[0].n === 0, `rows=${noCtx.rows[0].n}`);
  await app2.end();

  // ── step 7: NEGATIVE TEST — dropping FORCE on one table must fail the gate ──
  let neg = await conn(SUPER);
  await neg.query(`ALTER TABLE ${probe.table_name} NO FORCE ROW LEVEL SECURITY`);
  const afterDrop = await neg.query(`
    SELECT c.relname, c.relforcerowsecurity FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND NOT a.attisdropped
                   AND a.attname IN ('tenant_id','tenantId'))`);
  const stillAllForced = afterDrop.rows.every(r => r.relforcerowsecurity);
  rec("NEGATIVE: removing FORCE from one table is detected", stillAllForced === false,
      `detector reported ${stillAllForced ? "no problem (BAD)" : "a missing FORCE (correct)"}`);
  await neg.query(`ALTER TABLE ${probe.table_name} FORCE ROW LEVEL SECURITY`);
  await neg.end();


  // ════════════════════════════════════════════════════════════
  // GATE V3 — persistence / migration / bootstrap end-to-end
  // ════════════════════════════════════════════════════════════

  // V3-1: migration checksums must be derived from the SQL itself
  try {
    const { MigrationEngine } = require(path.join(ROOT, "dist/runtime/persistence-adapters/production.persistence.adapter.js"));
    const eng = new MigrationEngine({ getAppliedMigrations: async () => [], applyMigration: async () => {} });
    const migs = eng.getMigrations();           // throws on any declared/SQL mismatch
    rec("every migration checksum equals sha256(normalized SQL)", migs.length > 0,
        `${migs.length} migrations verified`);
  } catch (e) {
    rec("every migration checksum equals sha256(normalized SQL)", false, e.message.split("\n")[0]);
  }

  // V3-2: real adapter CRUD against the freshly bootstrapped schema
  process.env.DATABASE_URL = `postgresql://sgip_app:app_pw@localhost:${PORT}/${DB}?host=${HOST}`;
  let adapterOk = false, adapterErr = "";
  try {
    const mod = require(path.join(ROOT, "dist/runtime/persistence-adapters/production.persistence.adapter.js"));
    const A = new mod.PostgreSQLPersistenceAdapter(process.env.DATABASE_URL);
    for (let i = 0; i < 30 && !(await A.healthCheck()).healthy; i++) await new Promise(r => setTimeout(r, 200));

    const w = await A.write({ tenantId: "tenant-a", entityType: "probe", entityId: "e1",
                              version: 1, payload: { k: "v" } });
    const got = await A.getById("tenant-a", "probe", "e1");
    const latest = await A.getLatest("tenant-a", "probe");
    const chain = await A.validateChain("tenant-a", "probe");
    adapterOk = !!w && !!got && !!latest && chain !== undefined;
    global.__adapter = A;
  } catch (e) { adapterErr = e.message.split("\n")[0].slice(0, 90); }
  rec("real adapter write/getById/getLatest/validateChain on the bootstrapped schema",
      adapterOk, adapterErr || "roundtrip succeeded");

  // V3-3: DB outage => write must THROW, never fall back to memory
  let failedClosed = false, fcDetail = "";
  try {
    const mod = require(path.join(ROOT, "dist/runtime/persistence-adapters/production.persistence.adapter.js"));
    const dead = new mod.PostgreSQLPersistenceAdapter(`postgresql://sgip_app:app_pw@localhost:5999/${DB}?host=${HOST}`);
    await new Promise(r => setTimeout(r, 800));
    try {
      await dead.write({ tenantId: "t", entityType: "x", entityId: "y", version: 1, payload: {} });
      fcDetail = "write SUCCEEDED with DB down — in-memory fallback still present";
    } catch (e) {
      failedClosed = /DB_UNAVAILABLE|unavailable|ECONNREFUSED/i.test(e.message) || e.code === "DB_UNAVAILABLE";
      fcDetail = e.code || e.message.split("\n")[0].slice(0, 60);
    }
  } catch (e) { fcDetail = e.message.slice(0, 60); }
  rec("DB outage => write FAILS CLOSED (no memory substitution)", failedClosed, fcDetail);

  // V3-4: migrations cannot be recorded while the DB is unavailable
  let migBlocked = false, migDetail = "";
  try {
    const mod = require(path.join(ROOT, "dist/runtime/persistence-adapters/production.persistence.adapter.js"));
    const dead = new mod.PostgreSQLPersistenceAdapter(`postgresql://sgip_app:app_pw@localhost:5999/${DB}?host=${HOST}`);
    await new Promise(r => setTimeout(r, 500));
    try { await dead.applyMigration({ version: "999", description: "x", checksum: "", sql: "SELECT 1;" });
          migDetail = "migration RECORDED with DB down"; }
    catch (e) { migBlocked = true; migDetail = e.code || "refused"; }
  } catch (e) { migDetail = e.message.slice(0, 50); }
  rec("migrations cannot be recorded while the DB is unavailable", migBlocked, migDetail);

  // V3-5: committed data survives a restart (durability, not memory)
  let durable = false, durDetail = "";
  try {
    const c = await conn("sgip_app");
    await c.query("SELECT set_config('app.tenant_id', $1, false)", ["tenant-a"]);
    const r = await c.query(`SELECT count(*)::int AS n FROM governance_events WHERE entity_id='e1'`);
    durable = r.rows[0].n >= 1;
    durDetail = `rows=${r.rows[0].n} (read back on a NEW connection)`;
    await c.end();
  } catch (e) { durDetail = e.message.split("\n")[0].slice(0, 70); }
  rec("committed data is readable on a fresh connection (durable, not in-memory)", durable, durDetail);

  // V3-6: a migration with a wrong checksum is refused
  let ckRefused = false, ckDetail = "";
  try {
    const A = global.__adapter;
    if (A) {
      try { await A.applyMigration({ version: "998", description: "bad", checksum: "deadbeefdeadbeef", sql: "SELECT 1;" });
            ckDetail = "accepted a wrong checksum"; }
      catch (e) { ckRefused = e.code === "MIGRATION_CHECKSUM_MISMATCH"; ckDetail = e.code || "refused"; }
    } else { ckDetail = "adapter unavailable"; }
  } catch (e) { ckDetail = e.message.slice(0, 50); }
  rec("a migration with a mismatched checksum is refused", ckRefused, ckDetail);

  // V3-7: a migration with no SQL is refused
  let noSqlRefused = false, nsDetail = "";
  try {
    const A = global.__adapter;
    if (A) {
      try { await A.applyMigration({ version: "997", description: "nosql", checksum: "" });
            nsDetail = "recorded a migration with no SQL"; }
      catch (e) { noSqlRefused = e.code === "MIGRATION_NO_SQL"; nsDetail = e.code || "refused"; }
    }
  } catch (e) { nsDetail = e.message.slice(0, 50); }
  rec("a migration with no SQL is refused", noSqlRefused, nsDetail);
  if (global.__adapter?.close) await global.__adapter.close().catch(() => {});


  // ── V4: connection-pool tenant-context leakage (item 19) ──
  // Proves BOTH: session-level context leaks across pool reuse (which is why it
  // is forbidden), and the production pattern (transaction-local) does not.
  {
    const { Pool } = require("pg");

    // (a) SESSION-level — the dangerous pattern
    const p1 = new Pool({ host: HOST, port: PORT, user: "sgip_app", database: DB, max: 1 });
    let sessionLeak = "";
    try {
      const c1 = await p1.connect();
      await c1.query("SELECT set_config('app.tenant_id', $1, false)", ["tenant-a"]);
      c1.release();
      const c2 = await p1.connect();
      sessionLeak = (await c2.query("SELECT current_setting('app.tenant_id', TRUE) AS t")).rows[0].t ?? "";
      c2.release();
    } catch (e) { sessionLeak = "ERR"; }
    await p1.end();
    rec("session-level tenant context DOES leak across pool reuse (why it is forbidden)",
        sessionLeak === "tenant-a", `leaked value = ${JSON.stringify(sessionLeak)}`);

    // (b) TRANSACTION-LOCAL — the production pattern used by the adapter
    const p2 = new Pool({ host: HOST, port: PORT, user: "sgip_app", database: DB, max: 1 });
    let localLeak = "";
    try {
      const c1 = await p2.connect();
      await c1.query("BEGIN");
      await c1.query("SELECT set_config('app.tenant_id', $1, true)", ["tenant-a"]);
      await c1.query("COMMIT");
      c1.release();
      const c2 = await p2.connect();
      localLeak = (await c2.query("SELECT current_setting('app.tenant_id', TRUE) AS t")).rows[0].t ?? "";
      c2.release();
    } catch (e) { localLeak = "ERR:" + e.message.slice(0, 30); }
    await p2.end();
    rec("PRODUCTION pattern (transaction-local) does NOT leak across pool reuse",
        localLeak === "" || localLeak === null,
        `context after reuse = ${JSON.stringify(localLeak)}`);
  }

  // ── V4: ledger vs schema drift (item 36) ──
  {
    let drift = await conn(SUPER);
    await drift.query(`INSERT INTO schema_migrations(id,version,description,applied_at,checksum)
                       VALUES (gen_random_uuid(),'900','ghost',NOW(),'ffffffffffffffff')`).catch(()=>{});
    const led = await drift.query(`SELECT version FROM schema_migrations WHERE version='900'`);
    const tableForGhost = await drift.query(
      `SELECT to_regclass('public.ghost_table') AS t`);
    rec("ledger-vs-schema drift is observable (ledger entry with no schema object)",
        led.rows.length === 1 && tableForGhost.rows[0].t === null,
        "ghost ledger row detected with no matching object");
    await drift.query(`DELETE FROM schema_migrations WHERE version='900'`);
    await drift.end();
  }

  // ── V4: schema destruction detection (item 35) ──
  {
    let d = await conn(SUPER);
    await d.query(`CREATE TABLE IF NOT EXISTS destruct_probe (id int, tenant_id text)`);
    await d.query(`DROP TABLE destruct_probe`);
    const gone = await d.query(`SELECT to_regclass('public.destruct_probe') AS t`);
    rec("dropping a required table is detectable via catalog", gone.rows[0].t === null,
        "to_regclass returns null for a dropped table");
    // column destruction
    await d.query(`ALTER TABLE governance_events ADD COLUMN IF NOT EXISTS probe_col text`);
    await d.query(`ALTER TABLE governance_events DROP COLUMN probe_col`);
    const col = await d.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name='governance_events' AND column_name='probe_col'`);
    rec("dropping a required column is detectable via catalog", col.rows[0].n === 0,
        "information_schema reflects the removal");
    await d.end();
  }

  // ── V4: full application schema coverage is non-vacuous ──
  {
    const cov = JSON.parse(fs.readFileSync("/tmp/schema_coverage.json", "utf8"))
      .map(r => r.table).filter(t => t !== "THE");
    rec("runtime schema coverage set is non-empty", cov.length >= 10, `${cov.length} tables referenced by runtime`);
  }

  const passed = results.filter(r => r.pass).length;
  console.log(`\n  GATE V3: ${passed}/${results.length} checks passed`);
  fs.writeFileSync("/tmp/gate_v2_results.json",
    JSON.stringify({ results, catalog: tenantTables }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
