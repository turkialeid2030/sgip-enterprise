# Regulatory Foundation Correction — تقرير الموجة

## Baseline نهائي واحد (يلغي كل رقم سابق)

| البند | القيمة |
|-------|--------|
| بصمة المحتوى | `17ea7f4ebcca` (لا يوجد git repo — استُخدمت بصمة sha256 للمصدر) |
| الفرع | عمل محلي — لا merge ولا deploy |
| Suites / Tests | **25 / 821 — كلها ناجحة** |
| typecheck | 0 أخطاء |
| build | exit 0 |
| وقت التنفيذ | 2026-09-09T21:41Z (بدء التحقق) |

الأرقام 800/803 السابقة **ملغاة كحالة حالية**؛ 803 كان بعد إصلاح BLOCKER-1، و821 هو الحالي بعد هذه الموجة.

## تصحيح ادعاء RLS

| النمط | العدد |
|-------|:---:|
| `ENABLE ROW LEVEL SECURITY` | **18** |
| `CREATE POLICY` | **18** |
| **إجمالي عبارات RLS صريحة** | **36** |
| `FORCE ROW LEVEL SECURITY` | **0** ⚠ |
| مراجع `app.tenant_id` | 22 |

**رقم 55 كان خاطئاً** — نتج عن عدّ أسطر تطابق أياً من ثلاثة أنماط مختلفة ثم تسميتها كلها "عبارات RLS". العدد الصحيح 36 كما حسبته.

**الجداول المحمية (6):** GovernanceEntity · GovernanceDecision · FrameworkAssessment · MaturityScore · RACIEntry · CultureSignal

**فجوة جديدة مكتشفة (P1):** `FORCE ROW LEVEL SECURITY` غير مستخدم إطلاقاً → مالك الجدول يتجاوز RLS.

## الخطوة 1 — Canonical Entity Taxonomy ✅

كان هناك **مصدرا حقيقة متنافسان** كما رصدت:
- `runtime/nonprofit-assessment/entity.types.ts` → `charitable_assoc | cooperative_assoc | civil_assoc`
- `runtime/third-sector/...engine.ts` → `civil_association | cooperative_association`

**التصحيح:** `runtime/regulatory-core/canonical.entity.taxonomy.ts` — 8 أنواع قانونية موحّدة:
waqf · waqf_institution · civil_association · charitable_association · civil_institution · cooperative_association · nonprofit_company · grantmaking_entity

مع `LEGACY_ENTITY_TYPE_MAP` للتوافق، و`resolveEntityType()` تقبل الشكلين. الملف المنافس صار يعيد التصدير فقط ولا يعلن اتحاداً خاصاً به.

## الخطوة 3 — إزالة الجهة المشرفة من نوع الكيان ✅

**ما كان:** `regulator: string // the supervising authority as named by the user` — أي ادعاء تنظيمي بلا مصدر. أربع جهات مثبتة نصياً داخل تعريف النوع.

**ما صار:** `runtime/regulatory-core/authority.model.ts`
- `Authority` · `OfficialSource` · `ActivityClassification` · `SupervisoryRelationship`
- سبعة أدوار: REGULATOR · ADMINISTRATIVE_SUPERVISOR · FINANCIAL_SUPERVISOR · TECHNICAL_SUPERVISOR · LICENSING_AUTHORITY · REGISTRATION_AUTHORITY · OVERSIGHT_AUTHORITY
- Many-to-Many + شروط انطباق (نشاط · نطاق · حجم · إيراد) + تواريخ سريان
- `assertRelationship()` **يرفض** أي علاقة بلا مصدر مسجّل (`MISSING_SOURCE` / `UNKNOWN_SOURCE` / `UNKNOWN_AUTHORITY`)
- `resolveSupervision()` **fail-closed**: يعيد `INSUFFICIENT_AUTHORITATIVE_EVIDENCE` بدل إجابة فارغة كاذبة، و`REGULATORY_CONFLICT` عند تنازع جهتين على دور حصري

**السجل يبدأ فارغاً** — المنصة لا "تعرف" أي جهة مشرفة حتى يُسجَّل مصدر رسمي.

## الاختبارات المضافة (18)

`tests/regulatory.foundation.test.ts` — تشمل:
- رفض مصدر بلا مرجع · رفض علاقة بلا مصدر · رفض جهة غير مسجلة
- عدم رجعية تواريخ السريان
- تعدد الأدوار لنفس الكيان (many-to-many)
- الإشراف الفني المقيّد بالنشاط (صحي ≠ إسكاني)
- REGULATORY_CONFLICT عند جهتي تسجيل
- غياب حقل regulator عن كل نوع كيان
- تقاعد التصنيف المنافس

## الخطوة 2 — Official Regulatory Source Registry ⏸

البنية جاهزة ومختبرة وفارغة عمداً. تعبئتها تتطلب فتح الوثائق الحكومية الرسمية نفسها (لا snippets) — وأداة البحث لم تكن متاحة في هذه الجولة.

**المطلوب استخراجه لاحقاً:** المركز الوطني (نظام + لائحة تنفيذية + قواعد حوكمة + التصنيف التخصصي: 10 مجموعات و117+ تصنيف + تعريف الإشراف الفني) · الجمعيات التعاونية (نظام + لائحة + الجهة المشرفة الحالية) · الشركات غير الربحية (نظام الشركات م/132 + جهة التسجيل والإشراف) · الأوقاف (وثيقة المبادئ + نموذج التقييم + نظام الهيئة).

## الترتيب المتبقي
`Source Registry` → `RegulatoryRequirement Versioning` → `Digital Entity Profile` → `Applicability Engine` → `Evidence Validator` → `Fail-Closed AI Contract`

**لم يُبنَ AI Advisor** — ملتزم بالمنع حتى اكتمال الطبقات.
