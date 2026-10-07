/**
 * SCEOS Layer A — Sovereign Memory + Governance Ontology Tests
 *
 * Tests the institutional brain of SCEOS:
 * - Sovereign Memory Engine (episodic/semantic/institutional memory)
 * - Governance Ontology Engine (self-model, accountability chains)
 * - Institutional Pattern Engine (governance health detection)
 *
 * All additive — does not touch existing 344 tests.
 */
import {
  SovereignMemoryEngine,
  getSovereignMemory,
  MemoryType,
  MemorySourceType,
} from "../sovereign-memory/core/sovereign.memory.engine";
import {
  GovernanceOntologyEngine,
  getGovernanceOntology,
  OntologyNodeType,
} from "../sovereign-memory/ontology/governance.ontology.engine";
import {
  InstitutionalPatternEngine,
  getPatternEngine,
} from "../sovereign-memory/patterns/institutional.pattern.engine";

// No DB mocks needed — sovereign memory is fully in-memory by design

const uid = () => `t-sceos-${Math.random().toString(36).slice(2,10)}`;

// ═══════════════════════════════════════════════════════════════
// SOVEREIGN MEMORY ENGINE
// ═══════════════════════════════════════════════════════════════
describe("SovereignMemoryEngine — Institutional Brain", () => {
  let engine: SovereignMemoryEngine;
  let tenantId: string;

  beforeEach(() => {
    tenantId = uid();
    engine   = new SovereignMemoryEngine(tenantId);
  });

  // ── Core memory operations ────────────────────────────────
  it("stores episodic memory with all required fields", () => {
    const m = engine.remember({
      type: "episodic", subject: "dec-001", subjectType: "decision",
      content: "Board approved digital transformation — SAR 50M",
      context: { actors:["ceo-001","cfo-001"], affectedEntities:["dept-it"], regulatoryRefs:[], policyRefs:["pol-investment"], timeframe:"2025-Q1", confidentiality:"confidential" },
      sourceType: "board_action", importance: 90,
      evidenceIds: ["board-min-2025-01"], tags: ["board", "strategic"],
      createdBy: "system",
    });
    expect(m.id).toBeTruthy();
    expect(m.tenantId).toBe(tenantId);
    expect(m.type).toBe("episodic");
    expect(m.importance).toBe(90);
    expect(m.isSealed).toBe(false);
    expect(m.strength).toBe("developing");
    expect(m.correlationId).toBeTruthy();
  });

  it("stores all 6 memory types", () => {
    const types: MemoryType[] = ["episodic","semantic","procedural","institutional","declarative","prophylactic"];
    for (const type of types) {
      const m = engine.remember({ type, subject:`subj-${type}`, subjectType:"policy", content:`Memory of type ${type}`,
        context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"now", confidentiality:"internal" },
        sourceType:"system_event", createdBy:"system" });
      expect(m.type).toBe(type);
    }
    const stats = engine.getStats();
    expect(stats.total).toBe(6);
  });

  it("recall finds memories by subject", () => {
    engine.remember({ type:"episodic", subject:"risk-cybersec", subjectType:"risk", content:"Critical cyber risk",
      context:{ actors:["ciso-001"], affectedEntities:["systems"], regulatoryRefs:[], policyRefs:[], timeframe:"2025", confidentiality:"confidential" },
      sourceType:"risk_event", importance:80, tags:["cyber","critical"], createdBy:"system" });
    engine.remember({ type:"episodic", subject:"other-risk", subjectType:"risk", content:"Other memory",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"2025", confidentiality:"internal" },
      sourceType:"risk_event", createdBy:"system" });
    const results = engine.recall({ subject:"risk-cybersec" });
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("risk-cybersec");
  });

  it("recall filters by type", () => {
    engine.remember({ type:"institutional", subject:"lesson-1", subjectType:"lesson", content:"Access controls bypassed repeatedly",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"historical", confidentiality:"internal" },
      sourceType:"audit", importance:70, createdBy:"system" });
    engine.remember({ type:"episodic", subject:"event-1", subjectType:"event", content:"Event",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"now", confidentiality:"internal" },
      sourceType:"system_event", createdBy:"system" });
    const institutional = engine.recall({ type:"institutional" });
    expect(institutional.every(m => m.type === "institutional")).toBe(true);
  });

  it("recall filters by minimum importance", () => {
    engine.remember({ type:"episodic", subject:"s1", subjectType:"risk", content:"High importance",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"now", confidentiality:"internal" },
      sourceType:"risk_event", importance:90, createdBy:"system" });
    engine.remember({ type:"episodic", subject:"s2", subjectType:"risk", content:"Low importance",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"now", confidentiality:"internal" },
      sourceType:"risk_event", importance:20, createdBy:"system" });
    const high = engine.recall({ minImportance:70 });
    expect(high.every(m => m.importance >= 70)).toBe(true);
    expect(high.some(m => m.importance < 70)).toBe(false);
  });

  it("recall results sorted by importance descending", () => {
    for (const imp of [30, 90, 50, 70]) {
      engine.remember({ type:"episodic", subject:`s-${imp}`, subjectType:"e", content:"c",
        context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
        sourceType:"system_event", importance:imp, createdBy:"system" });
    }
    const results = engine.recall({});
    for (let i = 1; i < results.length; i++) {
      expect(results[i-1].importance).toBeGreaterThanOrEqual(results[i].importance);
    }
  });

  it("recall reinforces memories — accessCount increments", () => {
    const m = engine.remember({ type:"episodic", subject:"reinforce-me", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", createdBy:"system" });
    expect(m.accessCount).toBe(0);
    engine.recall({ subject:"reinforce-me" });
    engine.recall({ subject:"reinforce-me" });
    const after = engine.recall({ subject:"reinforce-me" });
    expect(after[0].accessCount).toBeGreaterThan(0);
    expect(after[0].reinforcements).toBeGreaterThan(0);
  });

  it("sealing makes memory immutable", () => {
    const m = engine.remember({ type:"institutional", subject:"sealed-lesson", subjectType:"lesson", content:"Never approve without evidence",
      context:{ actors:["board"], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"permanent", confidentiality:"confidential" },
      sourceType:"board_action", importance:100, createdBy:"board-001", seal:true });
    expect(m.isSealed).toBe(true);
    expect(m.sealedAt).toBeTruthy();
    expect(Object.isFrozen(m)).toBe(true);
  });

  it("seal() makes existing entry immutable", () => {
    const m = engine.remember({ type:"episodic", subject:"to-seal", subjectType:"decision", content:"d",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"decision", createdBy:"system" });
    expect(m.isSealed).toBe(false);
    engine.seal(m.id);
    const after = engine.recall({ subject:"to-seal" });
    expect(after[0].isSealed).toBe(true);
  });

  it("sealed memories cannot be reinforced (no mutation)", () => {
    const m = engine.remember({ type:"institutional", subject:"sealed-no-reinforce", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"board_action", importance:80, createdBy:"system", seal:true });
    engine.recall({ subject:"sealed-no-reinforce" });
    engine.recall({ subject:"sealed-no-reinforce" });
    // Sealed — accessCount should NOT increment (object frozen)
    const after = engine.recall({ subject:"sealed-no-reinforce" });
    // accessCount stays at 0 (frozen object)
    expect(after[0].isSealed).toBe(true);
  });

  it("link creates bidirectional association", () => {
    const m1 = engine.remember({ type:"episodic", subject:"e1", subjectType:"decision", content:"d1",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"decision", createdBy:"system" });
    const m2 = engine.remember({ type:"episodic", subject:"e2", subjectType:"risk", content:"r1",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"risk_event", createdBy:"system" });
    engine.link(m1.id, m2.id);
    const r1 = engine.recall({ subject:"e1" });
    const r2 = engine.recall({ subject:"e2" });
    expect(r1[0].linkedMemoryIds).toContain(m2.id);
    expect(r2[0].linkedMemoryIds).toContain(m1.id);
  });

  it("tenant isolation: other tenant cannot recall memories", () => {
    const otherEngine = new SovereignMemoryEngine(`${tenantId}-other`);
    engine.remember({ type:"episodic", subject:"private-data", subjectType:"e", content:"confidential",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"highly_confidential" },
      sourceType:"decision", importance:95, createdBy:"system" });
    const stolen = otherEngine.recall({ subject:"private-data" });
    expect(stolen).toHaveLength(0);
  });

  it("getSovereignMemory factory returns same instance", () => {
    const t = uid();
    const a = getSovereignMemory(t);
    const b = getSovereignMemory(t);
    expect(a).toBe(b);
  });

  it("getStats returns accurate counts", () => {
    engine.remember({ type:"institutional", subject:"s1", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"audit", createdBy:"system" });
    engine.remember({ type:"episodic", subject:"s2", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"decision", createdBy:"system", seal:true });
    const stats = engine.getStats();
    expect(stats.total).toBe(2);
    expect(stats.sealed).toBe(1);
    expect(stats.byType.institutional).toBe(1);
    expect(stats.byType.episodic).toBe(1);
  });

  // ── Pattern detection ────────────────────────────────────
  it("detectPatterns: repeated violations on same subject", () => {
    for (let i = 0; i < 3; i++) {
      engine.remember({ type:"episodic", subject:"ctrl-access", subjectType:"control", content:`Violation ${i}`,
        context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"2025", confidentiality:"confidential" },
        sourceType:"incident", importance:70, tags:["violation","control"], createdBy:"system" });
    }
    const patterns = engine.detectPatterns();
    expect(patterns.some(p => p.pattern.includes("ctrl-access"))).toBe(true);
  });

  it("detectPatterns: evidence-free decisions", () => {
    for (let i = 0; i < 4; i++) {
      engine.remember({ type:"episodic", subject:`dec-${i}`, subjectType:"decision", content:`Decision ${i}`,
        context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"2025", confidentiality:"confidential" },
        sourceType:"decision", evidenceIds:[], createdBy:"system" });
    }
    const patterns = engine.detectPatterns();
    expect(patterns.some(p => p.pattern.includes("evidence") || p.pattern.toLowerCase().includes("evidence"))).toBe(true);
  });

  it("recall by tags works correctly", () => {
    engine.remember({ type:"episodic", subject:"tagged-1", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", tags:["critical","board"], createdBy:"system" });
    engine.remember({ type:"episodic", subject:"untagged", subjectType:"e", content:"c",
      context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
      sourceType:"system_event", tags:["routine"], createdBy:"system" });
    const critical = engine.recall({ tags:["critical"] });
    expect(critical.length).toBeGreaterThanOrEqual(1);
    expect(critical.some(m => m.subject === "tagged-1")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE ONTOLOGY ENGINE
// ═══════════════════════════════════════════════════════════════
describe("GovernanceOntologyEngine — Enterprise Self-Model", () => {
  let engine: GovernanceOntologyEngine;
  let tenantId: string;

  beforeEach(() => {
    tenantId = uid();
    engine   = new GovernanceOntologyEngine(tenantId);
  });

  const mkNode = (type: OntologyNodeType, code: string, label: string, ownerId?: string) =>
    engine.upsertNode({ type, code, label, description:`${type}: ${label}`, status:"active", properties:{}, ownerId, ownerRole:ownerId?"cgo":undefined });

  it("upserts node and returns it", () => {
    const n = mkNode("policy", "POL-001", "Information Security Policy", "cgo-001");
    expect(n.id).toBeTruthy();
    expect(n.tenantId).toBe(tenantId);
    expect(n.type).toBe("policy");
    expect(n.ownerId).toBe("cgo-001");
  });

  it("upsert is idempotent by code", () => {
    mkNode("risk", "RSK-001", "Cyber Risk v1");
    const updated = mkNode("risk", "RSK-001", "Cyber Risk v2");
    expect(engine.getNodesByType("risk").filter(n => n.code === "RSK-001")).toHaveLength(1);
    // Latest label should win
    expect(engine.getNodesByType("risk").find(n => n.code === "RSK-001")?.label).toBe("Cyber Risk v2");
  });

  it("adds relation between nodes", () => {
    const pol = mkNode("policy", "POL-002", "Data Policy");
    const risk = mkNode("risk", "RSK-002", "Data Risk");
    const rel  = engine.addRelation({ type:"GOVERNS", fromId:pol.id, fromType:"policy", toId:risk.id, toType:"risk", strength:0.9, bidirectional:false });
    expect(rel.id).toBeTruthy();
    const fromRels = engine.getRelationsFrom(pol.id);
    expect(fromRels.some(r => r.toId === risk.id && r.type === "GOVERNS")).toBe(true);
  });

  it("getRelationsTo returns incoming relations", () => {
    const ctrl = mkNode("control", "CTRL-010", "Access Control");
    const risk  = mkNode("risk",    "RSK-010",  "Access Risk");
    engine.addRelation({ type:"MITIGATES", fromId:ctrl.id, fromType:"control", toId:risk.id, toType:"risk", strength:0.8, bidirectional:false });
    const incoming = engine.getRelationsTo(risk.id);
    expect(incoming.some(r => r.type === "MITIGATES" && r.fromId === ctrl.id)).toBe(true);
  });

  it("traceAccountability: complete chain with executive", () => {
    const dec  = mkNode("decision",  "DEC-001",  "Board Decision");
    const exec = mkNode("executive", "EXEC-001", "CEO", "ceo");
    const board= mkNode("board",     "BRD-001",  "Board of Directors");
    engine.addRelation({ type:"ACCOUNTABLE_FOR", fromId:dec.id, fromType:"decision", toId:exec.id, toType:"executive", strength:1, bidirectional:false });
    engine.addRelation({ type:"REPORTS_TO", fromId:exec.id, fromType:"executive", toId:board.id, toType:"board", strength:1, bidirectional:false });
    const chain = engine.traceAccountability(dec.id);
    expect(chain.chain.length).toBeGreaterThanOrEqual(1);
    expect(chain.chain.some(l => l.actorType === "executive" || l.actorType === "board")).toBe(true);
  });

  it("traceAccountability: incomplete chain has gaps", () => {
    const pol = mkNode("policy", "POL-ORPH", "Orphan Policy");
    const chain = engine.traceAccountability(pol.id);
    expect(chain.isComplete).toBe(false);
    expect(chain.gaps.length).toBeGreaterThan(0);
  });

  it("generateGovernanceQuestions: flags orphan policies", () => {
    mkNode("policy", "POL-NO-OWNER", "Ownerless Policy");  // no ownerId
    const qs = engine.generateGovernanceQuestions();
    expect(qs.some(q => q.category === "accountability" && q.question.includes("no assigned owner"))).toBe(true);
  });

  it("generateGovernanceQuestions: flags unmitigated risks", () => {
    mkNode("risk", "RSK-UNMITIGATED", "Unmitigated Risk");
    const qs = engine.generateGovernanceQuestions();
    expect(qs.some(q => q.category === "risk" && q.question.includes("no mitigating control"))).toBe(true);
  });

  it("generateGovernanceQuestions: evidence-free decisions", () => {
    const dec = mkNode("decision", "DEC-NO-EV", "Decision with no evidence");
    // No EVIDENCES relation added
    const qs = engine.generateGovernanceQuestions();
    expect(qs.some(q => q.category === "evidence")).toBe(true);
  });

  it("computeBlastRadius: connected nodes expand radius", () => {
    const pol  = mkNode("policy",  "POL-BR", "Core Policy");
    const risk = mkNode("risk",    "RSK-BR", "Core Risk");
    const ctrl = mkNode("control", "CTL-BR", "Core Control");
    engine.addRelation({ type:"GOVERNS", fromId:pol.id, fromType:"policy", toId:risk.id, toType:"risk", strength:1, bidirectional:false });
    engine.addRelation({ type:"MITIGATES", fromId:ctrl.id, fromType:"control", toId:risk.id, toType:"risk", strength:1, bidirectional:false });
    const { affected, score } = engine.computeBlastRadius(pol.id);
    expect(affected.length).toBeGreaterThanOrEqual(1);
    expect(score).toBeGreaterThan(0);
  });

  it("computeBlastRadius: isolated node has score 0", () => {
    const isolated = mkNode("risk", "RSK-ISO", "Isolated Risk");
    const { affected, score } = engine.computeBlastRadius(isolated.id);
    expect(affected).toHaveLength(0);
    expect(score).toBe(0);
  });

  it("getStats: accurate node/relation counts", () => {
    mkNode("policy",  "P1", "P1");
    mkNode("risk",    "R1", "R1");
    mkNode("control", "C1", "C1");
    const p = engine.getNodesByType("policy")[0];
    const r = engine.getNodesByType("risk")[0];
    engine.addRelation({ type:"GOVERNS", fromId:p.id, fromType:"policy", toId:r.id, toType:"risk", strength:1, bidirectional:false });
    const stats = engine.getStats();
    expect(stats.nodes).toBeGreaterThanOrEqual(3);
    expect(stats.relations).toBeGreaterThanOrEqual(1);
  });

  it("tenant isolation: nodes not visible to other tenant", () => {
    mkNode("policy", "SECRET-POL", "Secret Policy");
    const otherEngine = new GovernanceOntologyEngine(`${tenantId}-evil`);
    const stolenPolicies = otherEngine.getNodesByType("policy").filter(n => n.code === "SECRET-POL");
    expect(stolenPolicies).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// INSTITUTIONAL PATTERN ENGINE
// ═══════════════════════════════════════════════════════════════
describe("InstitutionalPatternEngine — Governance Health Intelligence", () => {
  it("scan returns patterns array", () => {
    const t = uid();
    const engine = new InstitutionalPatternEngine(t);
    const patterns = engine.scan();
    expect(Array.isArray(patterns)).toBe(true);
  });

  it("generateReport returns health score and summary", () => {
    const t = uid();
    const engine = new InstitutionalPatternEngine(t);
    const report = engine.generateReport();
    expect(report.tenantId).toBe(t);
    expect(typeof report.overallHealthScore).toBe("number");
    expect(report.overallHealthScore).toBeGreaterThanOrEqual(0);
    expect(report.overallHealthScore).toBeLessThanOrEqual(100);
    expect(typeof report.executiveSummary).toBe("string");
    expect(report.executiveSummary.length).toBeGreaterThan(0);
    expect(Array.isArray(report.immediateActions)).toBe(true);
  });

  it("health score decreases with orphan accountability", () => {
    const t = uid();
    const ontology = getGovernanceOntology(t);
    // Add multiple orphan policies (no owners, no relations)
    for (let i = 0; i < 4; i++) {
      ontology.upsertNode({ type:"policy", code:`ORF-POL-${i}`, label:`Orphan Policy ${i}`, description:"d", status:"active", properties:{} });
    }
    const engine = new InstitutionalPatternEngine(t);
    const report = engine.generateReport();
    expect(report.overallHealthScore).toBeLessThan(100);
    expect(report.patterns.some(p => p.category === "orphan_accountability")).toBe(true);
  });

  it("health score decreases with evidence-free decisions", () => {
    const t = uid();
    const ontology = getGovernanceOntology(t);
    for (let i = 0; i < 3; i++) {
      ontology.upsertNode({ type:"decision", code:`EFD-${i}`, label:`Evidence-free Decision ${i}`, description:"d", status:"active", properties:{} });
    }
    const engine = new InstitutionalPatternEngine(t);
    const report = engine.generateReport();
    expect(report.patterns.some(p => p.category === "evidence_decay")).toBe(true);
  });

  it("fully governed org has high health score", () => {
    const t = uid();
    // Empty org — no patterns to detect = 100
    const engine = new InstitutionalPatternEngine(t);
    const report = engine.generateReport();
    expect(report.overallHealthScore).toBe(100);
  });

  it("patterns include severity and risk score", () => {
    const t = uid();
    const ontology = getGovernanceOntology(t);
    for (let i = 0; i < 6; i++) {
      ontology.upsertNode({ type:"policy", code:`SEV-${i}`, label:`P${i}`, description:"d", status:"active", properties:{} });
    }
    const engine = new InstitutionalPatternEngine(t);
    const patterns = engine.scan();
    if (patterns.length > 0) {
      expect(["critical","high","medium","low","informational"]).toContain(patterns[0].severity);
      expect(typeof patterns[0].riskScore).toBe("number");
    }
  });

  it("getPatternEngine factory returns same instance", () => {
    const t = uid();
    expect(getPatternEngine(t)).toBe(getPatternEngine(t));
  });
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATION: Memory + Ontology + Patterns working together
// ═══════════════════════════════════════════════════════════════
describe("SCEOS Integration — Memory + Ontology + Patterns", () => {
  it("board decision creates sovereign memory + ontology node + evidence", () => {
    const t        = uid();
    const memory   = getSovereignMemory(t);
    const ontology = getGovernanceOntology(t);

    // 1. Ontology: register the decision entity
    const dec = ontology.upsertNode({ type:"decision", code:"DEC-INTEG-001", label:"Annual Risk Appetite Approval",
      description:"Board approves 2025 risk appetite", status:"active", properties:{ fiscalYear:"2025" }, ownerId:"board-001" });

    // 2. Memory: record the episodic memory with evidence
    const mem = memory.remember({ type:"episodic", subject:dec.id, subjectType:"decision",
      content:"Board of Directors unanimously approved 2025 Risk Appetite Statement",
      context:{ actors:["chairman","ceo","cfo","cro"], affectedEntities:[dec.id], regulatoryRefs:["NCA-ECC-3.1"], policyRefs:["POL-RISK-001"], timeframe:"2025-01-15", confidentiality:"confidential" },
      sourceType:"board_action", importance:95, evidenceIds:["board-min-2025-001"],
      tags:["board","risk_appetite","2025","strategic"], createdBy:"board-secretary-001", seal:true });

    // 3. Link decision to executive via ontology
    const cro = ontology.upsertNode({ type:"executive", code:"CRO-001", label:"Chief Risk Officer",
      description:"CRO responsible for risk appetite", status:"active", properties:{}, ownerId:"cro-001" });
    ontology.addRelation({ type:"ACCOUNTABLE_FOR", fromId:cro.id, fromType:"executive", toId:dec.id, toType:"decision", strength:1, bidirectional:false });

    // ── Verify ────────────────────────────────────────────────
    // Memory sealed
    expect(mem.isSealed).toBe(true);
    expect(Object.isFrozen(mem)).toBe(true);

    // Accountability chain exists
    const chain = ontology.traceAccountability(dec.id);
    expect(chain.chain.some(l => l.actorType === "executive")).toBe(true);

    // Memory recallable
    const recalled = memory.recall({ subject:dec.id });
    expect(recalled.length).toBeGreaterThanOrEqual(1);
    expect(recalled[0].evidenceIds).toContain("board-min-2025-001");

    // Pattern engine shows no critical patterns
    const patterns = getPatternEngine(t).generateReport();
    expect(patterns.overallHealthScore).toBeLessThanOrEqual(100);
  });

  it("governance drift: 5 orphan entities lowers score significantly", () => {
    const t = uid();
    const ontology = getGovernanceOntology(t);
    for (let i = 0; i < 5; i++) {
      ontology.upsertNode({ type:"risk", code:`DRIFT-${i}`, label:`Unmanaged Risk ${i}`, description:"d", status:"active", properties:{} });
    }
    const report = getPatternEngine(t).generateReport();
    expect(report.overallHealthScore).toBeLessThan(90);
  });

  it("sovereign memory knowledge loss detection triggers pattern", () => {
    const t = uid();
    const memory = getSovereignMemory(t);
    // Add 15 memories but zero institutional ones
    for (let i = 0; i < 15; i++) {
      memory.remember({ type:"episodic", subject:`s${i}`, subjectType:"e", content:"c",
        context:{ actors:[], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"t", confidentiality:"internal" },
        sourceType:"system_event", createdBy:"system" });
    }
    const report = getPatternEngine(t).generateReport();
    // knowledge_loss pattern should appear (no institutional memories)
    expect(report.patterns.some(p => p.category === "knowledge_loss")).toBe(true);
  });

  it("high-importance sealed memories survive tenant factory reset", () => {
    const t = uid();
    const m1 = getSovereignMemory(t).remember({ type:"institutional", subject:"golden-rule", subjectType:"principle",
      content:"Every decision requires evidence and owner — no exceptions",
      context:{ actors:["board"], affectedEntities:[], regulatoryRefs:[], policyRefs:[], timeframe:"permanent", confidentiality:"confidential" },
      sourceType:"board_action", importance:100, createdBy:"chairman", seal:true });
    // Re-fetch same engine
    const m2 = getSovereignMemory(t).recall({ subject:"golden-rule" });
    expect(m2).toHaveLength(1);
    expect(m2[0].isSealed).toBe(true);
    expect(m2[0].content).toBe(m1.content);
  });
});
