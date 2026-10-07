# SGIP V4 — Production Deployment Contract

## Authoritative gates

A production deployment is permitted only from a commit on `main` for which both workflows pass:

- `SGIP Production Qualification`
- `SGIP Release Hardening`

The deployment is fail-closed. Kubernetes deliberately contains the image tag `qualification-placeholder`; the deploy process must replace it with the exact qualified Git SHA or immutable registry digest.

## Authoritative database path

Do not use legacy Prisma migration commands and do not apply ad-hoc DDL from the application runtime.

```bash
bash infra/postgres/05-create-roles.sh
bash infra/postgres/10-apply-migrations.sh
bash infra/postgres/20-create-app-role.sh
```

The runtime connection must use `sgip_app`, with no SUPERUSER and no BYPASSRLS.

## Image

Build from the qualified commit:

```bash
docker build --pull --target production -t <registry>/sgip-enterprise:<git-sha> .
```

Use an immutable tag/digest. The image runs as the non-root `sgip` user and includes the authoritative migration manifest used by startup integrity attestation.

## AWS

Reference Terraform is under `infra/terraform/aws`.

Backend coordinates are intentionally not stored in source. Provide the approved S3 state backend at init time. The EKS version is also an explicit deployment input.

```bash
cd infra/terraform/aws
terraform fmt -check
terraform init -backend-config=<approved-backend.hcl>
terraform validate
terraform plan -var='eks_cluster_version=<approved-version>' -out=tfplan
```

No `terraform apply` is authorized without review of the plan, target account, region, IAM/OIDC roles, expected spend, and data-residency requirements.

EKS control-plane public access is disabled by default. World CIDRs are rejected.

## Kubernetes

`infra/kubernetes/deployment.yml` is the authoritative baseline. `infra/kubernetes/kustomization.yaml` is the image substitution point.

Required secret keys in `sgip-secrets`:

- `database-url`
- `jwt-secret`
- `jwt-refresh-secret`

Optional integration keys:

- `anthropic-api-key`
- `redis-url`
- `kafka-brokers`
- `otel-endpoint`

Before apply, replace `qualification-placeholder` with the exact qualified image tag or digest.

## Production acceptance

Go-live is not complete until the target environment proves all of the following:

1. `/health/ready` returns `ready=true`.
2. `migrationsVerified=true`.
3. `rlsVerified=true`.
4. `roleVerified=true` and `role=sgip_app`.
5. Tenant A cannot read Tenant B.
6. Error Contract E2E passes in the target environment.
7. TLS/DNS are active.
8. Central logging, metrics and alerts are active.
9. Backup restore drill succeeds and measured RTO/RPO are recorded.
10. Rollback to the previous immutable image is demonstrated.

Until those external proofs exist, the correct state is:

`READY FOR DEPLOYMENT — EXTERNAL TARGET REQUIRED`

After they pass:

`READY FOR CONTROLLED PRODUCTION`
