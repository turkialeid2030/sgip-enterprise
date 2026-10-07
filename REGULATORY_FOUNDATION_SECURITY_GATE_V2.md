# REGULATORY_FOUNDATION_SECURITY_GATE_V2

## الحكم: **PASS** — 17/17 من حالة صفرية على PostgreSQL 18.4

كل رقم أدناه ناتج تنفيذ فعلي. البوابة السابقة كانت **false positive** كما شخّصت: اختبرت قاعدة fixture مصغّرة لا مسار النشر.

---

## 1. RLS Inventory — بمحلّل SQL تنفيذي (لا عدّ نصي)

`scripts/rls-inventory.cjs` يتجاهل التعليقات ويطبع لكل جدول: ENABLE · FORCE · POLICY · الملف.

**معيار القبول المعتمد:** `SET(enabled) == SET(forced) == SET(policied)` — لا مقارنة أعداد.

### عطبان كشفهما المحلّل
| العطب | التفصيل | الحالة |
|-------|---------|:---:|
| `ImmutableDecision` بلا FORCE | مكتوب `"ImmutableDecision"ENABLE` بلا مسافة — لهذا فات regex السابق | ✅ أُصلح |
| FORCE مكرر ×2 | `governance_snapshots` · `governance_events` · `evidence_records` | ✅ أُزيل |

**النتيجة:** `enabled=22 · forced=22 · policied=22` · **INVENTORY: PASS**

## 2. الاختبار الحي يشغّل مسار النشر الحقيقي

V1 أُتلف وحُذف سكربته. V2 يبدأ من **قاعدة فارغة تماماً** وينفّذ الترتيب الحتمي:

`05-create-roles.sh` (أدوار + امتدادات + منح) → `init.sql` (المخطط) → `rls.sql` (RLS)

ثم **يكتشف الجداول من `pg_catalog`** بحثاً عن `tenant_id`/`tenantId` — لا قوائم يدوية.

### اكتشاف رابع من الكتالوج
`audit_trail` — جدول tenant-scoped **بلا RLS إطلاقاً**. لم يكن في أي قائمة يدوية؛ كشفه المسح وحده. ✅ أُضيف له ENABLE + FORCE + POLICY.

### دليل الكتالوج الفعلي
```
audit_trail           rls=true force=true policies=1 owner=sgip_owner
evidence_records      rls=true force=true policies=1 owner=sgip_owner
governance_events     rls=true force=true policies=1 owner=sgip_owner
governance_snapshots  rls=true force=true policies=1 owner=sgip_owner
```

## 3. Bootstrap حتمي — أُصلح

`20-create-app-role.sh` لم يكن مركّباً في أي compose، فالنشر النظيف لم يكن ينشئ `sgip_app`. الآن كلا الملفين يركّبان: `05_roles.sh` → `10_init.sql` → `20_rls.sql`. وأُزيل `seed.sql` من bootstrap الإنتاج (فيه ENABLE بلا FORCE).

## 4. init.sql — ثلاثة عطوب مكتشفة بالتشغيل

| # | العطب | الحالة |
|:---:|-------|:---:|
| 1 | 18 اقتباساً مهروباً `\'` | ✅ أُصلح |
| 2 | `rls.sql` يطبّق RLS على `evidence_records` غير المُنشأ | ✅ أُنشئ في init.sql |
| 3 | **تناقض بنيوي:** `CREATE EXTENSION` يحتاج superuser، لكن المالك يجب ألا يكون superuser | ✅ الامتدادات نُقلت لمرحلة الـsuperuser قبل تحويل الملكية |
| 4 | **PostgreSQL 15+:** لا يمنح `CREATE` على `public` تلقائياً → `permission denied for schema public` | ✅ منح صريح + ALTER DEFAULT PRIVILEGES |

## 5. MigrationEngine — أُصلح (كان P0)

**ما كان:** `runPending()` يستدعي `applyMigration()` الذي يُدرج سجلاً في `schema_migrations` **دون تنفيذ `m.sql` إطلاقاً**. أي أن الترحيلات كانت تُسجَّل كمطبَّقة وهي لم تعمل.

**ما صار:** معاملة واحدة — `BEGIN → client.query(m.sql) → تحقق checksum → INSERT → COMMIT`، و`ROLLBACK` عند أي فشل. ويرفض التسجيل بلا SQL (`MIGRATION_NO_SQL`) أو عند اختلاف البصمة (`MIGRATION_CHECKSUM_MISMATCH`).

## 6. Production Fail-Closed ✅
- `NODE_ENV=production` بلا `DATABASE_URL` ⇒ رفض الإقلاع
- `/health/ready` يعيد **503** عند تعذّر القاعدة — لا استبدال in-memory

## 7. حذف بيانات الاعتماد المثبتة ✅
`postgresql://sgip_admin:sgip_secure_2025@localhost` أُزيل. في الإنتاج: غياب `DATABASE_URL` = فشل إقلاع.

## 8-9. طبقة القاعدة وسياق الكيان ✅
سياق الكيان صار **معاملاً**: `SELECT set_config('app.tenant_id', $1, true)` بعد `validateTenantContext` — لا string interpolation.

## 10. نموذج الأدوار ✅
| الدور | الصلاحيات |
|-------|-----------|
| `sgip_owner` | NOLOGIN · NOSUPERUSER · NOBYPASSRLS — يملك المخطط |
| `sgip_migrator` | LOGIN · DDL فقط · NOSUPERUSER · NOBYPASSRLS |
| `sgip_app` | LOGIN · DML فقط · NOSUPERUSER · NOBYPASSRLS · **لا ملكية** |

## 11-12. نتائج البوابة الكاملة — 17/17

| # | الفحص | |
|:---:|-------|:---:|
| 1-3 | الأدوار الثلاثة بخصائصها الصحيحة | ✅ |
| 4-5 | `init.sql` ثم `rls.sql` ينفَّذان على قاعدة جديدة | ✅ |
| 6 | اكتشاف الجداول من الكتالوج (4 جداول) | ✅ |
| 7-9 | كل جدول tenant-scoped: RLS + FORCE + POLICY | ✅ |
| 10 | لا جدول يملكه دور التشغيل | ✅ |
| 11 | سجل الترحيلات مطابق ومستعلَم | ✅ |
| 12-15 | Tenant A لا يقرأ/يُدرج/يحدّث/يحذف بيانات B | ✅ |
| 16 | غياب سياق الكيان ⇒ صفر صفوف | ✅ |
| 17 | **NEGATIVE:** إزالة FORCE من جدول واحد **تُكتشف** | ✅ |

الاختبار السلبي يثبت أن الكاشف لا يُخدَع بـFORCE مكرر على جدول آخر.

---

## Baseline نهائي
| | |
|---|---|
| بلا PG | 27 suites · 847 ناجح · 1 متخطى |
| **مع PG حي** | **27 suites · 848/848 ناجح** |
| typecheck · build | 0 · exit 0 |
| الأدلة | `/tmp/gate_v2_results.json` · `/tmp/rls_inventory.json` |

## المخاطر المتبقية
| # | الخطر | التصنيف |
|:---:|-------|:---:|
| 1 | لم يُشغَّل `docker compose` فعلياً (لا Docker daemon هنا) — البوابة تُحاكي ترتيب initdb.d بدقة لكن لا تشغّل الحاوية | P1 |
| 2 | Prisma migrations لم تُنفَّذ في البوابة (البوابة تغطي init+rls؛ مرجع الترحيل الموحّد لم يُحسم بعد) | P1 |
| 3 | Source Registry فارغ | P1 (متوقع) |

**لا merge · لا deploy.**
