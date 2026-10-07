# SGIP — دليل التسليم والنشر الإنتاجي V4

**الحالة:** مؤهل تقنيًا ومقسى للنشر، لكن لم يتم إنشاء موارد سحابية فعلية أو نشر Production حتى الآن.  
**المسار المرجعي:** AWS / `me-south-1` وفق Terraform الحالي.  
**قاعدة القرار:** لا نشر ولا ترقية عند فشل أي بوابة إلزامية.

## 1. ما تم إثباته آليًا

تغطي بوابات GitHub الحالية:

- تثبيت الاعتماديات من lockfile.
- TypeScript typecheck وProduction build.
- Static Error Contract + Jest.
- PostgreSQL 16، الأدوار، migrations، checksums، RLS وFORCE RLS.
- Error Contract E2E في development وproduction وحالة database-down.
- Backend وUI production builds.
- فحص High/Critical npm advisories.
- بناء صورة Docker الإنتاجية وتشغيلها فعليًا ضد PostgreSQL 16.
- التحقق من `/health/ready` ومن startup integrity attestation.
- Terraform fmt/init/validate.
- Docker Compose production config validation.
- Kubernetes manifest parse validation.

الدمج إلى `main` لا يعني أن AWS أو DNS أو TLS أو النسخ الاحتياطي الفعلي قد تم إنشاؤها.

## 2. المسار الوحيد المعتمد لقاعدة البيانات

ملف `infra/postgres/init.sql` ليس مصدر schema معتمدًا للإنتاج. المسار المعتمد هو:

```bash
export POSTGRES_USER=...
export POSTGRES_DB=...
export APP_DB_PASSWORD=...
export MIGRATOR_DB_PASSWORD=...
export PGHOST=...
export PGPORT=5432

bash infra/postgres/05-create-roles.sh
bash infra/postgres/10-apply-migrations.sh
bash infra/postgres/20-create-app-role.sh
```

قواعد التشغيل:

- `sgip_owner`: مالك schema، `NOLOGIN`، ليس Superuser ولا BYPASSRLS.
- `sgip_migrator`: للتغييرات البنيوية فقط.
- `sgip_app`: Runtime فقط، ولا يملك صلاحية تجاوز RLS.
- التطبيق يتصل بواسطة `DATABASE_URL` الخاص بـ`sgip_app`.
- التطبيق **يتحقق** من migration ledger وRLS عند startup ولا يطبق DDL من Runtime.
- أي checksum mismatch أو migration ناقصة أو RLS غير مكتمل يمنع readiness.

## 3. صورة الإنتاج

`Dockerfile` هو المصدر المعتمد لبناء API.

```bash
docker build --pull -t sgip-api:<git-sha> .
```

الصورة:

- تستخدم Node.js 22.
- تعمل كمستخدم غير root.
- تحتوي `dist` وproduction dependencies و`db/migrations`.
- تستخدم `/health/ready` كـhealthcheck.
- لا تحتوي أسرارًا ثابتة.

يجب استخدام Git SHA أو digest غير قابل للتغيير بدل `latest`.

## 4. بنية AWS المرجعية

Terraform الحالي في:

`infra/terraform/aws/`

ويغطي بصورة مرجعية:

- VPC.
- EKS.
- RDS PostgreSQL.
- MSK Kafka.
- KMS.
- Security Groups.
- ECR immutable + scan-on-push.

إعداد EKS control-plane الافتراضي **Private**. لا يتم فتحه للعامة إلا بقرار واعتماد CIDRs محددة.

قبل `terraform apply` يجب أن توجد خارج المستودع:

- AWS account صالح.
- IAM/OIDC role للنشر.
- Terraform state backend المطلوب أو تعديل backend وفق بيئة الجهة.
- قيمة `db_password` من Secret Store، وليس Git.
- مراجعة Cost / Region / Data Residency / Network architecture.

أوامر التحقق قبل أي Apply:

```bash
cd infra/terraform/aws
terraform fmt -check
terraform init
terraform validate
terraform plan -out=tfplan
```

`terraform apply` لا ينفذ إلا بعد مراجعة الـplan واعتماد بشري للبنية والتكلفة.

## 5. أسرار Kubernetes

الـDeployment يتوقع Secret باسم:

`sgip-secrets`

بالمفاتيح التالية:

- `database-url` — إلزامي.
- `jwt-secret` — إلزامي.
- `jwt-refresh-secret` — إلزامي.
- `anthropic-api-key` — اختياري حسب تفعيل AI.
- `redis-url` — اختياري.
- `kafka-brokers` — اختياري حسب التكامل.
- `otel-endpoint` — اختياري.

يجب توفيرها من AWS Secrets Manager / External Secrets أو آلية مؤسسية مكافئة.  
**ممنوع** تسجيل قيم الأسرار في Git أو Terraform variables غير المحمية أو logs.

## 6. Kubernetes

المسار الحالي المعتمد:

`infra/kubernetes/deployment.yml`

ويحتوي:

- namespace production.
- restricted Pod Security.
- non-root runtime.
- read-only root filesystem.
- dropped Linux capabilities.
- readiness/liveness.
- HPA.
- PodDisruptionBudget.
- NetworkPolicy.

بعد توفير image URI الحقيقي وSecret:

```bash
kubectl apply -f infra/kubernetes/deployment.yml
kubectl -n sgip-production set image deployment/sgip-api \
  sgip-api=<ecr-repository>:<git-sha>
kubectl -n sgip-production rollout status deployment/sgip-api --timeout=10m
```

**ملاحظة:** مجلد Helm الحالي ليس مسار النشر المعتمد حتى يكتمل بقوالب Templates وتتم إضافة بوابة تحقق له.

## 7. فحوص ما بعد النشر

لا يعتبر Go-Live ناجحًا إلا بعد:

```bash
curl -fsS https://<api-domain>/health
curl -fsS https://<api-domain>/health/ready
```

ويجب أن يعيد readiness:

- `ready=true`
- `migrationsVerified=true`
- `rlsVerified=true`
- `roleVerified=true`
- `role=sgip_app`

ثم تنفذ اختبارات:

1. Login/JWT/refresh.
2. Tenant A لا يرى Tenant B.
3. CRUD governed mutations + audit atomicity.
4. Approval concurrency.
5. Error sanitization/correlation.
6. AI availability mapping إذا كان AI مفعلاً.
7. dashboard/readiness.
8. Smoke test للواجهة.

## 8. النسخ الاحتياطي والتعافي

Terraform يعرّف RDS backup retention، لكن وجود الإعداد في الكود **ليس إثبات Restore**.

قبل Go-Live العام يجب تنفيذ Restore Drill فعلي:

1. إنشاء backup/snapshot في البيئة المستهدفة.
2. استعادة قاعدة منفصلة.
3. تطبيق فحص migrations/checksums.
4. تشغيل RLS/tenant isolation.
5. التحقق من عينة governance/audit/evidence.
6. تسجيل RTO/RPO الفعليين.

بدون Restore Drill ناجح تكون الحالة `PRODUCTION DEPLOYED — DR NOT QUALIFIED` وليست `FULLY OPERATIONAL`.

## 9. الرصد والتشغيل

المطلوب في البيئة الفعلية:

- OpenTelemetry collector endpoint.
- centralized logs.
- metrics + alerting.
- alarms على:
  - readiness failures.
  - DB connection failures.
  - 5xx/error-contract anomalies.
  - authentication spikes.
  - RLS/startup attestation failures.
  - container restarts.
  - RDS storage/connections/CPU.
- incident owner ومسار escalation.
- retention وسياسة وصول للسجلات.

## 10. Rollback

يجب الاحتفاظ بصورة الإصدار السابق immutable.

عند فشل post-deployment smoke:

```bash
kubectl -n sgip-production rollout undo deployment/sgip-api
kubectl -n sgip-production rollout status deployment/sgip-api --timeout=10m
```

ولا يتم Rollback لقاعدة البيانات تلقائيًا. تغييرات schema تتبع سياسة forward-compatible migrations وخطة استعادة مستقلة.

## 11. بوابة القرار النهائية

| البوابة | شرط GO |
|---|---|
| Production Qualification | PASS |
| Release Hardening | PASS |
| High/Critical dependency gate | 0 |
| Production image readiness smoke | PASS |
| Terraform/Kubernetes validation | PASS |
| AWS target + IAM/OIDC | متوفر |
| Production secrets | متوفرة خارج Git |
| DNS/TLS | فعال |
| Production smoke | PASS |
| Tenant isolation on target | PASS |
| Backup restore drill | PASS |
| Monitoring/alerts | فعال |
| Rollback proof | PASS |

**قبل توفر البنود الخارجية:** `READY FOR DEPLOYMENT — EXTERNAL TARGET REQUIRED`.  
**بعد نجاحها فعليًا:** `READY FOR CONTROLLED PRODUCTION`.
