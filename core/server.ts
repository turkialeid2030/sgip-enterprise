/**
 * SGIP Enterprise — Runtime Bootstrap
 * Wires all layers together and exposes the platform API.
 *
 * Production: add Express/Fastify HTTP layer, JWT auth, rate limiting.
 * This file is the single wiring point — all dependencies injected here.
 */
import { EventBus }             from "./event-bus";
import { UGOMRegistry }         from "./ugom.registry";
import { SovereignKnowledgeGraph } from "../graph/graph.engine";
import { AuditLogger }          from "../audit/audit.logger";
import { GovernanceOrchestrator } from "../orchestration/orchestrator";
import { QualityGateEngine }    from "../orchestration/quality-gate.engine";
import { GovernanceMemoryStore } from "../governance-memory/memory.store";
import { PatternDetector }      from "../governance-memory/pattern.detector";
import { RiskService }          from "../modules/risk/risk.service";
import { ControlService }       from "../modules/control/control.service";
import { PolicyService }        from "../modules/policy/policy.service";

export interface SGIPRuntime {
  tenantId:     string;
  eventBus:     EventBus;
  registry:     UGOMRegistry;
  graph:        SovereignKnowledgeGraph;
  audit:        AuditLogger;
  orchestrator: GovernanceOrchestrator;
  qualityGate:  QualityGateEngine;
  memory:       GovernanceMemoryStore;
  patterns:     PatternDetector;
  // Modules
  risks:        RiskService;
  controls:     ControlService;
  policies:     PolicyService;
}

export function createRuntime(tenantId: string, organizationId = "default"): SGIPRuntime {
  // Infrastructure
  const eventBus    = new EventBus();
  const audit       = new AuditLogger(tenantId, organizationId);
  const graph       = new SovereignKnowledgeGraph(eventBus, audit, tenantId);
  const registry    = new UGOMRegistry(graph, eventBus, audit, tenantId, organizationId);
  const memory      = new GovernanceMemoryStore(tenantId);
  const patterns    = new PatternDetector(memory);
  const qualityGate = new QualityGateEngine();
  const orchestrator= new GovernanceOrchestrator(eventBus, audit, qualityGate, tenantId);  // aiGateway injected at API startup

  // Modules
  const risks    = new RiskService(registry, graph, eventBus, memory, tenantId);
  const controls = new ControlService(registry, graph, eventBus, tenantId);
  const policies = new PolicyService(registry, eventBus, tenantId);

  // Cross-module event wiring
  eventBus.on("risk.tolerance_breach", async (evt) => {
    audit.log({
      action: "system.risk_breach_detected",
      entityId: (evt as { payload: { riskId: string } }).payload.riskId,
      entityType: "risk", performedBy: "system",
      details: evt,
    });
  });

  eventBus.on("control.failure", async (evt) => {
    const payload = (evt as { payload: { controlId: string } }).payload;
    audit.log({
      action: "system.control_failure_detected",
      entityId: payload.controlId,
      entityType: "control", performedBy: "system",
    });
  });

  eventBus.on("agent.quality_gate_failed", async (evt) => {
    console.warn("[Runtime] Quality gate failed:", (evt as { payload: unknown }).payload);
  });

  return {
    tenantId, eventBus, registry, graph, audit,
    orchestrator, qualityGate, memory, patterns,
    risks, controls, policies,
  };
}

// Singleton for demonstration
let _runtime: SGIPRuntime | null = null;

export function getRuntime(tenantId = "tenant-demo"): SGIPRuntime {
  if (!_runtime) _runtime = createRuntime(tenantId);
  return _runtime;
}
