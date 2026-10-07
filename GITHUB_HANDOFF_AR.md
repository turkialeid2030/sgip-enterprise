# SGIP — تسليم GitHub والتأهيل الإنتاجي

## الحالة
- المرشح الحالي مبني على V3 المصححة.
- الاختبارات المركزة المحلية: 935 تحققًا ناجحًا.
- لا يجوز الدمج أو النشر قبل نجاح Workflow `SGIP Production Qualification` بالكامل.

## ما يفعله Workflow
1. `npm ci`
2. full typecheck
3. production build
4. Error Contract static guard
5. Jest مع `--detectOpenHandles`
6. npm audit بمستوى High
7. PostgreSQL 16 مع migrations/roles/RLS semantic verification
8. authoritative Error Contract E2E
9. exact JSON acceptance
10. fail-closed Release Gate

## حاجز متعمد
المصدر المتاح لا يحتوي `scripts/verify-error-contract-e2e.cjs` الأصلي. لذلك وظيفة `error-contract-e2e` ستفشل عمدًا ولا يمكن أن يصبح Release Gate أخضر حتى يتم استعادة/إضافة الـharness المرجعي نفسه أو بديل معتمد ومكافئ وظيفيًا.

## سياسة الدمج
- الفرع المقترح: `release/sgip-v4-qualification`
- PR يبقى Draft حتى جميع checks خضراء.
- لا Auto-Merge قبل: PostgreSQL + Error Contract E2E + exact JSON acceptance.
- لا Deploy من هذا الفرع مباشرة.

## حالة GitHub المتصل بتاريخ 2026-10-06
لم يظهر مستودع SGIP ضمن الحساب المتصل `turkialeid2030`، ولم يظهر الكود عند البحث عن `@sgip/enterprise` أو `verify-error-contract-static.cjs` أو `CONCURRENT_APPROVAL_STATE_CHANGED`.
لذلك لا ينبغي دفع هذه الحزمة إلى مستودعات Startak/FAD الموجودة لأنها مشاريع مختلفة.
