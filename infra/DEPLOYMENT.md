# SGIP V4 Deployment

The authoritative application qualification gate is `.github/workflows/sgip-qualification.yml`.

## Release invariant

A production deployment is permitted only from a commit on `main` whose qualification workflow has passed. The Kubernetes baseline deliberately uses the image tag `qualification-placeholder`; the deployment pipeline must replace it with the exact qualified Git SHA before applying the manifest.

## Required runtime secrets

The target Kubernetes namespace must provide a `sgip-secrets` Secret containing at least:

- `database-url`
- `jwt-secret`
- `jwt-refresh-secret`

Optional integrations use:

- `anthropic-api-key`
- `kafka-brokers`
- `redis-url`
- `otel-endpoint`

Do not commit secret values to this repository.

## AWS/Terraform

Terraform state coordinates are intentionally not hard-coded. Supply the S3 backend configuration explicitly at `terraform init`. The EKS Kubernetes version and endpoint CIDRs are also explicit deployment inputs; public-world CIDRs are rejected.

## Helm status

`infra/helm/sgip-api` is retained as packaging metadata/values only. It has no templates and is **not** the authoritative production deployment path. The current authoritative manifest path is `infra/kubernetes` via Kustomize.
