# REGULATORY_FOUNDATION_SECURITY_GATE — FINAL

## Executive Verdict

**`CODE_GATE_PASS / DOCKER_RUNTIME_VALIDATION_PENDING`**

لا أدّعي Production PASS. كل ما يمكن إثباته بالتنفيذ داخل هذه البيئة مثبت (30/30 بوابة + 7/7 API smoke على قاعدة حقيقية)، وما يتطلب Docker daemon مصنَّف صراحةً ولم يُنفَّذ.

---

## 1. Truth Map — مصدر واحد معتمد

| المصدر | الحالة | الجداول |
|--------|--------|:---:|
| **`db/migrations/*.sql`** | **AUTHORITATIVE** | **12/12** |
| `prisma/migrations/` | LEGACY_READ_ONLY | نُسخ منه 001-004 |
| `infra/postgres/init.sql` | **RETIRED** | غطّى 2/12 فقط |
| `infra/postgres/rls.sql` | **RETIRED** | أُدمج في 006 |
| `MigrationEngine.MIGRATIONS` | **RETIRED** | لا DDL في كود التشغيل |
| `prisma/seed.sql` | TEST_ONLY | — |

**الاكتشاف الحاسم:** `init.sql` كان مُعلناً معتمداً في V3 وهو يغطي **جدولين من اثني عشر**. الإعلان كان خاطئاً. المسار الجديد (001→006) يغطي 12/12، مُثبت آلياً بـ`scripts/schema-coverage.cjs` الذي يستخرج مراجع الجداول من الكود لا من قائمة يدوية.

## 2. Full Application Schema Coverage

`scripts/schema-coverage.cjs` يمسح كل `.ts/.js` خارج tests/scripts ويستخرج FROM/INSERT/UPDATE/DELETE/JOIN:

```
AgentOutput · ApprovalRequest · AuditLog · GovernanceEntity · GovernancePolicy
GraphEdge · PolicyEvaluation · SoDViolation · Tenant · User
governance_events · schema_migrations                       = 12
```
**pg_catalog بعد bootstrap نظيف: 12/12 موجودة.**

## 3. RLS — من الكتالوج لا من العدّ

| | |
|---|---|
| مخزون المستودع (executable SQL) | enabled=22 · forced=22 · policied=22 · **PASS** |
| **الكتالوج الفعلي بعد bootstrap** | **23 جدولاً tenant-scoped، كلها RLS+FORCE+POLICY** |

الرقم النهائي (23) جاء من قاعدة البيانات لا من ملف. كان 4 في V3 — والفرق أن المسار المعتمد الآن ينشئ المخطط الكامل.

**اكتشافات:** `User` كان tenant-scoped بلا RLS · `audit_trail` كذلك · `ImmutableDecision` بلا FORCE. الثلاثة أُصلحت.

## 4. Migration Ledger Integrity

- الترحيلات تُحمَّل من المسار المعتمد؛ **لا DDL داخل كود التشغيل** (مُختبَر: لا `CREATE TABLE`/`CREATE POLICY` في الـadapter).
- `checksum = sha256(normalize(sql))` — التطبيع يزيل التعليقات والمسافات.
- تسجيل الترحيل داخل معاملة: `BEGIN → execute → verify checksum → INSERT → COMMIT`، و`ROLLBACK` عند الفشل.
- `MIGRATION_NO_SQL` · `MIGRATION_CHECKSUM_MISMATCH` — كلاهما مُثبت حياً.

## 5. Deterministic Startup — والـAPI لا يطبّق DDL

**اكتشاف معماري في هذه الجولة:** دورة الإقلاع كانت تشغّل الترحيلات بدور التطبيق، ففشلت بـ`permission denied for schema public`. الفشل كان صحيحاً — والمعمارية كانت خاطئة.

**التصحيح:** الـAPI **يتحقق** من حالة الترحيل ولا **يطبّقها**. التطبيق يتطلب صلاحيات DDL، وهذا نقيض فصل الأدوار. الترحيلات تُطبَّق في bootstrap بـ`10-apply-migrations.sh` كـ`sgip_owner`.

```
config → secrets → connect → verify DB identity → verify runtime role
       → verify migration state → verify RLS catalog → hydrate → listen()
```
أي فشل ⇒ `process.exit(1)` قبل `listen()`.

## 6. Fail-Closed — مُثبت

| الحالة | النتيجة |
|--------|:---:|
| قاعدة ساقطة ⇒ write | `DB_UNAVAILABLE` ✅ |
| قاعدة ساقطة ⇒ تسجيل ترحيل | `DB_UNAVAILABLE` ✅ |
| إقلاع بقاعدة غير متاحة | `exit=1`، صفر أسطر listen ✅ |
| جدول مطلوب محذوف | `exit=1` · `missing table(s): AgentOutput` ✅ |
| بيانات مثبتة بعد اتصال جديد | مقروءة ✅ |

الحقل `fallback` حُذف من الصنف (0 مراجع). واختبار قديم كان يؤكد السلوك الخاطئ — عُكس.

## 7. Tenant Context — تسرّب الـpool

الاختبار أثبت **الحالتين**:
- `set_config(..., false)` (جلسة) **يتسرّب**: القيمة `tenant-a` بقيت بعد إعادة الاستخدام
- `set_config(..., true)` (معاملة) — نمط الإنتاج — **لا يتسرّب**: القيمة `""`

واختبار دائم يمنع ظهور النمط الخطر في كود الإنتاج.

## 8. نتائج البوابة — 30/30

| المجموعة | الفحوص |
|---------|:---:|
| الأدوار (owner NOLOGIN · migrator · app) | 3 |
| المسار المعتمد + تغطية المخطط الكامل | 3 |
| كتالوج RLS/FORCE/POLICY/ownership | 4 |
| CRUD عبر الكيانات + غياب السياق | 5 |
| اختبار سلبي (إزالة FORCE تُكتشف) | 1 |
| سلامة الترحيل (checksum/no-SQL/atomicity) | 3 |
| الـadapter الحقيقي CRUD | 1 |
| Fail-closed (outage/migrations/durability) | 3 |
| تسرّب الـpool (النمطان) | 2 |
| انجراف الـledger + تدمير المخطط | 3 |
| متفرقات | 2 |

**+ API SMOKE: 7/7** على قاعدة حقيقية (health · ready · cockpit · governance · third-sector · frameworks · 401 بلا token).

## 9. Baseline
| | |
|---|---|
| بلا PG | 26 suites · 855 ناجح · 1 متخطى |
| **مع PG حي** | **26 suites · 856/856** |
| typecheck · build | 0 · exit 0 |

## 10. تصنيف الاختبارات
| | |
|---|---|
| PASS | 856 |
| FAILED | 0 |
| SKIPPED | 0 |
| **ENVIRONMENT_BLOCKED** | **1** — `Gate V3 live` يعمل فقط بـ`SGIP_PG_GATE=1`؛ شُغّل ونجح |

## 11. المخاطر المتبقية

| # | الخطر | التصنيف | مانع؟ |
|:---:|-------|:---:|:---:|
| 1 | `docker compose config/up` لم يُشغَّل — لا Docker daemon | **DOCKER_RUNTIME_VALIDATION_PENDING** | لا |
| 2 | `psql` غير مشحون مع ثنائيات npm — سكربتات bootstrap يُتحقق من عقدها نصياً ولا تُنفَّذ كـshell | P1 | لا |
| 3 | SSL/certificates لم تُتحقق (البند 25) | P2 | لا |
| 4 | `prisma/migrations` باقية كـLEGACY_READ_ONLY | P3 | لا |

**لا P0 متبقية.** ولا شيء منها يسبب Data Leakage أو Data Loss أو Regulatory Misstatement.

## 12. قرار البوابة

وفق قاعدتك (البند 71-72): كل P0 مغلقة، والسلسلة متماسكة من قاعدة نظيفة إلى API smoke. الفجوة الوحيدة تحتاج Docker daemon فقط.

**`FOUNDATION_BASELINE = CODE_GATE_PASS`**
**`DOCKER_RUNTIME_VALIDATION_PENDING`**

الانتقال إلى `REGULATORY_SOURCE_DISCOVERY` مسموح وفق البند 77.

**لا merge · لا deploy · لا اعتماد قانوني · لا مصادر غير رسمية كحقائق.**
