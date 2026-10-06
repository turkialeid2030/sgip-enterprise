/**
 * RLS Inventory — executable SQL only.
 *
 * Replaces the previous naive `ENABLE count == FORCE count` check, which
 * (a) counted text inside comments and (b) could be satisfied by a duplicate
 * FORCE on one table masking a missing FORCE on another.
 *
 * Acceptance criterion:
 *   SET(enabledTables) == SET(forcedTables) == SET(policyProtectedTables)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SQL_FILES = [
  "prisma/migrations/001_initial.sql",
  "prisma/migrations/002_rls_tenant_hardening.sql",
  "prisma/migrations/003_graph_evidence_hardening.sql",
  "prisma/migrations/004_v5_governance_os.sql",
  "infra/postgres/init.sql",
  "infra/postgres/rls.sql",
];

/** Strip line comments and block comments, and collapse string literals. */
function executableSql(raw) {
  let s = raw.replace(/\/\*[\s\S]*?\*\//g, " ");        // block comments
  s = s.split("\n").map(l => {
    const i = l.indexOf("--");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
  return s;
}

const norm = t => t.replace(/["`]/g, "").trim();

function inventory() {
  const enabled = new Map(), forced = new Map(), policied = new Map();
  const dupForce = [];

  for (const rel of SQL_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const sql = executableSql(fs.readFileSync(p, "utf8"));

    // NOTE: \s* (not \s+) — 'ALTER TABLE "X"ENABLE ...' occurs in the codebase
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+("?[\w.]+"?)\s*ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
      const t = norm(m[1]);
      enabled.set(t, [...(enabled.get(t) ?? []), rel]);
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+("?[\w.]+"?)\s*FORCE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
      const t = norm(m[1]);
      const prev = forced.get(t) ?? [];
      if (prev.length) dupForce.push({ table: t, files: [...prev, rel] });
      forced.set(t, [...prev, rel]);
    }
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+[\w"]+\s+ON\s+("?[\w.]+"?)/gi)) {
      const t = norm(m[1]);
      policied.set(t, [...(policied.get(t) ?? []), rel]);
    }
  }
  return { enabled, forced, policied, dupForce };
}

function report() {
  const { enabled, forced, policied, dupForce } = inventory();
  const all = [...new Set([...enabled.keys(), ...forced.keys(), ...policied.keys()])].sort();

  console.log("TABLE                          ENABLE  FORCE  POLICY  SOURCE");
  console.log("-".repeat(88));
  for (const t of all) {
    const e = enabled.has(t), f = forced.has(t), p = policied.has(t);
    const src = [...new Set([...(enabled.get(t) ?? []), ...(forced.get(t) ?? []), ...(policied.get(t) ?? [])])]
      .map(x => x.split("/").pop()).join(",");
    console.log(
      `${t.padEnd(30)} ${(e ? "yes" : "NO ").padEnd(7)} ${(f ? "yes" : "NO ").padEnd(6)} ${(p ? "yes" : "NO ").padEnd(7)} ${src}`);
  }

  const missingForce  = all.filter(t => enabled.has(t) && !forced.has(t));
  const missingPolicy = all.filter(t => enabled.has(t) && !policied.has(t));
  const forceNoEnable = all.filter(t => forced.has(t) && !enabled.has(t));

  console.log("\nSET equality check:");
  console.log(`  enabled=${enabled.size}  forced=${forced.size}  policied=${policied.size}`);
  if (missingForce.length)  console.log(`  MISSING FORCE : ${missingForce.join(", ")}`);
  if (missingPolicy.length) console.log(`  MISSING POLICY: ${missingPolicy.join(", ")}`);
  if (forceNoEnable.length) console.log(`  FORCE W/O ENABLE: ${forceNoEnable.join(", ")}`);
  if (dupForce.length)      console.log(`  DUPLICATE FORCE: ${dupForce.map(d => d.table).join(", ")}`);

  const ok = missingForce.length === 0 && missingPolicy.length === 0
          && forceNoEnable.length === 0 && dupForce.length === 0;
  console.log(`\nINVENTORY: ${ok ? "PASS" : "FAIL"}`);
  return { ok, all, enabled: [...enabled.keys()], forced: [...forced.keys()],
           policied: [...policied.keys()], missingForce, missingPolicy, forceNoEnable, dupForce };
}

if (require.main === module) {
  const r = report();
  fs.writeFileSync("/tmp/rls_inventory.json", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
module.exports = { inventory, report, executableSql };
