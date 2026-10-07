# SGIP Enterprise — Sovereign Governance Intelligence Platform
## TypeScript/Node.js Modular Enterprise Architecture

**Status:** Production-grade foundation layer — all tests passing (22/22)

---

## Architecture Overview

```
/types         — Single source of truth for all TypeScript types (UGOMType, RelationshipType, AgentId, SGIPEventType)
/schemas       — Zod runtime validation schemas (BaseGovernanceSchema + 9 entity schemas)
/contracts     — Typed inter-module contracts (no direct imports between modules)
/graph         — SovereignKnowledgeGraph (real graph: typed nodes + directed edges, traceability, impact analysis)
/core          — EventBus (pub/sub) + UGOMRegistry (canonical entity store + auto-graph sync)
/orchestration — GovernanceOrchestrator + QualityGateEngine (12 gates, no bypass)
/governance-memory — GovernanceMemoryStore + PatternDetector (institutional learning)
/audit         — AuditLogger (immutable append-only, every mutation logged)
/agents        — Agent constitutions (11 typed agents) + skills registry + pre/post hooks
/modules/risk  — RiskService (create, heatmap, breach detection, memory integration)
/modules/control — ControlService (testing, SoD detection, coverage matrix)
/modules/policy  — PolicyService (lifecycle, conflict detection, freshness scoring)
```

---

## Key Design Principles

1. **No isolated modules** — every module depends on contracts, not each other's internals
2. **No static JSON relationships** — graph edges are first-class typed objects
3. **No fake AI orchestration** — orchestrator enforces real constitution checks before any agent action
4. **No duplicated schemas** — `BaseGovernanceSchema` extended, never re-defined
5. **Audit-safe** — every entity mutation produces an immutable `AuditEntry` (frozen object)
6. **Event-driven** — modules communicate via typed `SGIPEvent`, never via direct calls
7. **Quality-gated** — no output passes without 12-gate validation

---

## Quick Start

```bash
npm install
npm test          # 22 tests, 3 suites
npm run typecheck # strict TypeScript validation
npm run build     # compile to /dist
```

---

## Production TODO

| Layer | Current | Production |
|-------|---------|------------|
| Entity store | In-memory Map | PostgreSQL + Row-Level Security |
| Knowledge Graph | In-memory | Neo4j / TigerGraph |
| Event Bus | eventemitter3 | Kafka / AWS EventBridge |
| AI Gateway | Mock (no API calls) | Backend proxy (never in frontend) |
| Memory/Retrieval | In-memory | Pinecone / Weaviate vector DB |
| Audit Trail | In-memory append | WORM storage / blockchain hash |
| Auth | None | JWT + MFA + RBAC |
| Multi-tenancy | TenantId filter | PostgreSQL RLS |

---

## Module Manifest (self-registration pattern)

Each module declares:
- `entityTypes` it owns
- `emitsEvents` it produces
- `consumesEvents` it handles
- `agents` assigned to it
- `dependsOn` (other module IDs)

This enables CI validation that no circular dependencies exist.
