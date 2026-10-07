# SGIP Sovereign GRC OS — Production Realization Plan

## Current State
- 716/716 tests passing
- 0 TypeScript errors  
- 363 TypeScript files
- 33 Executive API endpoints
- 70+ Runtime engines
- Production readiness: 92/100

## Remaining 8 Points (Infra Gaps)

### P0: PostgreSQL Live (+3 pts)
**Action:** `docker compose -f infra/docker/docker-compose.prod.yml up postgres`
**Verify:** `psql $DATABASE_URL -c "SELECT current_setting('app.tenant_id', TRUE)"`
**Terraform:** `infra/terraform/aws/main.tf` → `module.rds`

### P1: Kafka/NATS Event Bus (+2 pts)  
**Action:** `docker compose up kafka`
**Topics to create:**
```
kafka-topics.sh --create --topic governance.events --partitions 12 --replication-factor 3
kafka-topics.sh --create --topic governance.dlq --partitions 3
```

### P1: JWT Refresh Tokens (+2 pts)
**Action:** Add endpoint `POST /api/auth/refresh`
**Est. effort:** 2 hours

### P2: OpenTelemetry SDK (+1 pt)
**Action:** `npm install @opentelemetry/sdk-node @opentelemetry/exporter-otlp-grpc`
**Config:** `infra/observability/otel-config.yml` ready

## Deployment Commands

```bash
# Option A: Docker Compose (fastest)
cp .env.example .env   # Fill in secrets
docker compose -f infra/docker/docker-compose.prod.yml up -d
npm test  # Verify 716/716 still pass against live DB

# Option B: Kubernetes (production)
kubectl apply -f infra/kubernetes/deployment.yml
helm upgrade --install sgip-api infra/helm/sgip-api/ -n sgip-production -f infra/helm/sgip-api/values.yaml

# Option C: Terraform full stack (AWS)
cd infra/terraform/aws
terraform init
terraform apply -var-file=prod.tfvars
```

## Post-Deployment Verification

```bash
# 1. Health check
curl https://api.sgip.internal/health
# → {"status":"healthy","version":"8.0","uptime":...}

# 2. Integrity certification
curl -X POST https://api.sgip.internal/api/executive/integrity-certification \
  -H "Authorization: Bearer $TOKEN"
# → {"status":"certified","overallScore":92}

# 3. Full governance cycle
curl https://api.sgip.internal/api/executive/cockpit \
  -H "Authorization: Bearer $TOKEN"
# → Complete governance state

# 4. Tenant isolation test
# Create two tenants, verify no cross-tenant data leakage
```
