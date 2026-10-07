# AUTHORITATIVE MIGRATION SOURCE

**`db/migrations/*.sql` — الوحيد المعتمد.**

| المصدر | الحالة |
|--------|--------|
| `db/migrations/` | **AUTHORITATIVE** |
| `prisma/migrations/` | `LEGACY_READ_ONLY` — نُسخ منه 001-004، لا يُنفَّذ |
| `infra/postgres/init.sql` | `RETIRED` — غطّى 2/12 جدولاً فقط |
| `infra/postgres/rls.sql` | `RETIRED` — أُدمج في 006 |
| `MigrationEngine.MIGRATIONS` | `RETIRED` — لا DDL في كود التشغيل |
| `prisma/seed.sql` | `TEST_ONLY` |

الترتيب: 001 → 002 → 003 → 004 → 005 → 006
