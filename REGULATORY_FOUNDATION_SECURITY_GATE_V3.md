# REGULATORY_FOUNDATION_SECURITY_GATE_V3

## الحكم: **PASS — 24/24 end-to-end على PostgreSQL 18.4**

تشخيصك صحيح بالكامل: V2 أثبت RLS ولم يثبت مسار الاستمرارية. كل عطب ذكرته كان حقيقياً ومؤكداً بالتنفيذ.

---

## 1. Fail-Closed — نُفِّذ فعلياً (كان P0)

**ما وجدتَه:** `if (!this.dbAvailable) return this.fallback.*` في **سبعة** مسارات: write · query · getById · getLatest · validateChain · applyMigration · getAppliedMigrations. والتعليق نفسه كان يقول "Falls back gracefully".

**ما صار:** الحقل `fallback` حُذف من الصنف نهائياً (0 مراجع). كل مسار يستدعي `assertDb(op)` التي ترمي `DB_UNAVAILABLE` مع `statusCode: 503`.

`PERSISTENCE_MODE=memory` هو السبيل **الوحيد** للذاكرة، ومحظور في الإنتاج بشرط صريح.

**اختبار قديم كان يؤكد السلوك الخاطئ** (`gracefully degrades... Falls back to in-memory`) — عُكس ليؤكد `rejects.toMatchObject({ code: "DB_UNAVAILABLE" })`.

## 2-4. دورة إقلاع حتمية

| العطب | الحالة |
|-------|:---:|
| `connectDB()` يبتلع الخطأ ويكمل | ✅ يرمي `DB_CONNECT_FAILED` في الإنتاج |
| `runPending()` غير مُنتظَر + `console.warn` | ✅ `await` كامل، وأي فشل يوقف الإقلاع |
| Race: migrations قبل جاهزية الـadapter | ✅ أُزيل التشغيل من module top-level |

**الترتيب المنفَّذ الآن:**
```
connectDB → انتظار اتصال حقيقي (DB_WAIT_MS)
          → verifyRuntimeRole (rolsuper=false ∧ rolbypassrls=false)
          → await runPending()
          → verifyRlsCatalog (كل جدول tenant-scoped: RLS+FORCE+POLICY)
          → hydrate → listen()
```
أي فشل قبل `listen()` ⇒ `process.exit(1)`.

## 5. Checksums — كانت الثلاثة mismatch

تحققي الحسابي طابق تحققك حرفياً:

| | المعلن | من SQL |
|---|---|---|
| 001 | `0de0ad1a65fafe28` | `2a764b621494354d` ✗ |
| 002 | `b303ebf24edca6ff` | `8cdbba9a98daaac4` ✗ |
| 003 | `6589a75dbfcbf37f` | `efd6b33dba5ee5ac` ✗ |

**السبب:** كانت تُحسب من وسم مثل `"001_governance_events"` لا من SQL.

**الإصلاح:** `MigrationEngine.checksumOf(sql)` على SQL مُطبَّع (بلا تعليقات/مسافات زائدة)، و`normaliseChecksums()` ترمي `MIGRATION_CHECKSUM_MISMATCH` عند أي اختلاف. مُختبَر حياً.

## 6. مصدر ترحيل واحد معتمد

ثلاثة مصادر متنافسة → أُعلن `AUTHORITATIVE_SCHEMA_SOURCE = "infra/postgres/init.sql"`. المحرك لم يعد يُنشئ schema؛ يتحقق ويسجّل النسب.

## 7. عقد الـSchema — أُصلح

**ما وجدتَه:** `governance_events` يتطلب `topic`/`actor_id`/`actor_role` (NOT NULL) ولا يملك `updated_at`، بينما الـINSERT لا يرسل الثلاثة ويكتب `updated_at`.

**الإصلاح:** الـINSERT يطابق المخطط المعتمد الآن — 13 عموداً بلا `updated_at`. **مُثبت بتشغيل الـadapter الحقيقي** لا بـSQL probes.

## 8. تشغيل الـbootstrap الحقيقي

ملاحظتك صحيحة: V2 كان **يحاكي** `05-create-roles.sh` بدالة JavaScript، ولهذا لم يكتشف أن `APP_DB_PASSWORD` غير ممرَّر. `psql` غير مشحون مع ثنائيات npm، فأضفت **اختبار عقد بيئة** يقرأ السكربت ويؤكد أن كل متغير يطلبه ممرَّر في كلا ملفي compose.

## 9-11. Compose والأسرار

| البند | الحالة |
|-------|:---:|
| `APP_DB_PASSWORD` + `MIGRATOR_DB_PASSWORD` ممرَّران لخدمة postgres | ✅ |
| `${POSTGRES_PASSWORD:-sgip_secure_2025}` | ✅ صار `:?required` |
| `${JWT_SECRET:-sgip_jwt_secret_change_in_production}` | ✅ صار `:?required` |
| `context: .` من `infra/docker` | ✅ صار `../..` |
| `./infra/postgres/...` | ✅ صار `../../infra/postgres/...` |
| `.env.example` يوجّه إلى `sgip` | ✅ أُعيد كتابته: الأدوار الأربعة + كلمة مرور لكل دور + `PERSISTENCE_MODE` |

## 12. نتائج البوابة — 24/24

**RLS (17):** الأدوار الثلاثة · init.sql ثم rls.sql على قاعدة جديدة · اكتشاف الكتالوج · RLS+FORCE+POLICY لكل جدول · لا ملكية لدور التشغيل · منع CRUD عبر الكيانات · صفر صفوف بلا سياق · **الاختبار السلبي** (إزالة FORCE تُكتشف).

**Persistence (7 جديدة):**
| # | الفحص | الدليل |
|:---:|-------|--------|
| 18 | كل checksum = sha256(SQL مُطبَّع) | 3 ترحيلات مُتحقَّقة |
| 19 | الـadapter الحقيقي: write/getById/getLatest/validateChain | roundtrip ناجح |
| 20 | انقطاع القاعدة ⇒ الكتابة **تفشل** | `DB_UNAVAILABLE` |
| 21 | لا تسجيل ترحيل والقاعدة ساقطة | `DB_UNAVAILABLE` |
| 22 | البيانات المُثبتة تُقرأ على اتصال جديد | `rows=1` |
| 23 | checksum خاطئ مرفوض | `MIGRATION_CHECKSUM_MISMATCH` |
| 24 | ترحيل بلا SQL مرفوض | `MIGRATION_NO_SQL` |

---

## Baseline نهائي
| | |
|---|---|
| بلا PG | 26 suites · 850 ناجح · 1 متخطى |
| **مع PG حي** | **26 suites · 851/851 ناجح** |
| typecheck · build | 0 · exit 0 |
| RLS inventory | enabled=22 · forced=22 · policied=22 · **PASS** |
| الأدلة | `gate_v2_results.json` · `rls_inventory.json` |

## المخاطر المتبقية (بصراحة)
| # | الخطر | التصنيف |
|:---:|-------|:---:|
| 1 | `docker compose config/up` لم يُشغَّل — لا Docker daemon في البيئة. البوابة تنفّذ نفس ملفات bootstrap بنفس الترتيب وتؤكد عقد البيئة نصياً، لكنها لا تشغّل الحاوية | P1 |
| 2 | `psql` غير متاح، فـ`05-create-roles.sh` يُقرأ ويُتحقق من عقده لا يُنفَّذ كسكربت | P1 |
| 3 | Prisma migrations خارج المسار المعتمد — بقيت كأثر تاريخي ولا تُنشئ schema التشغيل | P2 |

**لا merge · لا deploy.**
