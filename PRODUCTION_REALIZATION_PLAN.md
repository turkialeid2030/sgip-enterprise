# SGIP V4 — خطة الاستكمال التشغيلي المعتمدة

**القرار الحالي:** `TECHNICALLY QUALIFIED / NOT YET DEPLOYED`  
**المرجع:** آخر Commit معتمد على `main` بعد اجتياز بوابتي `SGIP Production Qualification` و`SGIP Release Hardening`.  
**مهم:** نجاح GitHub Actions لا يثبت إنشاء الموارد السحابية، ولا تسجيل النطاق، ولا نجاح الاستعادة من نسخة احتياطية.

## المكتمل والمثبت

- اختبارات TypeScript وJest والبناء الإنتاجي والاختبارات الثابتة.
- E2E لحالات development وproduction وdatabase-down ضمن بيئة CI المعزولة.
- migrations + PostgreSQL + RLS + FORCE RLS والتحقق من صلاحية دور `sgip_app`.
- فحوص High/Critical للاعتماديات وصورة الحاوية.
- تشغيل صورة Docker في CI والتحقق من `/health/ready`.
- Terraform format/init/validate، وتحليل Kubernetes وCompose.
- تجهيز نشر صورة ذات وسم Commit SHA على GHCR، مشروط بنجاح **البوابتين معًا للنسخة نفسها**. لا تعني جاهزية هذا المسار وجود صورة منشورة قبل نجاح GitHub Actions الخاص بالنشر.

## المرحلة الخارجية المتبقية

| المهمة | المسؤول | إثبات الإغلاق | الحالة |
|---|---|---|---|
| اعتماد حساب AWS والمنطقة والتكلفة والهوية المصرح لها | مالك الحساب / المالية / الأمن | Account ID + approved cost plan | مطلوب |
| إعداد Terraform S3 state backend وIAM/OIDC وrunner له وصول خاص | مهندس المنصة | CI plan + IAM least privilege | مطلوب |
| إنشاء VPC/EKS/RDS/ECR/KMS وما يلزم | مسؤول AWS بعد اعتماد التكلفة | Terraform apply logs + resource inventory | غير منفذ |
| توفير Secrets Manager وDB roles دون وضع أسرار في Git | أمن المعلومات + DBA | Secrets references + role verification | غير منفذ |
| نشر صورة Digest معروفة على EKS | فريق DevOps | image digest + rollout status | غير منفذ |
| DNS وTLS والواجهات والصلاحيات | DevOps / الشبكات | شهادة صالحة + DNS test | غير منفذ |
| تشغيل smoke/E2E وعزل المستأجرين على الهدف | QA + الأمن | signed run report | غير منفذ |
| نسخ احتياطي واستعادة فعليان وقياس RTO/RPO | DBA / الاستمرارية | Restore drill evidence | غير منفذ |
| قياس/تنبيهات/سجلات ومناوبة تشغيل وRollback تجريبي | SRE | alert delivery + rollback proof | غير منفذ |
| الموافقة النهائية Go-Live | مالك المنتج + أمن المعلومات + التشغيل | محضر GO موقع | معلق |

## تسلسل التنفيذ

1. إقرار الحساب والمنطقة والتكلفة والمسؤوليات؛ وعدم إرسال مفاتيح سرية إلى المحادثة أو Git.
2. تجهيز IAM/OIDC الخاص بـGitHub Actions أو منصة نشر داخل VPC، وسياسة الأقل صلاحية.
3. تشغيل `terraform plan` ومراجعة الخطة أمنيًا وماليًا؛ تطبيق `terraform apply` **فقط** بعد الاعتماد.
4. إنشاء قاعدة البيانات وتطبيق المسار المعتمد في `infra/postgres/` بواسطة migrator، وليس مستخدم Runtime.
5. نشر صورة معروفة بـSHA أو Digest، ثم فحص readiness وTenant Isolation وError Contract على الهدف.
6. توثيق Restore Drill وRollback وDNS/TLS والرصد والتنبيهات.
7. إصدار قرار `GO` أو `HOLD` مستند إلى الأدلة.

## ضوابط إيقاف حاكمة

- لا يجوز استخدام `qualification-placeholder` أو وسوم `latest` للنشر.
- لا يجوز اعتماد نتيجة CI المحلية كدليل استعادة قاعدة بيانات إنتاجية.
- لا يجوز إسناد صلاحيات `SUPERUSER` أو `BYPASSRLS` إلى دور التطبيق.
- عدم وجود AWS فعلي أو أسرار أو صلاحيات أو موازن حمل لا يُعالج بادعاء أنه «تم النشر».
- أي فشل في اتصال Tenant A بحدود Tenant B أو أي تسريب للبيانات يفرض `HOLD` فورًا.

## الملفات المرجعية

- `infra/DEPLOYMENT.md` — عقد النشر المعتمد.
- `PRODUCTION_HANDOFF.md` — قائمة التحقق وأوامر الفريق.
- `infra/terraform/aws/` — البنية المرجعية، وليست دليلًا على وجودها.
- `.github/workflows/sgip-qualification.yml` — بوابة التأهيل.
- `.github/workflows/sgip-release-hardening.yml` — بوابة التحصين.
- `.github/workflows/sgip-publish-qualified-container.yml` — صورة قابلة للتتبع بعد نجاح البوابتين.

**التصنيف الصحيح قبل إنشاء البنية السحابية والتحقق منها:** `READY FOR DEPLOYMENT — EXTERNAL TARGET REQUIRED`.
