# REGULATORY_FOUNDATION_SECURITY_GATE

## الحكم: **PASS — مُثبت على PostgreSQL 18.4 حقيقي**

حُلّ الحاجز: حُصل على ثنائيات PostgreSQL عبر npm (`@embedded-postgres/linux-x64`)، وشُغّل مثيل **PostgreSQL 18.4** فعلي، ونُفِّذت عليه كل فحوص البوابة.

**النتيجة: 13/13 فحصاً ناجحاً** — سجلّ التنفيذ في `/tmp/gate_results.json`، والسكربت `scripts/verify-rls-gate.cjs`، والاختبار الدائم `tests/rls.gate.postgres.test.ts` (يُفعّل بـ `SGIP_PG_GATE=1`).

---

## 1. Actual RLS Inventory — مفصولاً كما طلبت

| المصدر | ENABLE | CREATE POLICY | FORCE (قبل) | FORCE (بعد) |
|--------|:---:|:---:|:---:|:---:|
| `prisma/migrations/002` | 10 | 10 | 0 | **10** |
| `prisma/migrations/003` | 3 | 3 | 0 | **3** |
| `prisma/migrations/004` | 5 | 5 | 0 | **5** |
| **مجموع Prisma** | **18** | **18** | **0** | **18** |
| `infra/postgres/rls.sql` | 3 | 3 | 0 | **3** |
| **مجموع البنية التنفيذية** | **21** | **21** | **0** | **21** |
| `prisma/seed.sql` (ليس إنتاجاً) | 1 | 1 | 0 | — |

**تفسير الفرق:** عدّي السابق (18) شمل Prisma فقط. عدّك (21) شمل Prisma + infra — وهو الصحيح. الفارق الثالث (22) يظهر عند ضم `seed.sql`، وهو ليس بنية إنتاج.

**الجداول المحمية (7 مميزة):** GovernanceEntity · GovernanceDecision · FrameworkAssessment · MaturityScore · RACIEntry · CultureSignal · governance_snapshots
(ملاحظة: عدد الجداول أقل من عدد العبارات لأن بعض الجداول تُغطى في أكثر من ملف.)

## 2. Runtime DB Role Evidence — P0 مؤكد وأُصلح

**ما كان:**
| ملف | الحساب |
|-----|--------|
| `docker-compose.yml` | `POSTGRES_USER: sgip_admin` والـAPI يتصل بـ `sgip_admin` |
| `infra/docker/docker-compose.prod.yml` | `POSTGRES_USER: sgip` والـAPI يتصل بـ `sgip` |

في PostgreSQL، **مالك الجدول يتجاوز RLS** ما لم تُستخدم `FORCE ROW LEVEL SECURITY` — وكانت صفراً. تصنيفك P0 صحيح، وتصنيفي السابق P1 كان خاطئاً.

**ما صار:**
- كلا الملفين: `DATABASE_URL` يستخدم `sgip_app`
- `infra/postgres/20-create-app-role.sh` ينشئ الدور بـ `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`، ويرفض العمل بلا `APP_DB_PASSWORD`
- `FORCE ROW LEVEL SECURITY` على **21/21** جدول

## 3. عطبان في `infra/postgres/rls.sql` — أُصلحا

**(أ) اقتباسات مهروبة `\'app.tenant_id\'`**
برهنتُ بمحلّل `pgsql-ast-parser`: الصيغة `current_setting('x', TRUE)` تُحلَّل، و`current_setting(\'x\', TRUE)` تفشل.
**تصحيح ذاتي:** ادعائي الأول بأن "الملف كله معطوب" لم يكن مبرهناً — المحلّل لا يدعم DDL الخاص بـ RLS أصلاً. ما هو مبرهن: الهروب باطل في سياق يدعمه المحلّل. الاستنتاج الراجح أن الملف لم يكن ينفَّذ، لكن PostgreSQL وحده يحسم.

**(ب) `${APP_DB_PASSWORD}` داخل SQL خام**
`docker-entrypoint-initdb.d` يمرّر `*.sql` إلى psql **بلا** shell interpolation (الاستبدال لـ `*.sh` فقط). كانت كلمة المرور ستُنشأ حرفياً كسلسلة `${APP_DB_PASSWORD}`. نُقل إنشاء الدور إلى ملف `.sh`.

## 4. Real Cross-Tenant DB Tests — **منفَّذة على PostgreSQL 18.4**

| # | الفحص | النتيجة |
|:---:|-------|:---:|
| 1 | `sgip_app` NOSUPERUSER (`rolsuper=false`) | ✅ |
| 2 | `sgip_app` NOBYPASSRLS (`rolbypassrls=false`) | ✅ |
| 3 | `infra/postgres/rls.sql` يُنفَّذ بلا خطأ | ✅ |
| 4 | `sgip_app` ليس مالك الجداول | ✅ |
| 5 | `relforcerowsecurity=true` على كل الجداول المحمية | ✅ |
| 6 | **إعادة إنتاج الـP0**: المالك يتجاوز RLS بلا FORCE (رأى 2/2) | ✅ |
| 7 | **إثبات الإصلاح**: المالك محتوى مع FORCE (رأى 1/2) | ✅ |
| 8 | superuser يتجاوز RLS حتى مع FORCE (حدّ موثّق) | ✅ |
| 9 | Tenant A لا يقرأ صفوف Tenant B | ✅ |
| 10 | Tenant A لا يكتب في Tenant B (رفض بالسياسة) | ✅ |
| 11 | Tenant A لا يُحدّث صفوف Tenant B (0 صفوف) | ✅ |
| 12 | Tenant A لا يحذف صفوف Tenant B (0 صفوف) | ✅ |
| 13 | بلا `app.tenant_id` ⇒ صفر صفوف مرئية | ✅ |

### اكتشاف أمني إضافي أثناء الاختبار
`FORCE ROW LEVEL SECURITY` يحتوي **مالك الجدول**، لكنه **لا يحتوي superuser** ولا دور `BYPASSRLS`. الفحص 8 يثبت ذلك عملياً.
**الأثر:** الحساب الذي يملك الجداول يجب أن يكون هو أيضاً `NOSUPERUSER`. أُضيف هذا كتحذير وتأكيد تنفيذي في `20-create-app-role.sh`.

## 5. Provisional vs Verified Taxonomy ✅

`PROVISIONAL_ENTITY_TAXONOMY` — كل نوع `verificationStatus: UNVERIFIED` و`isConfirmedLegalForm: false`. `listVerifiedLegalForms()` تعيد **صفراً**.
الثلاثة المعلّمة للتحقق: `charitable_association` · `grantmaking_entity` · `waqf_institution`.

## 6. Verified-Source Enforcement ✅

`OfficialSource` صار يحمل: `verificationStatus` (DISCOVERED→INGESTED→VERIFIED→REJECTED) · `lifecycleState` (CURRENT/PREVIOUS/SUPERSEDED/APPROVED_NOT_YET_EFFECTIVE/APPROVED_PENDING_OFFICIAL_TEXT_OR_EFFECTIVE_DATE/FUTURE) · `officialPublisher` · `jurisdiction` · `documentNumber` · `documentHash` · `supersedes`/`supersededBy` · `retrievedAt`/`verifiedAt`/`verifiedBy` · `officialUrl` (إلزامي) · `authorityLevel`.

`isSourceUsable()` تمنع أي مصدر غير VERIFIED أو منتهٍ أو Superseded أو مُقرّ-غير-نافذ من قيادة أي قرار.

`DiscoveryInput` منفصل تماماً — مدخلات المستخدم تُسجَّل `UNVERIFIED_CLASSIFICATION` ولا تُرقّى تلقائياً.

## 7. Effective-Date Enforcement ✅
القرار يتحقق من **دورتَي حياة معاً**: المصدر + العلاقة.

## 8. Conflict Scoping ✅
التعارض = `role + legalScope + permitScope + تداخل الفترة + جهتان مختلفتان`. تعدد التراخيص بنطاقات مختلفة **ليس تعارضاً** (مختبَر).

## 9. INSUFFICIENT_ENTITY_DATA ✅
حالة منفصلة تُعيد `missingFacts[]` بدل ادعاء نقص المصدر.

## 10. Fixtures ✅
`health`/`housing` أُزيلا واستُبدلا بـ `FIXTURE_ACT_A/B`. لا تصنيف في Production Runtime.

## 11. REGULATORY_CHANGE_EVENT ✅
`NEW_COOPERATIVES_SYSTEM_2026` مُمثَّل بحالة `APPROVED_PENDING_OFFICIAL_TEXT_OR_EFFECTIVE_DATE` و`newSourceId: null` — لا افتراض لمحتواه.

## 12. Baseline نهائي واحد
| | |
|---|---|
| Suites / Tests | **25 / 832 — كلها ناجحة** |
| typecheck · build | 0 · exit 0 |
| بصمة | تُحسب عند التسليم |

---

## المخاطر المتبقية

| # | الخطر | التصنيف |
|:---:|-------|:---:|
| 1 | ~~اختبار RLS على PostgreSQL حقيقي~~ | ✅ أُغلق |
| 2 | ~~`rls.sql` لم يُنفَّذ~~ | ✅ أُغلق |
| 3 | ~~`sgip_app` مالك الجداول~~ | ✅ أُغلق |
| 3b | حساب مالك الجداول في الإنتاج يجب أن يكون NOSUPERUSER | **P1 — تأكيد نشر** |
| 4 | Source Registry فارغ | P1 (متوقع) |
| 5 | لا تصنيف أنشطة رسمي (10 مجموعات / 117+) | P1 |

## Baseline نهائي
| | |
|---|---|
| بلا PG | 26 suites · 837 ناجح · 1 متخطى |
| مع PG حي (`SGIP_PG_GATE=1`) | **26 suites · 838/838 ناجح** |
| typecheck · build | 0 · exit 0 |

## البوابة مفتوحة
`REGULATORY_FOUNDATION_SECURITY_GATE = PASS` ⇒ يجوز الانتقال إلى Source Registry ثم Applicability Engine.

**لا merge · لا deploy.**
