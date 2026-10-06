# FOUNDATION_BASELINE_FINAL — V5.2A

## Executive Verdict

**`FOUNDATION_BASELINE = CODE_GATE_PASS`**
**`FOUNDATION_LOCKED = TRUE`**
**`DOCKER_RUNTIME_VALIDATION_PENDING`** — Docker daemon فقط
**P0 = صفر**

> الـhash في `MANIFEST.sha256` **خارج** الحزمة، يُحسب بعد إنشائها.

---

## AUDIT_ATOMICITY_COVERAGE

**الإثبات تنفيذي لا نصّي.** أُزيل الكاشف القائم على regex/نافذة أسطر — كان يستعير الدليل من معالِج مجاور ولا يثبت شيئاً عن وقت التشغيل. حلّ محلّه `api/contracts/critical.mutations.ts` (بيان صريح) + حقن فشل حقيقي: **سحب صلاحية `INSERT` على `AuditLog` من دور التشغيل**.

| Operation | State Mutation | Audit Required | Atomic | Same Tx Proven | Test Result |
|-----------|:---:|:---:|:---:|:---:|---|
| `POST /api/entities` | GovernanceEntity | نعم | `auditedMutation` | `EntityDAO.createIn(tx)` | **503 · لا صف** |
| `PATCH /api/entities/:id` | GovernanceEntity | نعم | `auditedMutation` | UPDATE على نفس tx | **503 · العنوان لم يتغيّر** |
| `DELETE /api/entities/:id` | GovernanceEntity | نعم | `auditedMutation` | UPDATE على نفس tx | ✅ |
| `POST /api/graph/edge` | GraphEdge | نعم | `auditedMutation` | INSERT على نفس tx | **503 · لا حافة** |
| `POST /api/policies` | GovernancePolicy | نعم | `auditedMutation` | `PolicyService.createIn(tx)` | **503 · لا سياسة** |
| `PATCH /:id/activate` | GovernancePolicy | نعم | `auditedMutation` | `activateIn(tx)` | ✅ |
| `PATCH /:id/retire` | GovernancePolicy | نعم | `auditedMutation` | `retireIn(tx)` | ✅ |
| `POST /api/approvals` | ApprovalRequest | نعم | `auditedMutation` | `createRequest(…, tx)` | **503 · لا طلب** |
| `PATCH /:id/decide` | ApprovalRequest | نعم | `auditedMutation` | `processDecision(…, tx)` | ✅ |
| `POST /api/auth/register` | User | نعم | `auditedMutation` | INSERT على نفس tx | ✅ |
| `POST /api/auth/login` | — | **SECURITY_TELEMETRY** | لا | — | مُصنَّف صراحةً |
| `POST /api/auth/refresh` | — | **SECURITY_TELEMETRY** | لا | — | مُصنَّف صراحةً |
| `POST /api/auth/logout` | — | **SECURITY_TELEMETRY** | لا | — | مُصنَّف صراحةً |

**تبرير تصنيف SECURITY_TELEMETRY:** `lastLoginAt` قياس لا حالة حوكمة؛ ورفض مصادقة صحيحة لأن صفّ قياس تعذّرت كتابته يُنتج حجب خدمة. مُوثَّق في البيان، لا مُتجاهَل.

### أدلة حقن الفشل
```
--- AuditLog INSERT revoked ---
entity.create=503  entity.update=503  graph.edge.create=503
policy.create=503  approval.create=503
لا صف أعمال أُنشئ    : entities 2->2  edges 1->1  policies 0->0  approvals 0->0
العنوان لم يتغيّر     : "Entity A1"
لا صف تدقيق أُنشئ    : audits 5->5
--- restored ---
mutations succeed again : 201
```

**الثابت:** `at most ONE active policy per (tenant, code)` — مفروض على طبقتين: `UNIQUE("tenantId", code)` في المخطط، و`activateIn()` يُلغي أي نسخة نشطة أخرى **داخل نفس المعاملة**. مُثبت: `activeVersions=1`.

---

## GRAPH_PERSISTENCE_EVIDENCE

النجاح داخل نفس الكيان **أولاً**، ثم العزل — لا يُستخدم فشل العزل كإثبات أن الكتابة تعمل.

| # | | الدليل |
|:---:|---|---|
| 1 | Entity A1 | `201` |
| 2 | Entity A2 | `201` |
| 3 | **POST edge A1→A2** | **`201`** — لا 400/404/422 مقبول |
| 4 | الحافة في PostgreSQL | `rows=1` تحت tenant-a |
| 5 | ظاهرة عبر Graph API | `200 · containsTarget=true` |
| 6 | **بعد إعادة تشغيل كاملة** | `dbRows=1 · api=200` |
| 7 | Entity B1 في tenant B | `201` |
| 8 | A لا ينشئ حافة إلى B | `404` |
| 9 | B لا يقرأ عقدة A | `404 · leaked=false` |
| 10 | B يرى صفر حواف لـA في القاعدة | `rows=0` |

---

## Baseline
| | |
|---|---|
| بلا PG | 26 suites · 855 ناجح · 1 متخطى |
| **مع PG حي** | **26 suites · 856/856** |
| **AUDIT+GRAPH** | **19/19** |
| Gate V3 | **30/30** |
| E2E (إنتاج) | **28/28** |
| RLS inventory · tenancy | PASS · 29/29 محكوم |
| typecheck · build | 0 · exit 0 |

## ملاحظات منهجية (تصحيحات ذاتية)
1. أول تشغيل أعطى "نجاحات" زائفة سببها أن المستخدم المزروع بدور `admin` لا يملك `graph:write` — فكانت 403 تُقرأ كعزل. صُحّح إلى `governance_analyst` فأصبحت الفحوص ذات معنى.
2. `approval.create` كان يُرجع `422` (فشل تحقق قبل الوصول لمسار التدقيق) — فلم يكن يختبر الذرّية. صُحّح جسم الطلب فصار `503`.
3. الـmocks كانت تعيد `[]` من `tx.query`، وهو نمذجة لإدخال فاشل. السلوك الإنتاجي (رفض إدخال بلا صف مُعاد) صحيح — أُصلح التمويه لا النظام.

## المخاطر المتبقية — لا P0
| # | | التصنيف |
|:---:|---|:---:|
| 1 | `docker compose config/up` — لا Docker daemon | DOCKER_PENDING |
| 2 | `psql` غير مشحون؛ منطق الـrunner مُحاكى بدقة | P1 |
| 3 | SSL/certificates | P2 |
| 4 | `prisma/migrations` كأثر تاريخي | P3 |

---

**`FOUNDATION_LOCKED = TRUE`** — لا يُعاد فتحها إلا بـP0 جديد مُثبت بالتشغيل.
الانتقال إلى **`REGULATORY_SOURCE_DISCOVERY`**.

**لا merge · لا deploy · لا AI Advisor.**
