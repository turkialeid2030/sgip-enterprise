/**
 * AUDIT ATOMICITY — execution-based proof.
 *
 * Atomicity is NOT asserted from source text. For each governance mutation the
 * audit table is made unwritable for the runtime role, the mutation is issued
 * over HTTP, and the business state is inspected directly in PostgreSQL.
 *
 *   audit write fails  =>  HTTP must fail  AND  business state must be unchanged
 *
 * Also proves the Graph path end-to-end: same-tenant success FIRST, then
 * durability across restart, and only then cross-tenant denial.
 */
const { Client } = require("pg");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require(path.join(process.cwd(), "node_modules/bcryptjs"));

const HOST = "/tmp", PORT = 5433, DB = "sgip_audit", SUPER = "pgowner", APIPORT = 4075;
const R = [];
const rec = (n, p, d) => { R.push({ n, p, d: d ?? null });
  console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const conn = async (u, d = DB) => { const c = new Client({ host: HOST, port: PORT, user: u, database: d }); await c.connect(); return c; };
const norm = s => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let srv = null;
const call = (p, m = "GET", body = null, tok = null) => new Promise(res => {
  const h = { "Content-Type": "application/json" }; if (tok) h.Authorization = "Bearer " + tok;
  const q = http.request({ hostname: "localhost", port: APIPORT, path: p, method: m, headers: h }, r => {
    let d = ""; r.on("data", c => d += c);
    r.on("end", () => { try { res({ s: r.statusCode, b: JSON.parse(d) }); } catch { res({ s: r.statusCode, b: d.slice(0, 90) }); } });
  });
  q.on("error", e => res({ s: 0, b: e.message })); if (body) q.write(JSON.stringify(body)); q.end();
});

const startApi = async (url) => {
  srv = spawn("node", ["dist/api/server.js"], { env: { ...process.env, PORT: String(APIPORT),
    NODE_ENV: "production", DATABASE_URL: url, JWT_SECRET: "a_secret", JWT_REFRESH_SECRET: "a_refresh" },
    stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", d => log += d); srv.stderr.on("data", d => log += d);
  for (let i = 0; i < 40; i++) { await sleep(500); const r = await call("/health/ready"); if (r.s === 200) return log; }
  return log;
};

const mkEntity = t => ({ type: "policy", title: `Entity ${t}`, owner: `owner-${t}`,
  description: `probe ${t}`, status: "draft", priority: "medium", riskLevel: "medium", impactLevel: "medium" });

const countIn = async (tenant, sql, params = []) => {
  const c = await conn("sgip_app");
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } finally { await c.end(); }
};

(async () => {
  // ── fresh database + authoritative migrations + ledger ──
  let b = await conn(SUPER, "postgres");
  await b.query(`DROP DATABASE IF EXISTS ${DB}`); await b.query(`CREATE DATABASE ${DB}`); await b.end();
  let a = await conn(SUPER);
  await a.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await a.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  for (const [r, o] of [["sgip_owner", "NOLOGIN NOSUPERUSER NOBYPASSRLS"],
                        ["sgip_app", "LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'app_pw'"]]) {
    await a.query(`CREATE ROLE ${r} ${o}`).catch(async () => { await a.query(`ALTER ROLE ${r} ${o}`); });
  }
  await a.query(`GRANT USAGE, CREATE ON SCHEMA public TO sgip_owner`);
  await a.query(`GRANT USAGE ON SCHEMA public TO sgip_app`);
  await a.query(`SET ROLE sgip_owner`);
  await a.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version TEXT NOT NULL, description TEXT NOT NULL,
     checksum TEXT NOT NULL, source_id TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     applied_by TEXT NOT NULL DEFAULT CURRENT_USER, duration_ms INTEGER,
     status TEXT NOT NULL DEFAULT 'applied', CONSTRAINT uq_sm_version UNIQUE(version))`);
  await a.query(`RESET ROLE`);
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    const crypto = require("crypto");
    const ck = crypto.createHash("sha256").update(norm(sql)).digest("hex").slice(0, 16);
    await a.query("BEGIN"); await a.query("SET LOCAL ROLE sgip_owner"); await a.query(sql); await a.query("RESET ROLE");
    await a.query(`INSERT INTO schema_migrations(version,description,checksum,source_id)
                   VALUES($1,$2,$3,$4)`, [f.split("_")[0], f, ck, "db/migrations/" + f]);
    await a.query("COMMIT");
  }
  await a.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO sgip_app`);
  await a.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO sgip_app`);

  const hash = await bcrypt.hash("Passw0rd!", 10);
  for (const t of ["tenant-a", "tenant-b"]) {
    await a.query(`INSERT INTO "Tenant"(id,name,slug) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [t, t, t]).catch(() => {});
    await a.query("BEGIN"); await a.query("SELECT set_config('app.tenant_id',$1,true)", [t]);
    await a.query(`INSERT INTO "User"(id,email,"nameAr",role,"tenantId","passwordHash","isActive")
                   VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING`,
                   [t + "-u1", `u@${t}.sa`, "م", "governance_analyst", t, hash]).catch(() => {});
    await a.query("COMMIT");
  }
  await a.end();

  const url = `postgresql://sgip_app:app_pw@localhost:${PORT}/${DB}?host=${HOST}`;
  const log = await startApi(url);
  const ready = await call("/health/ready");
  rec("API up in production mode with a ledger-verified schema", ready.s === 200,
      `ready=${ready.s}`);

  const la = await call("/api/auth/login", "POST", { email: "u@tenant-a.sa", password: "Passw0rd!", tenantId: "tenant-a" });
  const lb = await call("/api/auth/login", "POST", { email: "u@tenant-b.sa", password: "Passw0rd!", tenantId: "tenant-b" });
  const tokA = la.b?.token, tokB = lb.b?.token;
  rec("tenant A and B can log in", !!tokA && !!tokB, `A=${la.s} B=${lb.s}`);

  // ══════════════════════════════════════════════════════════════
  // GRAPH: same-tenant SUCCESS first (item 5)
  // ══════════════════════════════════════════════════════════════
  const a1 = await call("/api/entities", "POST", mkEntity("A1"), tokA);
  const a2 = await call("/api/entities", "POST", mkEntity("A2"), tokA);
  const idA1 = a1.b?.id, idA2 = a2.b?.id;
  rec("Entity A1 created = 201", a1.s === 201 && !!idA1, `status=${a1.s}`);
  rec("Entity A2 created = 201", a2.s === 201 && !!idA2, `status=${a2.s}`);

  const edge = await call("/api/graph/edge", "POST",
    { fromId: idA1, toId: idA2, relationship: "depends_on", weight: 1 }, tokA);
  rec("SAME-TENANT graph edge POST = 201 (no 400/404/422 accepted)", edge.s === 201,
      `status=${edge.s} ${edge.s !== 201 ? JSON.stringify(edge.b).slice(0, 90) : ""}`);

  let edgeRows = [];
  try { edgeRows = await countIn("tenant-a",
    `SELECT "fromId","toId",relationship FROM "GraphEdge" WHERE "fromId"=$1 AND "toId"=$2`, [idA1, idA2]); } catch (e) {}
  rec("edge exists in PostgreSQL under tenant A", edgeRows.length === 1,
      `rows=${edgeRows.length}`);

  const graphGet = await call(`/api/graph/${idA1}`, "GET", null, tokA);
  rec("edge visible through the Graph API for tenant A",
      graphGet.s === 200 && JSON.stringify(graphGet.b).includes(idA2),
      `status=${graphGet.s} containsTarget=${JSON.stringify(graphGet.b).includes(idA2)}`);

  // ── durability across a real restart ──
  srv.kill(); await sleep(1500);
  await startApi(url);
  const relogin = await call("/api/auth/login", "POST", { email: "u@tenant-a.sa", password: "Passw0rd!", tenantId: "tenant-a" });
  const tokA2 = relogin.b?.token;
  let edgeAfter = [];
  try { edgeAfter = await countIn("tenant-a",
    `SELECT "fromId" FROM "GraphEdge" WHERE "fromId"=$1 AND "toId"=$2`, [idA1, idA2]); } catch (e) {}
  const graphAfter = await call(`/api/graph/${idA1}`, "GET", null, tokA2);
  rec("edge survives a full API restart (DB + API)",
      edgeAfter.length === 1 && graphAfter.s === 200 &&
      JSON.stringify(graphAfter.b).includes(idA2),
      `dbRows=${edgeAfter.length} api=${graphAfter.s}`);

  // ── cross-tenant denial, as a SEPARATE test ──
  const b1 = await call("/api/entities", "POST", mkEntity("B1"), tokB);
  const idB1 = b1.b?.id;
  rec("Entity B1 created in tenant B = 201", b1.s === 201 && !!idB1, `status=${b1.s}`);

  const crossEdge = await call("/api/graph/edge", "POST",
    { fromId: idA1, toId: idB1, relationship: "depends_on", weight: 1 }, tokA2);
  rec("token A cannot create an edge into tenant B", crossEdge.s !== 201, `status=${crossEdge.s}`);

  const graphB = await call(`/api/graph/${idA1}`, "GET", null, tokB);
  // B asking for A's node must not receive A's graph
  const bSeesA = graphB.s === 200 && JSON.stringify(graphB.b).includes(idA2);
  rec("tenant B cannot read tenant A graph node", !bSeesA, `status=${graphB.s} leaked=${bSeesA}`);

  let bEdgeRows = [];
  try { bEdgeRows = await countIn("tenant-b",
    `SELECT "fromId" FROM "GraphEdge" WHERE "fromId"=$1`, [idA1]); } catch (e) {}
  rec("tenant B sees zero rows of tenant A edges in PostgreSQL", bEdgeRows.length === 0,
      `rows=${bEdgeRows.length}`);

  // ══════════════════════════════════════════════════════════════
  // AUDIT ATOMICITY — real failure injection (item 4)
  // ══════════════════════════════════════════════════════════════
  const setAuditWritable = async (writable) => {
    const c = await conn(SUPER);
    await c.query(writable
      ? `GRANT INSERT ON "AuditLog" TO sgip_app`
      : `REVOKE INSERT ON "AuditLog" FROM sgip_app`);
    await c.end();
  };

  const before = {
    entities:  (await countIn("tenant-a", `SELECT id FROM "GovernanceEntity"`)).length,
    edges:     (await countIn("tenant-a", `SELECT id FROM "GraphEdge"`)).length,
    policies:  (await countIn("tenant-a", `SELECT id FROM "GovernancePolicy"`)).length,
    approvals: (await countIn("tenant-a", `SELECT id FROM "ApprovalRequest"`)).length,
    audits:    (await countIn("tenant-a", `SELECT id FROM "AuditLog"`)).length,
  };

  await setAuditWritable(false);
  console.log("\n  --- AuditLog INSERT revoked for the runtime role ---");

  const inj = [];
  const create = await call("/api/entities", "POST", mkEntity("SHOULD_NOT_EXIST"), tokA2);
  inj.push(["entity.create", create.s]);
  const upd = await call(`/api/entities/${idA1}`, "PATCH", { title: "SHOULD_NOT_APPLY" }, tokA2);
  inj.push(["entity.update", upd.s]);
  const ed = await call("/api/graph/edge", "POST",
    { fromId: idA2, toId: idA1, relationship: "blocks", weight: 1 }, tokA2);
  inj.push(["graph.edge.create", ed.s]);
  const pol = await call("/api/policies", "POST",
    { code: "POL-INJ", title: "Injected", category: "governance", description: "x" }, tokA2);
  inj.push(["policy.create", pol.s]);
  const aprBody = { entityId: idA1, entityType: "policy", action: "activate",
    steps: [{ order: 1, approver: "tenant-a-u1", approverType: "user", required: true, slaHours: 24 }] };
  const apr = await call("/api/approvals", "POST", aprBody, tokA2);
  inj.push(["approval.create", apr.s]);

  const anySucceeded = inj.filter(([, s]) => s >= 200 && s < 300);
  rec("every governance mutation FAILS while the audit table is unwritable",
      anySucceeded.length === 0,
      inj.map(([n, s]) => `${n}=${s}`).join(" "));

  const after = {
    entities:  (await countIn("tenant-a", `SELECT id FROM "GovernanceEntity"`)).length,
    edges:     (await countIn("tenant-a", `SELECT id FROM "GraphEdge"`)).length,
    policies:  (await countIn("tenant-a", `SELECT id FROM "GovernancePolicy"`)).length,
    approvals: (await countIn("tenant-a", `SELECT id FROM "ApprovalRequest"`)).length,
    audits:    (await countIn("tenant-a", `SELECT id FROM "AuditLog"`)).length,
  };
  rec("no business row was created by any failed mutation (no partial commit)",
      after.entities === before.entities && after.edges === before.edges &&
      after.policies === before.policies && after.approvals === before.approvals,
      `entities ${before.entities}->${after.entities} edges ${before.edges}->${after.edges} ` +
      `policies ${before.policies}->${after.policies} approvals ${before.approvals}->${after.approvals}`);

  const titleRows = await countIn("tenant-a", `SELECT title FROM "GovernanceEntity" WHERE id=$1`, [idA1]);
  rec("the attempted UPDATE left the entity title unchanged",
      titleRows[0]?.title === "Entity A1", `title=${JSON.stringify(titleRows[0]?.title)}`);

  rec("no audit row was created either", after.audits === before.audits,
      `audits ${before.audits}->${after.audits}`);

  await setAuditWritable(true);
  console.log("  --- AuditLog INSERT restored ---\n");

  const recovered = await call("/api/entities", "POST", mkEntity("AFTER_RESTORE"), tokA2);
  rec("mutations succeed again once auditing is restored", recovered.s === 201, `status=${recovered.s}`);

  // ── at-most-one-active policy invariant ──
  // The invariant is enforced at TWO layers:
  //   1. UNIQUE("tenantId", code) in the schema — a duplicate code cannot exist
  //   2. activateIn() supersedes any other active row with the same code, in
  //      the same transaction as the audit event
  const p1 = await call("/api/policies", "POST", { code: "POL-INV", title: "v1", category: "governance", description: "x" }, tokA2);
  const dup = await call("/api/policies", "POST", { code: "POL-INV", title: "v2", category: "governance", description: "x" }, tokA2);
  rec("duplicate policy code is rejected by the schema constraint",
      p1.s === 201 && dup.s !== 201, `first=${p1.s} duplicate=${dup.s}`);

  if (p1.s === 201) {
    const act = await call(`/api/policies/${p1.b.id}/activate`, "PATCH", {}, tokA2);
    const active = await countIn("tenant-a",
      `SELECT id FROM "GovernancePolicy" WHERE code='POL-INV' AND status='active'`);
    rec("at most ONE active policy version per (tenant, code)",
        act.s >= 200 && act.s < 300 && active.length === 1,
        `activate=${act.s} activeVersions=${active.length}`);
  } else {
    rec("at most ONE active policy version per (tenant, code)", false, `policy create failed=${p1.s}`);
  }

  srv.kill();
  const pass = R.filter(r => r.p).length;
  console.log(`\n  AUDIT+GRAPH: ${pass}/${R.length}`);
  fs.writeFileSync("/tmp/audit_atomicity_results.json", JSON.stringify(R, null, 2));
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error("FATAL:", e.message); if (srv) srv.kill(); process.exit(2); });
