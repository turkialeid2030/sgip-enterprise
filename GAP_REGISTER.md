# SGIP Sovereign GRC OS — Gap Register
## سجل الفجوات | منصة الحوكمة السيادية

**Date:** 2026-05-28 | **Version:** 8.0 | **Current Readiness:** 92/100

---

## Priority Legend

| Level | Meaning | Criteria |
|-------|---------|---------|
| **P0** | Launch blocker | Data loss or security risk without it |
| **P1** | Pre-first-tenant | Significant functional gap |
| **P2** | Within 30 days | Operational quality risk |
| **P3** | Within 90 days | Feature completeness |

---

## P0 — Launch Blockers

### GAP-001 · PostgreSQL Live Connection

| Field | Detail |
|-------|--------|
| **ID** | GAP-001 |
| **Priority** | P0 |
| **Severity** | Critical |
| **Points at Stake** | +3 production readiness pts → 95/100 |
| **Impact** | All data lost on every restart. Tenant isolation untested at DB level. Multi-tenant RLS not active. |
| **Current State** | `ProductionPersistenceAdapter` built with full RLS support. Falls back to `InMemoryPersistenceAdapter` when `DATABASE_URL` is absent. All migrations written: `infra/postgres/init.sql` + `infra/postgres/rls.sql`. |
| **Required Action** | Set `DATABASE_URL` env var. Run `init.sql` + `rls.sql`. No code changes needed. |
| **Owner** | DevOps / Platform Team |
| **Effort** | 4 hours (infra only) |

---

### GAP-002 · Kafka/NATS Event Bus Not Live

| Field | Detail |
|-------|--------|
| **ID** | GAP-002 |
| **Priority** | P0 |
| **Severity** | High |
| **Points at Stake** | +2 production readiness pts → 97/100 |
| **Impact** | Governance events do not survive application restarts. No cross-service streaming. No event replay from durable log. |
| **Current State** | Hash-chained in-process event store works correctly for business logic and test verification. Kafka Docker config and MSK Terraform module written and ready. |
| **Required Action** | Deploy Kafka (MSK or `docker compose up kafka`). Set `KAFKA_BROKERS`. Create `governance.events` + `governance.dlq` topics. |
| **Owner** | Backend + Platform Team |
| **Effort** | 1 day (infra) + 4 hours (wire adapter) |

---

## P1 — Before First Tenant

### GAP-003 · JWT Refresh Tokens Missing

| Field | Detail |
|-------|--------|
| **ID** | GAP-003 |
| **Priority** | P1 |
| **Severity** | High |
| **Points at Stake** | +2 production readiness pts |
| **Impact** | All user sessions expire every 1 hour with no silent renewal. Forces re-login. Unacceptable for continuous governance monitoring. |
| **Current State** | JWT issuance (`POST /api/auth/login`) works fully. Refresh endpoint not implemented. |
| **Required Action** | Add `POST /api/auth/refresh` — 15-line implementation shown in `PRODUCTION_HANDOFF.md`. |
| **Owner** | Backend Team |
| **Effort** | 2 hours |

---

### GAP-004 · Frontend Not Deployed

| Field | Detail |
|-------|--------|
| **ID** | GAP-004 |
| **Priority** | P1 |
| **Severity** | High |
| **Points at Stake** | User-facing access |
| **Impact** | No UI. Executives cannot access cockpit without direct API calls. |
| **Current State** | Full React cockpit built: Board, CEO, CRO, AI Gov, Digital Twin views. Bilingual AR/EN with RTL/LTR. Connects to all 33 API endpoints. Files at `ui-shell/src/SGIPCockpit.jsx` and `ui-shell/src/i18n/`. |
| **Required Action** | `npm run build` in `ui-shell/` → serve static files via nginx or CDN (S3 + CloudFront / Cloudflare). |
| **Owner** | Frontend Team |
| **Effort** | 1–2 days (build pipeline + deploy) |

---

## P2 — Within 30 Days

### GAP-005 · OpenTelemetry SDK Not Installed

| Field | Detail |
|-------|--------|
| **ID** | GAP-005 |
| **Priority** | P2 |
| **Severity** | Medium |
| **Points at Stake** | +1 production readiness pt → 98/100 |
| **Impact** | No distributed tracing. No governance telemetry. Debugging production issues requires log scanning only. |
| **Current State** | OTel collector config at `infra/observability/otel-config.yml`. Prometheus + Grafana in `docker-compose.prod.yml`. SDK packages not installed. |
| **Required Action** | `npm install @opentelemetry/sdk-node @opentelemetry/exporter-otlp-grpc`. Add `import './telemetry'` to `api/server.ts`. |
| **Owner** | Backend Team |
| **Effort** | 4 hours |

---

### GAP-006 · mTLS Between Services

| Field | Detail |
|-------|--------|
| **ID** | GAP-006 |
| **Priority** | P2 |
| **Severity** | Medium |
| **Impact** | Internal service-to-service calls not mutually authenticated. Risk if egress controls fail. |
| **Current State** | Kubernetes `NetworkPolicy` restricts pod-to-pod traffic. No certificate-based mutual TLS. |
| **Required Action** | Deploy Istio service mesh (`istioctl install --set profile=production`) or cert-manager with mTLS `PeerAuthentication`. |
| **Owner** | Platform / Security Team |
| **Effort** | 2–3 days |

---

### GAP-007 · Vault Secret Rotation Not Active

| Field | Detail |
|-------|--------|
| **ID** | GAP-007 |
| **Priority** | P2 |
| **Severity** | Medium |
| **Impact** | Secrets stored as static env vars. Manual rotation required. No auto-expiry. |
| **Current State** | Vault annotations already in Helm `values.yaml` (`vault.hashicorp.com/agent-inject: "true"`). Vault not deployed. |
| **Required Action** | Deploy HashiCorp Vault via Helm. Configure Kubernetes auth backend. Move secrets to Vault KV engine. |
| **Owner** | Security Team |
| **Effort** | 2 days |

---

## P3 — Within 90 Days

### GAP-008 · Autonomous Governance Not Scheduled

| Field | Detail |
|-------|--------|
| **ID** | GAP-008 |
| **Priority** | P3 |
| **Severity** | Low |
| **Impact** | Autonomous governance cycle runs on API request only. Not periodic. Drift and fatigue detection not automated. |
| **Current State** | `GET /api/executive/autonomous-governance` fully works. No CronJob. |
| **Required Action** | Add Kubernetes CronJob: `schedule: "0 */4 * * *"` calling `POST /api/executive/autonomous-governance`. |
| **Owner** | Platform Team |
| **Effort** | 2 hours |

---

### GAP-009 · Kafka Consumer Workers Missing

| Field | Detail |
|-------|--------|
| **ID** | GAP-009 |
| **Priority** | P3 |
| **Severity** | Low |
| **Impact** | Events published to Kafka not consumed by downstream processors. No streaming governance reactions. |
| **Current State** | Events written to PersistentEventStore. No consumer workers. |
| **Required Action** | Build consumer workers for `governance.events.*` topic → DB persistence + downstream triggers. |
| **Owner** | Backend Team |
| **Effort** | 3 days |

---

### GAP-010 · Bilingual Frontend Integration

| Field | Detail |
|-------|--------|
| **ID** | GAP-010 |
| **Priority** | P3 |
| **Severity** | Low |
| **Impact** | i18n architecture complete but not wired into production build. Arabic-first UX not live. |
| **Current State** | `ui-shell/src/i18n/ar/index.json` (101 keys) + `en/index.json` (101 keys) + `useTranslation()` hook. RTL/LTR switching implemented. Not yet wired to build. |
| **Required Action** | Import `useTranslation` hook into all cockpit components. Remove any remaining hardcoded strings. Test RTL layout. |
| **Owner** | Frontend Team |
| **Effort** | 1 day |

---

## Summary

| Priority | Count | Key Gaps |
|----------|-------|---------|
| **P0** | 2 | PostgreSQL live, Kafka live |
| **P1** | 2 | JWT refresh, Frontend deploy |
| **P2** | 3 | OTel SDK, mTLS, Vault |
| **P3** | 3 | Cron jobs, Consumers, i18n wiring |
| **Total** | **10** | |

| Milestone | Readiness Score |
|-----------|----------------|
| Current (code only) | **92 / 100** |
| After P0 resolved | **97 / 100** |
| After P0 + P1 resolved | **99 / 100** |
| After all 10 gaps closed | **100 / 100** ✅ |
