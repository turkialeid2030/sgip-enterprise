/**
 * Sovereign Knowledge Graph — Phase 10
 * Cross-domain graph connecting policies, controls, risks, audits,
 * findings, evidence, regulations, executives, accountability,
 * vendors, AI systems, financial statements, operational processes.
 *
 * This is the unified intelligence layer — every entity from every
 * runtime domain is a node; every relationship is a typed edge.
 */
import { v4 as uuidv4 } from "uuid";
import { getEventStore } from "../runtime/persistence/persistent.event.store";
import { getGRCOntology } from "../grc-ontology/grc.ontology.engine";
import { getGovernanceOntology } from "../sovereign-memory/ontology/governance.ontology.engine";
import { getRiskRuntime } from "../risk-runtime/register/risk.intelligence.runtime";
import { getComplianceObligationRuntime } from "../compliance-runtime/obligations/compliance.obligation.runtime";
import { getCCMRuntime } from "../compliance-runtime/ccm/ccm.runtime";
import { getInternalAuditRuntime } from "../audit-runtime/internal/internal.audit.runtime";
import { getIncidentRuntime } from "../resilience-runtime/incidents/incident.crisis.runtime";
import { getBoardRuntime } from "../governance-runtime/board/board.runtime";
import { getPolicyRuntime } from "../governance-runtime/policy/governance.policy.runtime";
import { getAISafetyRuntime } from "../runtime/ai-safety/ai.governance.safety.runtime";
import { getExternalIntelligence } from "../runtime/external-intelligence/external.intelligence.runtime";

export type KGNodeDomain = "governance"|"risk"|"compliance"|"audit"|"evidence"|"regulation"|"executive"|"vendor"|"ai_system"|"financial"|"operational"|"policy"|"control";

export interface KGNode {
  id:          string;
  tenantId:    string;
  domain:      KGNodeDomain;
  entityType:  string;
  label:       string;
  code?:       string;
  status:      "active"|"inactive"|"archived"|"at_risk";
  health:      number;            // 0-100
  riskScore?:  number;
  properties:  Record<string, unknown>;
  sourceId:    string;            // ID from originating runtime
  sourceRuntime:string;
  createdAt:   string;
}

export interface KGEdge {
  id:          string;
  tenantId:    string;
  type:        string;            // "GOVERNS","MITIGATES","EVIDENCES","AUDITS","MAPS_TO","IMPLEMENTS","OWNS","DEPENDS_ON"
  fromId:      string;
  fromDomain:  KGNodeDomain;
  toId:        string;
  toDomain:    KGNodeDomain;
  strength:    number;            // 0-1
  createdAt:   string;
}

export interface KGQueryResult {
  nodes:         KGNode[];
  edges:         KGEdge[];
  nodeCount:     number;
  edgeCount:     number;
  byDomain:      Record<string, number>;
  orphanNodes:   number;
  criticalPaths: Array<{path:string[]; risk:number}>;
}

export interface KGBlastRadius {
  sourceNodeId:  string;
  depth:         number;
  affected:      KGNode[];
  totalImpact:   number;
  criticalNodes: KGNode[];
  estimatedRisk: string;
}

// ── Graph stores ──────────────────────────────────────────────
const nodeStore = new Map<string, KGNode>();    // tenantId:nodeId → node
const edgeStore = new Map<string, KGEdge[]>();  // tenantId:nodeId → outbound edges

export class SovereignKnowledgeGraph {
  constructor(private readonly tenantId: string) {}

  /**
   * Sync all domain runtimes into unified graph.
   * Call on startup or after major state changes.
   */
  sync(): { nodesAdded:number; edgesAdded:number } {
    let nodesAdded = 0; let edgesAdded = 0;
    const now = new Date().toISOString();

    // ── Risks ─────────────────────────────────────────────────
    const risks = getRiskRuntime(this.tenantId).getAll();
    for (const r of risks) {
      if (!nodeStore.has(`${this.tenantId}:${r.id}`)) {
        nodeStore.set(`${this.tenantId}:${r.id}`, { id:r.id, tenantId:this.tenantId, domain:"risk", entityType:r.category, label:r.title, code:r.code, status:r.toleranceBreached?"at_risk":"active", health:Math.max(0,100-r.residualScore*5), riskScore:r.residualScore, properties:{ category:r.category, inherentScore:r.inherentScore }, sourceId:r.id, sourceRuntime:"risk_runtime", createdAt:r.createdAt });
        nodesAdded++;
      }
    }

    // ── Compliance obligations ────────────────────────────────
    const obligations = getComplianceObligationRuntime(this.tenantId).getAll();
    for (const o of obligations) {
      if (!nodeStore.has(`${this.tenantId}:${o.id}`)) {
        nodeStore.set(`${this.tenantId}:${o.id}`, { id:o.id, tenantId:this.tenantId, domain:"compliance", entityType:"obligation", label:o.title, code:o.code, status:o.status==="breached"?"at_risk":"active", health:o.status==="breached"?10:80, riskScore:o.riskExposure, properties:{ framework:o.framework, jurisdiction:o.jurisdiction }, sourceId:o.id, sourceRuntime:"compliance_runtime", createdAt:o.createdAt });
        nodesAdded++;
        // Edge: obligation → risk (maps_to)
        for (const riskId of risks.filter(r=>r.category===o.source.replace("regulation","regulatory_risk")).map(r=>r.id).slice(0,2)) {
          this.addEdge({ type:"MAPS_TO", fromId:o.id, fromDomain:"compliance", toId:riskId, toDomain:"risk", strength:0.7 });
          edgesAdded++;
        }
      }
    }

    // ── Controls ──────────────────────────────────────────────
    const controls = getCCMRuntime(this.tenantId).getAllControls();
    for (const c of controls) {
      if (!nodeStore.has(`${this.tenantId}:${c.controlId}`)) {
        nodeStore.set(`${this.tenantId}:${c.controlId}`, { id:c.controlId, tenantId:this.tenantId, domain:"control", entityType:c.type, label:c.controlName, code:c.controlCode, status:c.overrideDetected?"at_risk":c.status==="ineffective"?"at_risk":"active", health:c.effectivenessScore, properties:{ type:c.type, overrideDetected:c.overrideDetected }, sourceId:c.controlId, sourceRuntime:"ccm_runtime", createdAt:now });
        nodesAdded++;
      }
    }

    // ── Audit findings ────────────────────────────────────────
    const audit = getInternalAuditRuntime(this.tenantId);
    const findings = audit.getAllFindings();
    for (const f of findings) {
      if (!nodeStore.has(`${this.tenantId}:${f.id}`)) {
        nodeStore.set(`${this.tenantId}:${f.id}`, { id:f.id, tenantId:this.tenantId, domain:"audit", entityType:"finding", label:f.title, code:f.code, status:f.status==="resolved"?"inactive":f.severity==="critical"?"at_risk":"active", health:f.status==="resolved"?100:f.severity==="critical"?10:50, properties:{ severity:f.severity, status:f.status, engagementId:f.engagementId }, sourceId:f.id, sourceRuntime:"audit_runtime", createdAt:f.createdAt });
        nodesAdded++;
      }
    }

    // ── Policies ──────────────────────────────────────────────
    const policies = getPolicyRuntime(this.tenantId).getAll("active");
    for (const p of policies) {
      const policyId = `policy-${p.code}`;
      if (!nodeStore.has(`${this.tenantId}:${policyId}`)) {
        nodeStore.set(`${this.tenantId}:${policyId}`, { id:policyId, tenantId:this.tenantId, domain:"policy", entityType:p.category, label:p.title, code:p.code, status:"active", health:90, properties:{ version:p.version, category:p.category }, sourceId:policyId, sourceRuntime:"policy_runtime", createdAt:now });
        nodesAdded++;
        // Edge: policy → controls
        for (const ctrlId of (p.controlIds??[]).slice(0,3)) {
          this.addEdge({ type:"IMPLEMENTS", fromId:ctrlId, fromDomain:"control", toId:policyId, toDomain:"policy", strength:0.9 });
          edgesAdded++;
        }
      }
    }

    // ── Incidents ─────────────────────────────────────────────
    const incidents = getIncidentRuntime(this.tenantId).getAll();
    for (const i of incidents) {
      if (!nodeStore.has(`${this.tenantId}:${i.id}`)) {
        nodeStore.set(`${this.tenantId}:${i.id}`, { id:i.id, tenantId:this.tenantId, domain:"operational", entityType:"incident", label:i.title, code:i.code, status:i.isCrisis?"at_risk":i.status==="resolved"?"inactive":"active", health:i.isCrisis?5:50, properties:{ severity:i.severity, category:i.category, isCrisis:i.isCrisis }, sourceId:i.id, sourceRuntime:"incident_runtime", createdAt:i.detectedAt });
        nodesAdded++;
        // Edge: incident → risks
        for (const rId of i.linkedRiskIds.slice(0,2)) {
          this.addEdge({ type:"CAUSED_BY", fromId:i.id, fromDomain:"operational", toId:rId, toDomain:"risk", strength:0.8 });
          edgesAdded++;
        }
      }
    }

    // ── AI actions ────────────────────────────────────────────
    const aiSafety  = getAISafetyRuntime(this.tenantId);
    const aiTraces  = aiSafety.getTraces();
    for (const trace of aiTraces.slice(0,20)) {
      if (!nodeStore.has(`${this.tenantId}:${trace.id}`)) {
        nodeStore.set(`${this.tenantId}:${trace.id}`, { id:trace.id, tenantId:this.tenantId, domain:"ai_system", entityType:"ai_action", label:`${trace.action} by ${trace.agentId}`, status:trace.status==="blocked"?"at_risk":trace.wasRolledBack?"inactive":"active", health:trace.wasRolledBack?20:trace.status==="blocked"?0:85, properties:{ agentId:trace.agentId, action:trace.action, status:trace.status }, sourceId:trace.id, sourceRuntime:"ai_safety_runtime", createdAt:trace.startedAt });
        nodesAdded++;
      }
    }

    // ── Regulatory changes (external) ─────────────────────────
    const intel   = getExternalIntelligence(this.tenantId);
    intel.loadBaseline();
    for (const change of intel.getChanges()) {
      if (!nodeStore.has(`${this.tenantId}:${change.id}`)) {
        nodeStore.set(`${this.tenantId}:${change.id}`, { id:change.id, tenantId:this.tenantId, domain:"regulation", entityType:change.framework, label:change.title, status:change.severity==="critical"?"at_risk":"active", health:change.severity==="critical"?20:60, properties:{ framework:change.framework, jurisdiction:change.jurisdiction, severity:change.severity }, sourceId:change.id, sourceRuntime:"external_intelligence", createdAt:change.ingestedAt });
        nodesAdded++;
        // Edge: regulation → compliance obligations
        for (const o of obligations.filter(ob=>ob.framework===change.framework).slice(0,2)) {
          this.addEdge({ type:"GOVERNS", fromId:change.id, fromDomain:"regulation", toId:o.id, toDomain:"compliance", strength:0.9 });
          edgesAdded++;
        }
      }
    }

    return { nodesAdded, edgesAdded };
  }

  private addEdge(params: Omit<KGEdge,"id"|"tenantId"|"createdAt">): void {
    const key = `${this.tenantId}:${params.fromId}`;
    if (!edgeStore.has(key)) edgeStore.set(key, []);
    // Dedup
    const existing = edgeStore.get(key)!;
    if (!existing.some(e=>e.type===params.type && e.toId===params.toId)) {
      existing.push({ ...params, id:uuidv4(), tenantId:this.tenantId, createdAt:new Date().toISOString() });
    }
  }

  query(filter?: { domain?:KGNodeDomain; status?:string; minHealth?:number }): KGQueryResult {
    const allNodes = [...nodeStore.values()].filter(n=>n.tenantId===this.tenantId);
    let nodes = allNodes;
    if (filter?.domain)    nodes = nodes.filter(n=>n.domain===filter.domain);
    if (filter?.status)    nodes = nodes.filter(n=>n.status===filter.status);
    if (filter?.minHealth !== undefined) nodes = nodes.filter(n=>n.health>=filter.minHealth!);

    const nodeIds  = new Set(nodes.map(n=>n.id));
    const allEdges = [...edgeStore.values()].flat().filter(e=>e.tenantId===this.tenantId && nodeIds.has(e.fromId));
    const byDomain: Record<string,number> = {};
    for (const n of nodes) byDomain[n.domain] = (byDomain[n.domain]??0)+1;
    const nodeIdsWithEdges = new Set([...allEdges.map(e=>e.fromId),...allEdges.map(e=>e.toId)]);
    const orphans = nodes.filter(n=>!nodeIdsWithEdges.has(n.id)).length;

    return { nodes:nodes.slice(0,200), edges:allEdges.slice(0,500), nodeCount:nodes.length, edgeCount:allEdges.length, byDomain, orphanNodes:orphans, criticalPaths:[] };
  }

  blastRadius(nodeId: string, maxDepth=3): KGBlastRadius {
    const source = nodeStore.get(`${this.tenantId}:${nodeId}`);
    if (!source) return { sourceNodeId:nodeId, depth:maxDepth, affected:[], totalImpact:0, criticalNodes:[], estimatedRisk:"Entity not in knowledge graph" };

    const visited = new Set<string>([nodeId]);
    const affected: KGNode[] = [];
    const queue: [string,number][] = [[nodeId,0]];

    while (queue.length > 0) {
      const [id,depth] = queue.shift()!;
      if (depth >= maxDepth) continue;
      const outbound = edgeStore.get(`${this.tenantId}:${id}`) ?? [];
      for (const edge of outbound) {
        if (visited.has(edge.toId)) continue;
        visited.add(edge.toId);
        const target = nodeStore.get(`${this.tenantId}:${edge.toId}`);
        if (target) { affected.push(target); queue.push([edge.toId, depth+1]); }
      }
    }

    const totalImpact = affected.reduce((s,n)=>s+(n.riskScore??0),0);
    const criticalNodes = affected.filter(n=>n.status==="at_risk"||n.health<30);
    const estimatedRisk = criticalNodes.length>=5?"critical":criticalNodes.length>=2?"high":affected.length>0?"medium":"low";

    return { sourceNodeId:nodeId, depth:maxDepth, affected, totalImpact, criticalNodes, estimatedRisk };
  }

  getStats() {
    const allNodes = [...nodeStore.values()].filter(n=>n.tenantId===this.tenantId);
    const allEdges = [...edgeStore.values()].flat().filter(e=>e.tenantId===this.tenantId);
    const byDomain: Record<string,number> = {};
    for (const n of allNodes) byDomain[n.domain] = (byDomain[n.domain]??0)+1;
    return { nodes:allNodes.length, edges:allEdges.length, byDomain, atRisk:allNodes.filter(n=>n.status==="at_risk").length };
  }
}

const kgCache = new Map<string,SovereignKnowledgeGraph>();
export function getSovereignKG(tenantId:string): SovereignKnowledgeGraph {
  if (!kgCache.has(tenantId)) kgCache.set(tenantId, new SovereignKnowledgeGraph(tenantId));
  return kgCache.get(tenantId)!;
}
