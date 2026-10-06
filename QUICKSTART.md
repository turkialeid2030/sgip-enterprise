# SGIP Enterprise — Quick Start Guide

## Prerequisites
- Docker + Docker Compose
- Node.js 20+
- Anthropic API key (for real AI agents)

---

## Step 1: Clone & Install

```bash
git clone <your-repo>/sgip-enterprise
cd sgip-enterprise
npm install
```

---

## Step 2: Configure Environment

```bash
cp .env.example .env
# Edit .env and set:
#   ANTHROPIC_API_KEY=sk-ant-...your-real-key...
#   JWT_SECRET=your-random-secret-min-32-chars
```

---

## Step 3: Start Database (Docker)

```bash
docker-compose up -d postgres redis
# Wait for healthy status (~10 seconds)
docker-compose ps
```

---

## Step 4: Run Database Migrations + Seed

```bash
# Apply schema
psql -U sgip_admin -h localhost -d sgip_enterprise -f prisma/migrations/001_initial.sql

# Seed demo data (users + regulations + risks)
npm run db:seed
```

---

## Step 5: Start API Server

```bash
# Development (hot reload)
npm run dev

# Production
npm run build && npm start
```

API is live at: **http://localhost:4000**

---

## Step 6: Test the API

```bash
# Health check
curl http://localhost:4000/health

# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"cgo@demo.sgip","password":"Demo@1234","tenantId":"tenant-001"}'
# → returns { token: "..." }

# Use the token
TOKEN="your-jwt-token-here"

# List all entities
curl http://localhost:4000/api/entities \
  -H "Authorization: Bearer $TOKEN"

# Get risks only
curl "http://localhost:4000/api/entities?type=risk" \
  -H "Authorization: Bearer $TOKEN"

# Dashboard summary
curl http://localhost:4000/api/dashboard/summary \
  -H "Authorization: Bearer $TOKEN"

# Real AI Analysis (uses Anthropic API)
curl -X POST http://localhost:4000/api/ai/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "risk_analyst",
    "entityId": "risk-001",
    "action": "write:risk_assessment",
    "context": "قيّم هذه المخاطرة وقدم توصيات لتخفيف الأثر"
  }'

# Create a new governance entity
curl -X POST http://localhost:4000/api/entities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "risk",
    "title": "مخاطرة جديدة",
    "owner": "CRO",
    "priority": "high",
    "riskLevel": "high",
    "impactLevel": "high",
    "linkedRegulations": ["reg-cma"]
  }'

# Traceability chain for an entity
curl "http://localhost:4000/api/graph/trace/risk-001" \
  -H "Authorization: Bearer $TOKEN"

# Knowledge graph blind spots
curl http://localhost:4000/api/graph/blind-spots \
  -H "Authorization: Bearer $TOKEN"
```

---

## API Endpoints

| Method | Endpoint                          | Description                  |
|--------|-----------------------------------|------------------------------|
| POST   | /api/auth/login                   | Login → JWT token            |
| POST   | /api/auth/register                | Register new user            |
| GET    | /api/entities                     | List entities (filter by type/status) |
| POST   | /api/entities                     | Create entity (Risk/Control/Policy/etc.) |
| GET    | /api/entities/:id                 | Get entity + edges + audit   |
| PATCH  | /api/entities/:id                 | Update entity                |
| DELETE | /api/entities/:id                 | Archive entity               |
| GET    | /api/graph/node/:id               | Graph node + relationships   |
| POST   | /api/graph/edge                   | Create typed relationship    |
| GET    | /api/graph/trace/:id              | Traceability chain           |
| GET    | /api/graph/blind-spots            | Unconnected risks/obligations |
| POST   | /api/ai/analyze                   | Real AI analysis (Anthropic) |
| GET    | /api/ai/outputs                   | Agent outputs pending review |
| PATCH  | /api/ai/outputs/:id/review        | Approve/reject agent output  |
| GET    | /api/ai/agents                    | List all agent constitutions |
| GET    | /api/dashboard/summary            | Master KPI summary           |
| GET    | /api/dashboard/audit-logs         | Immutable audit trail        |
| GET    | /api/dashboard/health             | System health check          |

---

## Demo Accounts

| Email               | Password   | Role                  |
|--------------------|------------|-----------------------|
| cgo@demo.sgip      | Demo@1234  | governance_analyst    |
| risk@demo.sgip     | Demo@1234  | risk_analyst          |
| audit@demo.sgip    | Demo@1234  | internal_audit_agent  |
| finance@demo.sgip  | Demo@1234  | financial_reviewer    |
| legal@demo.sgip    | Demo@1234  | legal_reviewer        |
| admin@demo.sgip    | Demo@1234  | orchestrator          |

---

## Architecture

```
Docker Compose
├── postgres:5432     PostgreSQL 16 + all UGOM tables
├── redis:6379        Cache + session store
└── api:4000          Node.js Express API
    ├── /api/auth     JWT authentication
    ├── /api/entities UGOM CRUD (all 30 entity types)
    ├── /api/graph    Sovereign Knowledge Graph
    ├── /api/ai       Real Anthropic API Gateway
    └── /api/dashboard Analytics + Audit logs
```

---

## Production Checklist

- [ ] Set strong `JWT_SECRET` (32+ chars)
- [ ] Set real `ANTHROPIC_API_KEY`
- [ ] Change `POSTGRES_PASSWORD`
- [ ] Enable PostgreSQL Row-Level Security
- [ ] Set `NODE_ENV=production`
- [ ] Configure HTTPS (nginx/caddy reverse proxy)
- [ ] Set up backup for PostgreSQL volume
- [ ] Configure log aggregation
