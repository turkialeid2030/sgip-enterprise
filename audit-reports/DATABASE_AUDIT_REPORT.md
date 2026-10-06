# Database Audit Report — SGIP

**Method:** Static inspection of prisma/schema.prisma + raw SQL migrations. Live `prisma validate` was BLOCKED by sandbox (Prisma engine binary download returns 403 — no external network). Stated honestly.

## Schema
- ORM: **Prisma 7.8**, provider **postgresql**, url from `env(DATABASE_URL)`.
- **7 models:** Tenant, User, GovernanceEntity, GraphEdge, AuditLog, MemoryEntry, AgentOutput.
- **10 @relation directives** (model relationships).
- **16 @@index / @@unique blocks** (indexes + unique constraints).
- Schema parses structurally; datasource + generator blocks well-formed.

## Migrations (4 files, raw SQL)
| File | Purpose |
|------|---------|
| 001_initial.sql | base tables |
| 002_rls_tenant_hardening.sql | Row-Level Security (49 RLS/policy statements) |
| 003_graph_evidence_hardening.sql | graph + evidence (9 RLS statements) |
| 004_v5_governance_os.sql | v5 governance (17 RLS statements) |

- **161 constraint lines** across migrations (FOREIGN KEY / PRIMARY KEY / CONSTRAINT / REFERENCES / NOT NULL).
- **75 RLS/policy statements total** — tenant isolation via `app.tenant_id` is implemented at the SQL layer.

## NOT verified (honest)
- `prisma validate` engine check could not run (sandbox blocks binaries.prisma.sh — 403).
- No live PostgreSQL in this environment → tables, relations, indexes, and constraints were **not** materialized or queried against a running DB. They are verified to **exist in schema/migrations**, not verified by live DDL execution.
- To fully verify: run `prisma migrate deploy` + `prisma validate` against a live PostgreSQL with engines available.
