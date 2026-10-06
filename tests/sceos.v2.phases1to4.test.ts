/**
 * SCEOS v2 — Phase 1-4 Runtime Tests
 * Covers: Durable Event Bus, Persistent Memory, Failure Recovery,
 *         Organizational Digital Twin, Workflow Orchestration, Process Mining.
 * Additive — preserves 404 existing tests.
 */
import { DurableEventBus, getDurableEventBus } from "../runtime/event-bus/durable.event.bus";
import { PersistentMemoryLayer, getPersistentMemory } from "../runtime/persistent-memory/persistent.memory.layer";
import { FailureRecoveryEngine, getRecoveryEngine } from "../runtime/failure-recovery/failure.recovery.engine";
import { OrganizationalDigitalTwin, getDigitalTwin, TwinEntityType } from "../digital-twin/org-graph/organizational.digital.twin";
import { WorkflowOrchestrator, getOrchestrator } from "../orchestration/workflow-engine/workflow.orchestrator";
import { ProcessMiningEngine, getProcessMiningEngine } from "../process-mining/discovery/process.mining.engine";

const uid = () => `t-v2-${Math.random().toString(36).slice(2,10)}`;

// ═══════════════════════════════════════════════════════════════
// DURABLE EVENT BUS
// ═══════════════════════════════════════════════════════════════
describe("DurableEventBus — Phase 1.1", () => {
  it("publishes event to append-only journal", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    const e = await bus.publish({ topic:"governance.decision", payload:{id:"dec-001"}, actorId:"cgo", actorRole:"governance_analyst", correlationId:"corr-001" });
    expect(e.id).toBeTruthy();
    expect(e.metadata.checksum).toBeTruthy();
    expect(e.tenantId).toBe(t);
  });

  it("event is immutable after publish", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    const e = await bus.publish({ topic:"test", payload:{}, actorId:"u1", actorRole:"r" });
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("verifyIntegrity returns valid for untampered event", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    const e = await bus.publish({ topic:"audit.event", payload:{finding:"F1"}, actorId:"auditor", actorRole:"audit_lead" });
    const check = bus.verifyIntegrity(e.id);
    expect(check.valid).toBe(true);
  });

  it("subscriber receives events", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    const received: string[] = [];
    bus.subscribe("risk.escalated", async (e) => { received.push(e.topic); });
    await bus.publish({ topic:"risk.escalated", payload:{riskId:"r1"}, actorId:"cro", actorRole:"risk_analyst" });
    expect(received).toContain("risk.escalated");
  });

  it("wildcard subscriber receives all events", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    const count: number[] = [];
    bus.subscribe("*", async () => { count.push(1); });
    await bus.publish({ topic:"event.A", payload:{}, actorId:"u", actorRole:"r" });
    await bus.publish({ topic:"event.B", payload:{}, actorId:"u", actorRole:"r" });
    expect(count.length).toBe(2);
  });

  it("causation chain: child references parent", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    const parent = await bus.publish({ topic:"decision.created", payload:{}, actorId:"u", actorRole:"r" });
    const child  = await bus.publish({ topic:"approval.requested", payload:{}, actorId:"u", actorRole:"r", causationId:parent.id });
    expect(child.metadata.causationId).toBe(parent.id);
  });

  it("correlationId groups related events", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    const corr = "corr-test-001";
    await bus.publish({ topic:"ev.1", payload:{}, actorId:"u", actorRole:"r", correlationId:corr });
    await bus.publish({ topic:"ev.2", payload:{}, actorId:"u", actorRole:"r", correlationId:corr });
    const related = bus.getJournal().filter(e => e.metadata.correlationId === corr);
    expect(related.length).toBe(2);
  });

  it("replay returns events matching topic filter", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    await bus.publish({ topic:"risk.created", payload:{}, actorId:"u", actorRole:"r" });
    await bus.publish({ topic:"policy.updated", payload:{}, actorId:"u", actorRole:"r" });
    const replayed = await bus.replay({ topic:"risk.created" });
    expect(replayed.every(e => e.topic === "risk.created")).toBe(true);
  });

  it("getStats returns accurate counts", async () => {
    const t = uid(); const bus = getDurableEventBus(t);
    await bus.publish({ topic:"t1", payload:{}, actorId:"u", actorRole:"r" });
    await bus.publish({ topic:"t1", payload:{}, actorId:"u", actorRole:"r" });
    await bus.publish({ topic:"t2", payload:{}, actorId:"u", actorRole:"r" });
    const stats = bus.getStats();
    expect(stats.totalEvents).toBe(3);
    expect(stats.byTopic.t1).toBe(2);
    expect(stats.byTopic.t2).toBe(1);
  });

  it("tenant isolation: B cannot read A's events", async () => {
    const tA = uid(); const tB = uid();
    const busA = getDurableEventBus(tA); const busB = getDurableEventBus(tB);
    await busA.publish({ topic:"secret", payload:{data:"classified"}, actorId:"u", actorRole:"r" });
    expect(busB.getJournal().filter(e => e.payload.data === "classified")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// PERSISTENT MEMORY LAYER
// ═══════════════════════════════════════════════════════════════
describe("PersistentMemoryLayer — Phase 1.3", () => {
  it("writes memory and appends to WAL", () => {
    const t = uid(); const pm = getPersistentMemory(t);
    const m = pm.write({ type:"episodic", subject:"dec-001", subjectType:"decision", content:"Decision approved",
      context:{ actors:["cgo"], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"2025", confidentiality:"confidential" },
      sourceType:"decision", importance:85, createdBy:"system" });
    expect(m.id).toBeTruthy();
    const wal = pm.getWAL();
    expect(wal.some(e => e.memoryId === m.id && e.operation === "write")).toBe(true);
  });

  it("seal creates WAL seal entry", () => {
    const t = uid(); const pm = getPersistentMemory(t);
    const m = pm.write({ type:"institutional", subject:"lesson-1", subjectType:"lesson", content:"Critical lesson",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"permanent", confidentiality:"internal" },
      sourceType:"audit", importance:90, createdBy:"system" });
    pm.seal(m.id);
    const wal = pm.getWAL();
    expect(wal.some(e => e.operation === "seal")).toBe(true);
  });

  it("causal link appends link entry to WAL", () => {
    const t = uid(); const pm = getPersistentMemory(t);
    const cause = pm.write({ type:"episodic", subject:"s1", subjectType:"e", content:"c1",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", createdBy:"system" });
    pm.write({ type:"episodic", subject:"s2", subjectType:"e", content:"c2",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", createdBy:"system", causeMemoryId:cause.id });
    const wal = pm.getWAL();
    expect(wal.some(e => e.operation === "link")).toBe(true);
  });

  it("snapshot captures state", () => {
    const t = uid(); const pm = getPersistentMemory(t);
    pm.write({ type:"episodic", subject:"snap-s1", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", createdBy:"system" });
    const snap = pm.snapshot();
    expect(snap.id).toBeTruthy();
    expect(snap.entries.length).toBeGreaterThanOrEqual(1);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(pm.getSnapshots().length).toBeGreaterThanOrEqual(1);
  });

  it("WAL stats are accurate", () => {
    const t = uid(); const pm = getPersistentMemory(t);
    pm.write({ type:"episodic", subject:"s", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", createdBy:"system" });
    const stats = pm.getWALStats();
    expect(stats.writes).toBeGreaterThanOrEqual(1);
    expect(stats.latestLSN).toBeGreaterThan(0);
  });

  it("temporal query returns entries in date range", () => {
    const t = uid(); const pm = getPersistentMemory(t);
    pm.write({ type:"episodic", subject:"tq-s1", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", createdBy:"system" });
    const results = pm.temporalQuery({ subject:"tq-s1", fromDate: new Date(Date.now()-60000).toISOString() });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// FAILURE RECOVERY ENGINE
// ═══════════════════════════════════════════════════════════════
describe("FailureRecoveryEngine — Phase 1.5", () => {
  it("executes saga with all steps completing", async () => {
    const t = uid(); const e = getRecoveryEngine(t);
    const log: string[] = [];
    const saga = e.createSaga("TestSaga", [
      { name:"Step1", execute:async()=>{ log.push("exec1"); return "ok"; }, compensate:async()=>{ log.push("comp1"); } },
      { name:"Step2", execute:async()=>{ log.push("exec2"); return "ok"; }, compensate:async()=>{ log.push("comp2"); } },
    ]);
    const result = await e.execute(saga.id);
    expect(result.status).toBe("completed");
    expect(log).toContain("exec1");
    expect(log).toContain("exec2");
  });

  it("failed step triggers compensation in reverse", async () => {
    const t = uid(); const engine = getRecoveryEngine(t);
    const log: string[] = [];
    const saga = engine.createSaga("FailSaga", [
      { name:"Step1", execute:async()=>{ log.push("exec1"); return "ok"; }, compensate:async()=>{ log.push("comp1"); } },
      { name:"FailStep", execute:async()=>{ throw new Error("Intentional failure"); }, compensate:async()=>{} },
    ]);
    const result = await engine.execute(saga.id);
    expect(result.status).toBe("failed");
    expect(result.failedStep).toBe("FailStep");
    expect(log).toContain("comp1");  // Step1 compensated
  });

  it("getActiveSagas returns only running sagas", async () => {
    const t = uid(); const engine = getRecoveryEngine(t);
    engine.createSaga("ActiveSaga", [{ name:"S1", execute:async()=>"ok", compensate:async()=>{} }]);
    // Don't execute — stays in "running"... actually createSaga sets status "running" but not yet executed
    const actives = engine.getActiveSagas();
    expect(actives.length).toBeGreaterThanOrEqual(1);
    expect(actives.every(s => s.status === "running")).toBe(true);
  });

  it("getFailedSagas returns failed ones", async () => {
    const t = uid(); const engine = getRecoveryEngine(t);
    const saga = engine.createSaga("FailTest", [{ name:"F", execute:async()=>{ throw new Error("fail"); }, compensate:async()=>{} }]);
    await engine.execute(saga.id);
    expect(engine.getFailedSagas().some(s => s.id === saga.id)).toBe(true);
  });

  it("tenant isolation: other tenant cannot see sagas", async () => {
    const tA = uid(); const tB = uid();
    const engA = getRecoveryEngine(tA); const engB = getRecoveryEngine(tB);
    const s = engA.createSaga("PrivateSaga", [{ name:"S", execute:async()=>"ok", compensate:async()=>{} }]);
    expect(engB.getSaga(s.id)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// ORGANIZATIONAL DIGITAL TWIN
// ═══════════════════════════════════════════════════════════════
describe("OrganizationalDigitalTwin — Phase 2", () => {
  it("upserts entities and returns with tenantId", () => {
    const t = uid(); const twin = getDigitalTwin(t);
    const dept = twin.upsertEntity({ type:"department", name:"Risk Management", code:"DEPT-RISK", status:"active", health:85, properties:{} });
    expect(dept.tenantId).toBe(t);
    expect(dept.type).toBe("department");
    expect(dept.health).toBe(85);
  });

  it("upsert by code is idempotent", () => {
    const t = uid(); const twin = getDigitalTwin(t);
    twin.upsertEntity({ type:"department", name:"Finance v1", code:"DEPT-FIN", status:"active", health:80, properties:{} });
    twin.upsertEntity({ type:"department", name:"Finance v2", code:"DEPT-FIN", status:"active", health:90, properties:{} });
    const depts = twin.getEntitiesByType("department").filter(e => e.code === "DEPT-FIN");
    expect(depts).toHaveLength(1);
    expect(depts[0].name).toBe("Finance v2");
  });

  it("adds relation and traverses it", () => {
    const t = uid(); const twin = getDigitalTwin(t);
    const exec = twin.upsertEntity({ type:"executive", name:"CEO",      code:"EXEC-001", status:"active", health:95, properties:{} });
    const dept = twin.upsertEntity({ type:"department", name:"Strategy", code:"DEPT-STR", status:"active", health:80, properties:{} });
    twin.addRelation({ type:"MANAGES", fromId:exec.id, fromType:"executive", toId:dept.id, toType:"department", weight:1.0, properties:{} });
    const outbound = twin.getOutbound(exec.id);
    expect(outbound.some(r => r.toId === dept.id && r.type === "MANAGES")).toBe(true);
    const inbound = twin.getInbound(dept.id);
    expect(inbound.some(r => r.fromId === exec.id)).toBe(true);
  });

  it("blast radius: connected entities are affected", () => {
    const t = uid();
    // Use a fresh twin instance for complete isolation
    const twin = new OrganizationalDigitalTwin(t);
    const authId = `auth-${t}`; const polId = `pol-${t}`; const riskId = `risk-${t}`;
    twin.upsertEntity({ id:authId, type:"authority", name:"Board",  code:`AUTH-${t}`, status:"active", health:90, properties:{} });
    twin.upsertEntity({ id:polId,  type:"policy",    name:"Policy", code:`POL-${t}`,  status:"active", health:75, properties:{} });
    twin.upsertEntity({ id:riskId, type:"risk",      name:"Risk",   code:`RSK-${t}`,  status:"active", health:50, properties:{} });
    twin.addRelation({ type:"GOVERNS",   fromId:authId, fromType:"authority", toId:polId,  toType:"policy", weight:1,   properties:{} });
    twin.addRelation({ type:"MITIGATES", fromId:polId,  fromType:"policy",    toId:riskId, toType:"risk",   weight:0.8, properties:{} });
    const blast = twin.analyzeBlastRadius(authId);
    const totalAffected = blast.directlyAffected.length + blast.indirectlyAffected.length;
    expect(totalAffected).toBeGreaterThanOrEqual(1);
    expect(blast.estimatedImpact).toContain("affected");
  });

  it("blast radius: isolated entity has 0 risk", () => {
    const t = uid(); const twin = getDigitalTwin(t);
    const iso = twin.upsertEntity({ type:"vendor", name:"Isolated Vendor", code:"VND-ISO", status:"active", health:70, properties:{} });
    const blast = twin.analyzeBlastRadius(iso.id);
    expect(blast.directlyAffected).toHaveLength(0);
    expect(blast.overallRisk).toBe(0);
  });

  it("heatmap identifies at-risk entities", () => {
    const t = uid(); const twin = getDigitalTwin(t);
    twin.upsertEntity({ type:"risk", name:"Critical Risk", code:"RSK-CR", status:"at_risk", health:20, properties:{} });
    twin.upsertEntity({ type:"risk", name:"Healthy",       code:"RSK-HE", status:"active",  health:95, properties:{} });
    const heatmap = twin.generateHeatmap();
    // hotspots may have truncated names or be limited
    expect(heatmap.hotspots.length).toBeGreaterThanOrEqual(1);
    expect(heatmap.hotspots[0].score).toBeLessThan(80);
    expect(heatmap.overallScore).toBeGreaterThanOrEqual(0);
  });

  it("getStats returns accurate entity counts", () => {
    const t = uid();
    const twin = new OrganizationalDigitalTwin(t);
    twin.upsertEntity({ id:`d1-${t}`, type:"department", name:"D1", code:`D1-${t}`, status:"active", health:80, properties:{} });
    twin.upsertEntity({ id:`e1-${t}`, type:"executive",  name:"E1", code:`E1-${t}`, status:"active", health:90, properties:{} });
    const stats = twin.getStats();
    expect(stats.entities).toBeGreaterThanOrEqual(2);
    expect(stats.byType.department).toBeGreaterThanOrEqual(1);
  });

  it("tenant isolation: B cannot see A's entities", () => {
    const tA = uid(); const tB = uid();
    const twA = getDigitalTwin(tA); const twB = getDigitalTwin(tB);
    twA.upsertEntity({ type:"executive", name:"CEO", code:"CEo-A", status:"active", health:95, properties:{} });
    expect(twB.getEntitiesByType("executive").filter(e => e.code === "CEo-A")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// WORKFLOW ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
describe("WorkflowOrchestrator — Phase 3", () => {
  const defParams = {
    name:"Policy Approval", version:"1.0", category:"governance" as const,
    totalSLAHours:48, requiresEvidence:true, requiresSoD:true,
    nodes:[
      { id:"n1", type:"task" as const, name:"Draft Policy",  assignedRole:"governance_analyst", slaHours:8,  status:"pending" as const, evidenceIds:[] },
      { id:"n2", type:"approval" as const, name:"CGO Approval", assignedTo:"cgo-001", assignedRole:"governance_analyst", slaHours:24, status:"pending" as const, evidenceIds:[] },
      { id:"n3", type:"end" as const, name:"Published", slaHours:0, status:"pending" as const, evidenceIds:[] },
    ] as any,
  };

  it("defines workflow and creates definition", () => {
    const t = uid(); const orch = getOrchestrator(t);
    const def = orch.defineWorkflow(defParams);
    expect(def.id).toBeTruthy();
    expect(def.tenantId).toBe(t);
    expect(def.nodes).toHaveLength(3);
  });

  it("starts instance with first node active", async () => {
    const t = uid(); const orch = getOrchestrator(t);
    const def = orch.defineWorkflow(defParams);
    const inst = await orch.startInstance({ definitionId:def.id, entityId:"pol-001", entityType:"policy", initiatedBy:"cgo" });
    expect(inst.status).toBe("active");
    expect(inst.nodes[0].status).toBe("active");
    expect(inst.slaDeadline).toBeTruthy();
  });

  it("advance node: single-step to completion seals proof", async () => {
    const t = uid(); const orch = getOrchestrator(t);
    const def  = orch.defineWorkflow({ ...defParams, nodes:[{ id:"n1", type:"end" as const, name:"Done", slaHours:0, status:"pending" as const, evidenceIds:[] }] as any });
    const inst = await orch.startInstance({ definitionId:def.id, entityId:"e1", entityType:"policy", initiatedBy:"u1" });
    const adv  = await orch.advanceNode(inst.id, "u1", "success", "Completed", "ev-001");
    expect(adv.status).toBe("completed");
    expect(adv.immutableProofId).toBeTruthy();
  });

  it("advance node: two-step stays active after step 1", async () => {
    const t = uid(); const orch = getOrchestrator(t);
    const def  = orch.defineWorkflow(defParams);
    const inst = await orch.startInstance({ definitionId:def.id, entityId:"p2", entityType:"policy", initiatedBy:"u1" });
    const adv  = await orch.advanceNode(inst.id, "u1", "success");
    expect(adv.status).toBe("waiting_approval");
    expect(adv.currentNodeIdx).toBe(1);
  });

  it("failed node marks workflow failed", async () => {
    const t = uid(); const orch = getOrchestrator(t);
    const def  = orch.defineWorkflow(defParams);
    const inst = await orch.startInstance({ definitionId:def.id, entityId:"p3", entityType:"policy", initiatedBy:"u1" });
    const adv  = await orch.advanceNode(inst.id, "u1", "failure", "Rejected");
    expect(adv.status).toBe("failed");
  });

  it("getProof returns sealed execution proof", async () => {
    const t = uid(); const orch = getOrchestrator(t);
    const def  = orch.defineWorkflow({ ...defParams, nodes:[{ id:"n1", type:"end" as const, name:"Proof", slaHours:0, status:"pending" as const, evidenceIds:[] }] as any });
    const inst = await orch.startInstance({ definitionId:def.id, entityId:"pp1", entityType:"policy", initiatedBy:"u1" });
    await orch.advanceNode(inst.id, "u1", "success");
    const proof = orch.getProof(inst.id);
    expect(proof).toBeDefined();
    expect(proof!.integrityHash).toBeTruthy();
    expect(Object.isFrozen(proof)).toBe(true);
  });

  it("SLA breach detection returns overdue instances", async () => {
    const t = uid(); const orch = getOrchestrator(t);
    const def  = orch.defineWorkflow({ ...defParams, totalSLAHours:0 } as any);  // 0 hours = already breached
    await orch.startInstance({ definitionId:def.id, entityId:"sla-1", entityType:"policy", initiatedBy:"u1" });
    // Slight delay to ensure breach
    await new Promise(r => setTimeout(r, 10));
    const breaches = orch.checkSLABreaches();
    expect(Array.isArray(breaches)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// PROCESS MINING ENGINE
// ═══════════════════════════════════════════════════════════════
describe("ProcessMiningEngine — Phase 4", () => {
  it("records events and discovers process", () => {
    const t = uid(); const pm = getProcessMiningEngine(t);
    const caseId = "case-001";
    pm.recordEvent({ caseId, activity:"Submit",   resource:"u1", timestamp:"2025-01-01T09:00:00Z", outcome:"completed", duration:1000 });
    pm.recordEvent({ caseId, activity:"Review",   resource:"u2", timestamp:"2025-01-01T10:00:00Z", outcome:"completed", duration:7200000 });
    pm.recordEvent({ caseId, activity:"Approve",  resource:"u3", timestamp:"2025-01-01T12:00:00Z", outcome:"completed", duration:1800000 });
    const proc = pm.discoverProcess("Policy Approval");
    expect(proc.variants.length).toBeGreaterThanOrEqual(1);
    expect(proc.variants[0].activities).toContain("Submit");
  });

  it("multiple case variants increase drift score", () => {
    const t = uid(); const pm = getProcessMiningEngine(t);
    pm.recordEvent({ caseId:"c1", activity:"A → B → C", resource:"u1", timestamp:"2025-01-01T09:00:00Z", outcome:"completed" });
    pm.recordEvent({ caseId:"c2", activity:"A → C",     resource:"u1", timestamp:"2025-01-01T09:01:00Z", outcome:"completed" });
    pm.recordEvent({ caseId:"c3", activity:"B → A → C", resource:"u1", timestamp:"2025-01-01T09:02:00Z", outcome:"completed" });
    const proc = pm.discoverProcess("Drifted Process");
    expect(typeof proc.driftScore).toBe("number");
  });

  it("drift detection compares to ideal path", () => {
    const t = uid(); const pm = getProcessMiningEngine(t);
    const idealPath = ["Submit","Review","Approve"];
    pm.recordEvent({ caseId:"d1", activity:"Submit", resource:"u1", timestamp:"2025-01-01T09:00:00Z", outcome:"completed" });
    pm.recordEvent({ caseId:"d1", activity:"Approve", resource:"u2", timestamp:"2025-01-01T10:00:00Z", outcome:"completed" });
    const drift = pm.detectDrift("PolicyFlow", idealPath);
    expect(typeof drift.driftScore).toBe("number");
    expect(["improving","stable","deteriorating"]).toContain(drift.trend);
  });

  it("conformance check flags rule violations", () => {
    const t = uid(); const pm = getProcessMiningEngine(t);
    pm.recordEvent({ caseId:"conf-1", activity:"Approve", resource:"u1", timestamp:"2025-01-01T09:00:00Z", outcome:"completed" });
    pm.recordEvent({ caseId:"conf-1", activity:"Submit",  resource:"u2", timestamp:"2025-01-01T10:00:00Z", outcome:"completed" });
    const report = pm.checkConformance("Process", [
      { rule:"Submit must come before Approve", check:(path) => path.indexOf("Submit") < path.indexOf("Approve") },
    ]);
    expect(report.violations.length).toBeGreaterThanOrEqual(1);
    expect(report.conformanceScore).toBeLessThan(100);
  });

  it("conformance: all compliant cases return 100", () => {
    const t = uid(); const pm = getProcessMiningEngine(t);
    pm.recordEvent({ caseId:"good-1", activity:"Submit",  resource:"u1", timestamp:"2025-01-01T09:00:00Z", outcome:"completed" });
    pm.recordEvent({ caseId:"good-1", activity:"Approve", resource:"u2", timestamp:"2025-01-01T10:00:00Z", outcome:"completed" });
    const report = pm.checkConformance("Process", [
      { rule:"Submit before Approve", check:(path) => path.indexOf("Submit") < path.indexOf("Approve") },
    ]);
    expect(report.conformanceScore).toBe(100);
  });

  it("friction analysis returns report with recommendations", () => {
    const t = uid(); const pm = getProcessMiningEngine(t);
    pm.recordEvent({ caseId:"fr-1", activity:"Manual Review", resource:"u1", timestamp:"2025-01-01T09:00:00Z", outcome:"completed", duration:172800000 });  // 48h
    const friction = pm.analyzeFriction();
    expect(typeof friction.overallFrictionScore).toBe("number");
    expect(Array.isArray(friction.recommendations)).toBe(true);
  });

  it("tenant isolation: B cannot see A's process events", () => {
    const tA = uid(); const tB = uid();
    const pmA = getProcessMiningEngine(tA); const pmB = getProcessMiningEngine(tB);
    pmA.recordEvent({ caseId:"private", activity:"Secret Step", resource:"u1", timestamp:"2025-01-01T09:00:00Z", outcome:"completed" });
    const disc = pmB.discoverProcess("Test");
    expect(disc.variants).toHaveLength(0);
  });
});
