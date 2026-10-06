/**
 * بند 48 / 55 — Release-blocker guard.
 * Production route logic must never fabricate data. This test fails the build
 * if demo/seed injection returns to executive routes.
 */
import { readFileSync } from "fs";
import { join } from "path";

const ROUTES = join(__dirname, "..", "api", "routes", "executive", "executive.routes.ts");

describe("بند48 — no demo data in production logic", () => {
  const src = readFileSync(ROUTES, "utf8");

  it("contains no demo/pilot seeding comments", () => {
    expect(/Seed a representative item if empty/i.test(src)).toBe(false);
    expect(/Seed representative provenance/i.test(src)).toBe(false);
    expect(/pilot demo\)/i.test(src)).toBe(false);
  });

  it("does not fabricate a legislative change inside the legal review queue", () => {
    // a hard-coded decree/gazette literal in the route file is a blocker
    expect(/gazetteIssue:\s*"\d+"/.test(src)).toBe(false);
    expect(/demo-aml-2026/.test(src)).toBe(false);
  });

  it("does not branch on an empty store to inject data", () => {
    expect(/totalDataPoints === 0\)\s*\{[\s\S]{0,200}engine\.track/.test(src)).toBe(false);
    expect(/queue\.list\(\)\.length === 0\)\s*\{[\s\S]{0,200}enqueue/.test(src)).toBe(false);
  });
});
