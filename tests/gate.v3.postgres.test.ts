/**
 * REGULATORY_FOUNDATION_SECURITY_GATE V2
 * Live checks run with SGIP_PG_GATE=1 against a real PostgreSQL.
 * Static checks always run and block regressions.
 */
import { execFileSync } from "child_process";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const live = process.env.SGIP_PG_GATE === "1" ? describe : describe.skip;

live("Gate V2 — fresh zero-state bootstrap on live PostgreSQL", () => {
  it("passes every gate check", () => {
    execFileSync("node", [join(ROOT, "scripts", "verify-gate-v3.cjs")], { cwd: ROOT, stdio: "pipe" });
    const out = JSON.parse(readFileSync("/tmp/gate_v2_results.json", "utf8"));
    expect(out.results.filter((r: {pass:boolean}) => !r.pass)).toEqual([]);
    expect(out.results.length).toBeGreaterThanOrEqual(30);
    expect(out.catalog.length).toBeGreaterThan(0);
    for (const t of out.catalog) {
      expect(t.relrowsecurity).toBe(true);
      expect(t.relforcerowsecurity).toBe(true);
      expect(t.policies).toBeGreaterThan(0);
      expect(t.owner).not.toBe("sgip_app");
    }
  }, 180000);
});

describe("Gate V2 — static guarantees (always run)", () => {
  it("RLS inventory: SET(enabled)==SET(forced)==SET(policied)", () => {
    execFileSync("node", [join(ROOT, "scripts", "rls-inventory.cjs")], { cwd: ROOT, stdio: "pipe" });
    const inv = JSON.parse(readFileSync("/tmp/rls_inventory.json", "utf8"));
    expect(inv.missingForce).toEqual([]);
    expect(inv.missingPolicy).toEqual([]);
    expect(inv.forceNoEnable).toEqual([]);
    expect(inv.dupForce).toEqual([]);
    expect(new Set(inv.enabled)).toEqual(new Set(inv.forced));
    expect(new Set(inv.enabled)).toEqual(new Set(inv.policied));
  });

  // These two files are RETIRED as schema sources but remain in the tree for
  // historical reference; they must still be free of the defects we fixed.
  it("no backslash escaping in executable SQL (retired files included)", () => {
    for (const f of ["infra/postgres/init.sql", "infra/postgres/rls.sql"]) {
      const exec = readFileSync(join(ROOT, f), "utf8")
        .split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
      expect(exec.includes("\\'")).toBe(false);
    }
  });

  it("no password interpolation inside executable SQL", () => {
    for (const f of ["infra/postgres/init.sql", "infra/postgres/rls.sql"]) {
      const s = readFileSync(join(ROOT, f), "utf8")
        .split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
      expect(s.includes("APP_DB_PASSWORD")).toBe(false);
      expect(/PASSWORD\s+'/i.test(s)).toBe(false);
    }
  });

  it("bootstrap scripts are mounted in both compose files, in order", () => {
    for (const f of ["docker-compose.yml", "infra/docker/docker-compose.prod.yml"]) {
      const s = readFileSync(join(ROOT, f), "utf8");
      expect(s).toContain("05-create-roles.sh");
      expect(s).toContain("db/migrations:/docker-entrypoint-initdb.d/migrations");
      expect(s).toContain("10-apply-migrations.sh");
    }
  });

  it("no compose file connects the API as an owner/admin account", () => {
    for (const f of ["docker-compose.yml", "infra/docker/docker-compose.prod.yml"]) {
      const s = readFileSync(join(ROOT, f), "utf8");
      for (const l of s.split("\n").filter(x => x.includes("DATABASE_URL"))) {
        expect(/postgresql:\/\/sgip_admin/.test(l)).toBe(false);
        expect(/postgresql:\/\/sgip:/.test(l)).toBe(false);
        expect(/postgresql:\/\/sgip_app/.test(l)).toBe(true);
      }
    }
  });

  it("role script enforces NOSUPERUSER/NOBYPASSRLS and a NOLOGIN owner", () => {
    const s = readFileSync(join(ROOT, "infra", "postgres", "05-create-roles.sh"), "utf8");
    expect(s).toContain("sgip_owner NOLOGIN NOSUPERUSER");
    expect(s).toContain("NOBYPASSRLS");
    expect(s).toContain("GRANT USAGE, CREATE ON SCHEMA public TO sgip_owner");
  });

  it("MigrationEngine refuses to record a migration without executing SQL", () => {
    const s = readFileSync(join(ROOT, "runtime", "persistence-adapters", "production.persistence.adapter.ts"), "utf8");
    expect(s).toContain("MIGRATION_NO_SQL");
    expect(s).toContain("MIGRATION_CHECKSUM_MISMATCH");
    expect(s).toContain("await client.query(m.sql)");
  });

  it("tenant context uses parameterized set_config, not interpolation", () => {
    const s = readFileSync(join(ROOT, "runtime", "persistence-adapters", "production.persistence.adapter.ts"), "utf8");
    expect(s).toContain("set_config('app.tenant_id', $1");
    expect(/SET LOCAL app\.tenant_id = '\$\{/.test(s)).toBe(false);
  });

  it("production fails closed: no in-memory substitution, no default credentials", () => {
    const adapter = readFileSync(join(ROOT, "runtime", "persistence-adapters", "production.persistence.adapter.ts"), "utf8");
    expect(adapter).toContain("DATABASE_URL is required in production");
    const db = readFileSync(join(ROOT, "api", "services", "db.service.ts"), "utf8");
    expect(db.includes("sgip_admin:sgip_secure_2025")).toBe(false);
    expect(db).toContain("startup aborted");
  });

  it("gate scripts are present", () => {
    expect(existsSync(join(ROOT, "scripts", "verify-gate-v3.cjs"))).toBe(true);
    expect(existsSync(join(ROOT, "scripts", "rls-inventory.cjs"))).toBe(true);
  });
});

describe("Gate V3 — bootstrap environment contract (always run)", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

  it("postgres service receives every variable its bootstrap scripts require", () => {
    const required = ["APP_DB_PASSWORD", "MIGRATOR_DB_PASSWORD"];
    const script = read("infra/postgres/05-create-roles.sh");
    for (const v of required) expect(script).toContain(v);
    for (const f of ["docker-compose.yml", "infra/docker/docker-compose.prod.yml"]) {
      const s = read(f);
      for (const v of required) expect(s).toContain(v);
    }
  });

  it("no default secrets in any compose file", () => {
    for (const f of ["docker-compose.yml", "infra/docker/docker-compose.prod.yml"]) {
      const s = read(f);
      expect(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:-/.test(s)).toBe(false);
      expect(/JWT_SECRET:\s*"?\$\{JWT_SECRET:-/.test(s)).toBe(false);
      expect(s.includes("sgip_secure_2025")).toBe(false);
      expect(s.includes("sgip_jwt_secret_change_in_production")).toBe(false);
    }
  });

  it("production compose paths resolve from its own directory", () => {
    const s = read("infra/docker/docker-compose.prod.yml");
    expect(/context:\s*\.\s*$/m.test(s)).toBe(false);
    expect(s).toContain("../../infra/postgres/");
    expect(/-\s+\.\/infra\//.test(s)).toBe(false);
  });

  it("no in-memory fallback remains in production persistence paths", () => {
    const s = read("runtime/persistence-adapters/production.persistence.adapter.ts");
    expect(s.includes("this.fallback")).toBe(false);
    expect(s).toContain("DB_UNAVAILABLE");
    expect(s).toContain("In-memory substitution is not permitted");
  });

  it("connectDB throws in production instead of degrading", () => {
    const s = read("api/services/db.service.ts");
    expect(s).toContain("DB_CONNECT_FAILED");
    expect(/console\.warn\("\[DB\] PostgreSQL unavailable:"/.test(s)).toBe(false);
  });

  it("startup awaits migrations and never warns-and-continues", () => {
    const s = read("api/server.ts");
    // Architecture: the API VERIFIES migration state; it never APPLIES DDL.
    expect(s).toContain("verifyMigrationState");
    expect(s.includes("new MigrationEngine(productionAdapter).runPending()")).toBe(false);
    expect(s).toContain("verifyRuntimeRole");
    expect(s).toContain("verifyRlsCatalog");
    expect(/Migration warning/.test(s)).toBe(false);
    expect(/runner\.runPending\(\)\s*\.then/.test(s)).toBe(false);
  });

  it("declares one authoritative migration source", () => {
    const s = read("runtime/persistence-adapters/production.persistence.adapter.ts");
    expect(s).toContain("AUTHORITATIVE_SCHEMA_SOURCE");
    expect(s).toContain('"db/migrations"');
    expect(/AUTHORITATIVE_SCHEMA_SOURCE\s*=\s*"infra\/postgres\/init\.sql"/.test(s)).toBe(false);
  });

  it("env contract documents the role model and requires every secret", () => {
    const s = read(".env.example");
    for (const v of ["sgip_owner", "sgip_migrator", "sgip_app", "APP_DB_PASSWORD",
                     "MIGRATOR_DB_PASSWORD", "PERSISTENCE_MODE"]) expect(s).toContain(v);
    expect(s.includes("postgresql://sgip:")).toBe(false);
  });
});

describe("Foundation closure — authoritative source & fail-closed (always run)", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

  it("declares exactly one authoritative migration source", () => {
    const doc = read("db/MIGRATION_SOURCE.md");
    expect(doc).toContain("AUTHORITATIVE");
    expect(doc).toContain("db/migrations");
    expect(doc).toContain("RETIRED");
  });

  it("the authoritative path covers every runtime-referenced table", () => {
    execFileSync("node", [join(ROOT, "scripts", "schema-coverage.cjs")], { cwd: ROOT, stdio: "pipe" });
    const cov = JSON.parse(readFileSync("/tmp/schema_coverage.json", "utf8"))
      .map((r: {table:string}) => r.table);
    const all = readdirSync(join(ROOT, "db", "migrations")).filter(f => f.endsWith(".sql"))
      .map(f => readFileSync(join(ROOT, "db", "migrations", f), "utf8")).join("\n");
    const missing = cov.filter((t: string) =>
      !new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${t}"?`, "i").test(all));
    expect(missing).toEqual([]);
    expect(cov.length).toBeGreaterThanOrEqual(10);
  });

  it("runtime application code carries no DDL of its own", () => {
    const s = read("runtime/persistence-adapters/production.persistence.adapter.ts");
    expect(/CREATE TABLE/i.test(s)).toBe(false);
    expect(/CREATE POLICY/i.test(s)).toBe(false);
    expect(s).toContain("SGIP_MIGRATIONS_DIR");
  });

  it("retired schema sources are marked and unmounted", () => {
    for (const f of ["infra/postgres/init.sql", "infra/postgres/rls.sql"]) {
      expect(read(f).startsWith("-- RETIRED")).toBe(true);
    }
    for (const c of ["docker-compose.yml", "infra/docker/docker-compose.prod.yml"]) {
      const s = read(c);
      expect(s).toContain("db/migrations:/docker-entrypoint-initdb.d/migrations");
      expect(s.includes("10_init.sql")).toBe(false);
      expect(s.includes("20_rls.sql")).toBe(false);
    }
  });

  it("tenant context is transaction-local, never session-level", () => {
    for (const f of ["runtime/persistence-adapters/production.persistence.adapter.ts",
                     "api/services/db.service.ts"]) {
      const s = read(f);
      expect(/set_config\(\s*'app\.tenant_id',\s*\$1,\s*false\s*\)/.test(s)).toBe(false);
    }
    const a = read("runtime/persistence-adapters/production.persistence.adapter.ts");
    expect(a).toContain("set_config('app.tenant_id', $1, true)");
  });
});
