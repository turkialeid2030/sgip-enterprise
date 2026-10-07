# SGIP Sovereign GRC OS — Production Handoff Guide
## دليل التسليم الإنتاجي | منصة الحوكمة السيادية

**Version:** 8.0 | **Baseline:** Frozen 2026-05-28 | **Readiness:** 92/100

---

## Step-by-Step Execution Sequence

### Step 1 — Cloud Account & Foundation

Choose one:
- **AWS** (recommended): `me-south-1` (Bahrain) or `ap-southeast-1`
- **OCI**: Saudi Arabia West (Jeddah) region

```bash
# Provision via Terraform
cd infra/terraform/aws
cp terraform.tfvars.example terraform.tfvars   # fill in variables
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
# Creates: VPC, EKS 1.29, RDS PostgreSQL 16 HA, MSK Kafka 3.6, ElastiCache Redis 7
```

---

### Step 2 — PostgreSQL Live (+3 readiness points)

```bash
# Set connection string
export DATABASE_URL="postgresql://sgip_admin:PASSWORD@RDS_ENDPOINT:5432/sgip_prod?sslmode=require"

# Run migrations (idempotent)
psql $DATABASE_URL -f infra/postgres/init.sql
psql $DATABASE_URL -f infra/postgres/rls.sql

# Verify RLS isolation
psql $DATABASE_URL << 'SQL'
  BEGIN;
  SET LOCAL app.tenant_id = 'tenant-test-a';
  INSERT INTO governance_events(tenant_id, entity_type, entity_id, topic, payload, actor_id, actor_role, hash, previous_hash)
  VALUES ('tenant-test-a', 'test', 'e1', 'test.event', '{}', 'sys', 'system', 'abc', 'GENESIS');
  -- Switch tenant — must see 0 rows from tenant-a
  SET LOCAL app.tenant_id = 'tenant-test-b';
  SELECT COUNT(*) FROM governance_events;   -- must return 0
  ROLLBACK;
SQL
```

**Code change required:** None. `ProductionPersistenceAdapter` auto-activates when `DATABASE_URL` is set.

---

### Step 3 — Kafka/NATS Event Bus (+2 readiness points)

```bash
# Option A: AWS MSK (provisioned by Terraform in Step 1)
export KAFKA_BROKERS="broker1.kafka.internal:9092,broker2.kafka.internal:9092,broker3.kafka.internal:9092"

# Option B: Docker Compose (staging/dev)
docker compose -f infra/docker/docker-compose.prod.yml up kafka -d

# Create governance topics
kafka-topics.sh --bootstrap-server $KAFKA_BROKERS \
  --create --topic governance.events \
  --partitions 12 --replication-factor 3 \
  --config retention.ms=604800000 \
  --config min.insync.replicas=2

kafka-topics.sh --bootstrap-server $KAFKA_BROKERS \
  --create --topic governance.dlq \
  --partitions 3 --replication-factor 3
```

---

### Step 4 — JWT Refresh Tokens (+2 readiness points)

**One file change, ~15 lines:**

```typescript
// api/routes/auth.routes.ts — add after existing login route:
authRouter.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;
  if (!refreshToken) { res.status(401).json({ error: "Refresh token required" }); return; }
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as JWTPayload;
    const newToken = jwt.sign(
      { userId: payload.userId, tenantId: payload.tenantId, role: payload.role, email: payload.email, nameAr: payload.nameAr },
      process.env.JWT_SECRET!,
      { expiresIn: "15m" }
    );
    res.json({ token: newToken, expiresIn: "15m" });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});
```

---

### Step 5 — OpenTelemetry SDK (+1 readiness point)

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/exporter-otlp-grpc \
  @opentelemetry/instrumentation-express \
  @opentelemetry/instrumentation-http \
  @opentelemetry/instrumentation-pg

# Config already at: infra/observability/otel-config.yml
# Add to api/server.ts line 1:
# import './telemetry';
```

---

### Step 6 — Kubernetes Deployment

```bash
# Namespace
kubectl create namespace sgip-production

# Secrets
kubectl create secret generic sgip-api-secrets \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -n sgip-production

# Deploy
kubectl apply -f infra/kubernetes/deployment.yml

# Verify
kubectl rollout status deployment/sgip-api -n sgip-production
kubectl get pods -n sgip-production

# Health check
kubectl port-forward svc/sgip-api 4000:4000 -n sgip-production &
curl http://localhost:4000/health
# → { "status": "healthy", "version": "8.0" }
```

**Helm alternative:**
```bash
helm upgrade --install sgip-api infra/helm/sgip-api/ \
  -n sgip-production \
  --set image.tag=8.0 \
  --set env.DATABASE_URL="$DATABASE_URL"
```

**GitOps via ArgoCD:**
```bash
kubectl apply -f infra/argocd/application.yml
# ArgoCD auto-syncs from Git on every push to main
```

---

### Step 7 — DNS & TLS

```bash
# Point DNS records:
api.sgip.yourdomain.com    →  Load Balancer external IP
board.sgip.yourdomain.com  →  Load Balancer external IP

# cert-manager (TLS auto-provisioning — already configured in Helm values.yaml)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml

# ClusterIssuer for Let's Encrypt:
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

---

### Step 8 — Vault / Secret Rotation

```bash
# Deploy Vault (or use AWS Secrets Manager)
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install vault hashicorp/vault -n vault --create-namespace

# Configure Kubernetes auth
vault auth enable kubernetes
vault write auth/kubernetes/config \
  kubernetes_host="https://$KUBERNETES_PORT_443_TCP_ADDR:443"

# Create secret engine for SGIP
vault secrets enable -path=secret kv-v2
vault kv put secret/sgip/production/config \
  DATABASE_URL="$DATABASE_URL" \
  JWT_SECRET="$(openssl rand -hex 32)"

# Vault agent injection already configured in Helm values.yaml:
# vault.hashicorp.com/agent-inject: "true"
# vault.hashicorp.com/role: "sgip-api"
```

---

### Step 9 — Observability (Grafana / Prometheus / Jaeger)

```bash
# All services configured in docker-compose.prod.yml
docker compose -f infra/docker/docker-compose.prod.yml up \
  otel-collector prometheus grafana -d

# Access:
#   Grafana:    http://localhost:3000  (admin / $GRAFANA_PASSWORD)
#   Prometheus: http://localhost:9090
#   Jaeger:     http://localhost:16686

# For Kubernetes, deploy via Helm:
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install monitoring prometheus-community/kube-prometheus-stack -n monitoring
```

---

### Step 10 — Post-Deployment Validation

```bash
# 1. Integrity certification (full 8-check validation)
curl -X POST https://api.sgip.yourdomain.com/api/executive/integrity-certification \
  -H "Authorization: Bearer $TOKEN"
# Expected: { "status": "certified", "overallScore": 95+ }

# 2. Governance cockpit
curl https://api.sgip.yourdomain.com/api/executive/cockpit \
  -H "Authorization: Bearer $TOKEN"

# 3. Tenant isolation
# Register two tenants with different JWTs, verify zero data leakage

# 4. Autonomous governance cycle
curl https://api.sgip.yourdomain.com/api/executive/autonomous-governance \
  -H "Authorization: Bearer $TOKEN"

# 5. Digital twin simulation
curl -X POST https://api.sgip.yourdomain.com/api/executive/digital-twin/simulate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"scenario":"cyber_attack"}'

# 6. Load sector pack
curl "https://api.sgip.yourdomain.com/api/executive/sector-pack?sector=banking" \
  -H "Authorization: Bearer $TOKEN"
```

---

### Step 11 — Backup & DR

```bash
# PostgreSQL PITR already configured via RDS (35-day retention)
# Manual backup:
pg_dump $DATABASE_URL > sgip_backup_$(date +%Y%m%d).sql

# DR simulation via Digital Twin:
curl -X POST .../api/executive/digital-twin/simulate \
  -d '{"scenario":"cyber_attack"}'
# Returns: financial impact, recovery timeline, critical path

# Verify governance replay:
curl -X POST .../api/persistence/snapshots \
  -H "Authorization: Bearer $TOKEN"
```

---

## Deployment Timeline Estimate

| Phase | Duration |
|-------|---------|
| Cloud account + VPC + IAM | 1–2 days |
| RDS PostgreSQL + migrations | 4 hours |
| Kafka MSK + topics | 4 hours |
| EKS + deploy + secrets | 1 day |
| DNS + TLS + WAF | 4 hours |
| Vault + secret rotation | 1–2 days |
| OTel + Grafana | 4 hours |
| JWT refresh token | 2 hours |
| Frontend build + deploy | 1–2 days |
| Testing + validation | 1 day |
| **Total** | **~5–8 working days** |
