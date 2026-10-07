/**
 * Executive Cockpit API Routes — Production Stabilization Layer
 *
 * Aggregates ALL runtime intelligence into a single executive surface:
 *   /api/executive/cockpit             — Full executive state snapshot
 *   /api/executive/governance-graph    — Live governance graph queries
 *   /api/executive/decision-intelligence — Decision analysis + what-if
 *   /api/executive/risk-heatmap        — Live risk heatmap
 *   /api/executive/compliance-radar    — Compliance exposure radar
 *   /api/executive/board-readiness     — Board-grade readiness score
 *   /api/executive/ai-governance       — AI governance posture
 *   /api/executive/external-intelligence — Regulatory + geo signals
 *   /api/executive/integrity-certificate — Production certification
 *   /api/executive/governance-timeline — Temporal governance replay
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.middleware";
import { checkPermission } from "../../middleware/rbac.middleware";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { injectTenantContext } from "../../../tenant/tenant.context";

// Runtime imports
import { getKernel } from "../../../runtime/institutional-kernel/institutional.kernel";
import { getThermodynamics } from "../../../runtime/thermodynamics/organizational.thermodynamics";
import { getTimeIntelligence } from "../../../runtime/time-intelligence/strategic.time.intelligence";
import { getPredictiveRuntime } from "../../../analytics-runtime/predictive/predictive.governance.runtime";
import { getExternalIntelligence } from "../../../runtime/external-intelligence/external.intelligence.runtime";
import { getAISafetyRuntime } from "../../../runtime/ai-safety/ai.governance.safety.runtime";
import { getIntegrityCertEngine } from "../../../runtime/integrity-certification/integrity.certification.engine";
import { getDataMaturityEngine } from "../../../runtime/data-maturity/data.maturity.engine";
import { getConfidenceExplainabilityEngine } from "../../../runtime/explainability/confidence.explainability.engine";
import { getSmartUploadEngine, FrameworkId } from "../../../runtime/smart-upload/smart.upload.engine";
import { getAuditOverrideEngine } from "../../../runtime/audit-override/audit.override.engine";
import { getBoardReportGenerator } from "../../../reporting/board-reports/board.report.generator";
import { getThirdSectorEngine, EntityType, PracticeResponse } from "../../../runtime/third-sector/third.sector.assessment.engine";
import { getLegalChangeDetector, getReviewQueue } from "../../../runtime/legal-update/detector/legal.change.detector";
import { getAuditOverrideEngine as _aoe } from "../../../runtime/audit-override/audit.override.engine";
import { getDRRuntime } from "../../../runtime/disaster-recovery/disaster.recovery.runtime";
import { getSelfHealingRuntime } from "../../../runtime/self-healing/self.healing.runtime";

// GRC Runtime imports
import { getGRCOntology } from "../../../grc-ontology/grc.ontology.engine"; import { getGovernanceOntology } from "../../../sovereign-memory/ontology/governance.ontology.engine";
import { getBoardRuntime } from "../../../governance-runtime/board/board.runtime";
import { getRiskRuntime } from "../../../risk-runtime/register/risk.intelligence.runtime";
import { getComplianceObligationRuntime } from "../../../compliance-runtime/obligations/compliance.obligation.runtime";
import { getCCMRuntime } from "../../../compliance-runtime/ccm/ccm.runtime";
import { getIncidentRuntime } from "../../../resilience-runtime/incidents/incident.crisis.runtime";
import { getResilienceRuntime } from "../../../resilience-runtime/continuity/operational.resilience.runtime";
import { getAssuranceRuntime } from "../../../assurance-runtime/integrated/integrated.assurance.runtime";
import { getAuthorityEngine } from "../../../governance-runtime/authority/authority.engine";
import { getPolicyRuntime } from "../../../governance-runtime/policy/governance.policy.runtime";
import { getCommitteeRuntime } from "../../../governance-runtime/committees/committee.runtime";

// Persistence + memory
import { getEventStore } from "../../../runtime/persistence/persistent.event.store";
import { getSovereignMemory } from "../../../sovereign-memory/core/sovereign.memory.engine";
import { getPatternEngine } from "../../../sovereign-memory/patterns/institutional.pattern.engine";
import { runGovernanceMonteCarlo } from "../../../runtime/simulation/monte.carlo.governance.engine";

export const executiveRouter = Router();
executiveRouter.use(authMiddleware);
executiveRouter.use(injectTenantContext);

// ══════════════════════════════════════════════════════════════
// 1. EXECUTIVE COCKPIT — Full snapshot of enterprise state
// ══════════════════════════════════════════════════════════════
executiveRouter.get("/cockpit", checkPermission("dashboard:read"), async (req:Request, res:Response): Promise<void> => {
  const tid = req.tenantCtx!.tenantId;
  const [kernel, thermo, timeIntel, predictive, extIntel] = [
    getKernel(tid), getThermodynamics(tid), getTimeIntelligence(tid),
    getPredictiveRuntime(tid), getExternalIntelligence(tid),
  ];

  const health    = kernel.computeHealthState();
  const heatReport= thermo.generateReport();
  const forecast  = timeIntel.generateReport("30d");
  const cockpit   = predictive.buildExecutiveCockpit();
  extIntel.loadBaseline();
  const extSummary= extIntel.generateSummary();
  const assurance = getAssuranceRuntime(tid).getLatestOpinion();
  const ccm       = getCCMRuntime(tid);
  const incident  = getIncidentRuntime(tid);
  const resilience= getResilienceRuntime(tid);
  const evtStats  = getEventStore(tid).getStats();
  const memStats  = getSovereignMemory(tid).getStats();
  const patterns  = getPatternEngine(tid).generateReport();

  res.json({
    tenantId:        tid,
    generatedAt:     new Date().toISOString(),
    version:         "8.0",

    // Institutional health
    institutionalHealth: {
      overallScore:           health.overallHealthScore,
      governancePressure:     health.governancePressureIndex,
      executionFriction:      health.executionFrictionIndex,
      accountabilityCoverage: health.accountabilityCoverageScore,
      evidenceCompleteness:   health.evidenceCompletenessScore,
      decisionConfidence:     health.decisionConfidenceScore,
    },

    // Organizational thermodynamics
    organizationalTemperature: {
      overall:              heatReport.metrics.overallTemperature,
      executionHeat:        heatReport.metrics.executionHeat,
      governanceLoad:       heatReport.metrics.governanceLoad,
      decisionCongestion:   heatReport.metrics.decisionCongestion,
      entropyScore:         heatReport.metrics.entropyScore,
      criticalPressurePoints:heatReport.criticalPressurePoints,
    },

    // Board & governance status
    governance: {
      boardReadiness:         cockpit.boardReadiness,
      pendingResolutions:     cockpit.pendingResolutions,
      activePolicies:         getPolicyRuntime(tid).getAll("active").length,
      activeCommittees:       getCommitteeRuntime(tid).getMeetings().length,
      authorityGaps:          getGovernanceOntology(tid).generateGovernanceQuestions().filter((q:any)=>q.category==="accountability").length,
    },

    // Risk posture
    risk: {
      openRisks:              health.openRisks,
      toleranceBreaches:      cockpit.toleranceBreaches,
      enterpriseExposure:     cockpit.enterpriseRiskExposure,
    },

    // Compliance posture
    compliance: {
      health:                 cockpit.complianceHealth,
      obligationBreaches:     cockpit.obligationBreaches,
      controlEffectiveness:   cockpit.controlEffectiveness,
      ccmOverallScore:        ccm.getOverallScore(),
      overrideSignals:        ccm.getSignals("critical").length,
    },

    // Resilience & incidents
    resilience: {
      openCrises:             cockpit.openCrises,
      openCAPAs:              cockpit.openCAPAs,
      resilienceScore:        resilience.scoreResilience().overallScore,
    },

    // Assurance
    assurance: {
      latestOpinion:          assurance?.overallRating ?? "not_assessed",
      latestScore:            assurance?.overallScore ?? 0,
      evidenceCount:          getAssuranceRuntime(tid).getEvidence().length,
    },

    // AI governance
    aiGovernance: {
      pendingApprovals:       getAISafetyRuntime(tid).getPendingApprovals().length,
      blockedActions:         getAISafetyRuntime(tid).getBlockedActions().length,
      hallucinationAlerts:    getAISafetyRuntime(tid).getHallucinationReports().filter(h=>h.detected).length,
    },

    // External intelligence
    externalIntelligence: {
      regulatoryChanges:      extSummary.regulatoryChanges,
      criticalChanges:        extSummary.criticalChanges,
      geopoliticalSignals:    extSummary.geopoliticalSignals,
      earlyWarnings:          extSummary.earlyWarnings,
      overallExposureScore:   extSummary.overallExposureScore,
    },

    // Runtime health
    runtime: {
      eventsInStore:          evtStats.totalEvents,
      chainValid:             evtStats.chainValid,
      memoryDepth:            memStats.total,
      governancePatterns:     patterns.patterns.length,
      criticalPatterns:       patterns.criticalCount,
    },

    // Strategic outlook
    forecast: {
      trendDirection:         cockpit.trend,
      thirtyDayOutlook:       cockpit.forecast30d,
      earlyWarnings:          forecast.earlyWarnings.map(w=>w.signal),
    },

    // Immediate actions (top 5)
    immediateActions:         [...cockpit.immediateActions, ...heatReport.boardWarnings, ...extSummary.immediateActions].slice(0,5),
  });
});

// ══════════════════════════════════════════════════════════════
// 2. GOVERNANCE GRAPH — Live graph queries
// ══════════════════════════════════════════════════════════════
const GraphQuerySchema = z.object({
  entityType: z.string().optional(),
  query:      z.enum(["accountability_gaps","orphan_entities","blast_radius","governance_questions","all_relations"]).optional().default("governance_questions"),
  entityId:   z.string().optional(),
  maxDepth:   z.coerce.number().int().min(1).max(6).optional().default(4),
});

executiveRouter.get("/governance-graph", checkPermission("dashboard:read"), validateQuery(GraphQuerySchema), (req:Request, res:Response): void => {
  const tid      = req.tenantCtx!.tenantId;
  const ontology = getGRCOntology(tid);
  const q        = (req as any).validatedQuery as z.infer<typeof GraphQuerySchema>;
  const stats    = ontology.getStats();

  let result: Record<string, unknown> = { stats };

  switch(q.query) {
    case "accountability_gaps":
      result.gaps = getGovernanceOntology(tid).generateGovernanceQuestions().filter((gq:any) => gq.category === "accountability");
      result.count = (result.gaps as any[]).length;
      break;
    case "orphan_entities":
      result.questions = getGovernanceOntology(tid).generateGovernanceQuestions();
      result.orphanCount = stats.entities === 0 ? 0 :
        getGovernanceOntology(tid).generateGovernanceQuestions().length;
      break;
    case "blast_radius":
      if (!q.entityId) { res.status(422).json({error:"entityId required for blast_radius query"}); return; }
      const blast = ontology.blastRadius(q.entityId, q.maxDepth);
      result.blast = { sourceEntityId:q.entityId, affectedEntities:blast.length, entities:blast.slice(0,20) };
      break;
    case "governance_questions":
      result.questions = getGovernanceOntology(tid).generateGovernanceQuestions();
      result.total     = (result.questions as any[]).length;
      break;
    case "all_relations":
      if (q.entityId) {
        result.outbound = ontology.getOutbound(q.entityId);
        result.inbound  = ontology.getInbound(q.entityId);
      } else {
        result.message = "Provide entityId to query relations";
        result.stats   = stats;
      }
      break;
  }
  res.json({ tenantId:tid, query:q.query, generatedAt:new Date().toISOString(), ...result });
});

// ══════════════════════════════════════════════════════════════
// 3. DECISION INTELLIGENCE — What-if + impact analysis
// ══════════════════════════════════════════════════════════════
const DecisionSchema = z.object({
  decisionType:    z.enum(["policy_change","authority_change","control_removal","risk_acceptance","vendor_onboard","board_resolution","exception_approval","ai_deployment"]),
  entityId:        z.string().optional(),
  description:     z.string().min(10),
  actorId:         z.string().min(1),
  estimatedImpact: z.enum(["low","medium","high","critical"]),
  parameters:      z.record(z.unknown()).default({}),
});

executiveRouter.post("/decision-intelligence", checkPermission("entity:read"), validate(DecisionSchema), (req:Request, res:Response): void => {
  const tid  = req.tenantCtx!.tenantId;
  const body = req.body as z.infer<typeof DecisionSchema>;

  // Pull live state for context
  const risk      = getRiskRuntime(tid);
  const compl     = getComplianceObligationRuntime(tid);
  const ccm       = getCCMRuntime(tid);
  const ontology  = getGRCOntology(tid);
  const authority = getAuthorityEngine(tid);

  // Authority check for this decision type
  const authCheck = authority.checkAuthority({ actorId:body.actorId, action:`approve_${body.decisionType}`, scope:body.decisionType });

  // Risk impact scoring by decision type
  const riskDeltas: Record<string, {delta:number;financial:number;complianceExposure:string}> = {
    policy_change:     { delta:-5,  financial:-50000,   complianceExposure:"reduced" },
    authority_change:  { delta:+10, financial:+25000,   complianceExposure:"increased" },
    control_removal:   { delta:+25, financial:+500000,  complianceExposure:"high" },
    risk_acceptance:   { delta:+15, financial:+200000,  complianceExposure:"medium" },
    vendor_onboard:    { delta:+8,  financial:+50000,   complianceExposure:"medium" },
    board_resolution:  { delta:-10, financial:-100000,  complianceExposure:"reduced" },
    exception_approval:{ delta:+20, financial:+150000,  complianceExposure:"high" },
    ai_deployment:     { delta:+12, financial:+75000,   complianceExposure:"medium" },
  };
  const impact = riskDeltas[body.decisionType];

  // Blast radius from ontology
  const blastEntities = body.entityId ? ontology.blastRadius(body.entityId, 3) : [];

  // Current state context
  const currentRiskScore   = Math.min(100, risk.getBreachingTolerance().length * 10);
  const currentCompliance  = compl.getBreached().length;
  const controlHealth      = ccm.getOverallScore();

  // Contradiction detection
  const contradictions: string[] = [];
  if (body.decisionType === "control_removal" && controlHealth < 70) {
    contradictions.push(`Control health already at ${controlHealth}% — removing controls risks cascade failure`);
  }
  if (body.decisionType === "risk_acceptance" && currentRiskScore >= 30) {
    contradictions.push(`${risk.getBreachingTolerance().length} risks already exceed tolerance — additional acceptance increases systemic exposure`);
  }
  if (body.decisionType === "exception_approval" && currentCompliance >= 3) {
    contradictions.push(`${currentCompliance} active compliance breaches — granting exception sends negative governance signal`);
  }
  if (body.decisionType === "ai_deployment" && getAISafetyRuntime(tid).getPendingApprovals().length >= 3) {
    contradictions.push("Multiple AI actions pending approval — additional deployment increases oversight burden");
  }

  // Governance questions this decision raises
  const governanceQuestions = [
    `Who bears accountability if this ${body.decisionType} fails?`,
    `What evidence supports this decision?`,
    `Has the risk committee reviewed the exposure?`,
    ...(impact.delta > 10 ? [`High risk delta (+${impact.delta}) — does board approval apply?`] : []),
  ];

  // Recommendations
  const recommendations: string[] = [
    ...(!authCheck.authorized ? [`Actor "${body.actorId}" lacks authority — obtain authorization before proceeding`] : []),
    ...(contradictions.length > 0 ? ["Address contradictions before proceeding"] : ["Decision appears consistent with current governance state"]),
    ...(impact.delta > 15 ? ["Recommend full GRC fabric check before execution"] : []),
    ...(blastEntities.length > 3 ? [`${blastEntities.length} entities affected — conduct stakeholder notification`] : []),
  ];

  res.json({
    tenantId:   tid,
    analyzedAt: new Date().toISOString(),
    decision: {
      type:        body.decisionType,
      description: body.description,
      actorId:     body.actorId,
      authorized:  authCheck.authorized,
      authReason:  authCheck.reason,
    },
    impact: {
      riskDelta:          impact.delta,
      financialEstimate:  impact.financial,
      financialModelGovernance: {
        currency: "SAR",
        calibrationStatus: "heuristic_uncalibrated",
        modelVersion: "DECISION-IMPACT-1.1",
        permittedUse: "stress_test_only",
        source: "Built-in SGIP decision stress-test assumptions; tenant/source calibration required before budgeting, provisioning, valuation, or investment reliance.",
      },
      complianceExposure: impact.complianceExposure,
      blastRadiusCount:   blastEntities.length,
      affectedEntities:   blastEntities.slice(0,5).map(e => ({ id:e.id, type:e.entityType, title:e.title })),
    },
    currentContext: {
      riskToleranceBreaches:   risk.getBreachingTolerance().length,
      complianceBreaches:      currentCompliance,
      controlEffectiveness:    controlHealth,
    },
    strategicContradictions: contradictions,
    governanceQuestions,
    recommendations,
    confidence: contradictions.length === 0 ? 85 : 60,
  });
});

// ══════════════════════════════════════════════════════════════
// 4. RISK HEATMAP — Live enterprise risk landscape
// ══════════════════════════════════════════════════════════════
executiveRouter.get("/risk-heatmap", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const risk  = getRiskRuntime(tid);
  const ccm   = getCCMRuntime(tid);

  const all      = risk.getAll();
  const byCategory = {} as Record<string, {count:number;maxScore:number;breaching:number}>;
  for (const r of all) {
    if (!byCategory[r.category]) byCategory[r.category] = {count:0, maxScore:0, breaching:0};
    byCategory[r.category].count++;
    byCategory[r.category].maxScore = Math.max(byCategory[r.category].maxScore, r.residualScore);
    if (r.toleranceBreached) byCategory[r.category].breaching++;
  }

  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    totalRisks:  all.length,
    breachingTolerance: risk.getBreachingTolerance().length,
    byCategory,
    criticalRisks: risk.getAll().filter(r=>r.residualScore>=20).map(r=>({ id:r.id, code:r.code, title:r.title, score:r.residualScore, category:r.category, breached:r.toleranceBreached })),
    controlOverallHealth: ccm.getOverallScore(),
    overrideSignals: ccm.getSignals("critical").map(s=>({ type:s.signalType, description:s.description, detectedAt:s.detectedAt })),
  });
});

// ══════════════════════════════════════════════════════════════
// 5. COMPLIANCE RADAR — Live compliance exposure
// ══════════════════════════════════════════════════════════════
executiveRouter.get("/compliance-radar", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const compl = getComplianceObligationRuntime(tid);
  const ccm   = getCCMRuntime(tid);
  const intel = getExternalIntelligence(tid);
  intel.loadBaseline();

  const drift       = compl.detectDrift();
  const obligations = compl.getAll();
  const frameworks  = [...new Set(obligations.map(o=>o.framework))];
  const frameworkHealth = frameworks.map(fw => ({
    framework: fw,
    total:     obligations.filter(o=>o.framework===fw).length,
    breached:  obligations.filter(o=>o.framework===fw&&o.status==="breached").length,
    health:    Math.max(0, 100 - obligations.filter(o=>o.framework===fw&&o.status==="breached").length * 20),
  }));

  res.json({
    tenantId:       tid,
    generatedAt:    new Date().toISOString(),
    overallHealth:  compl.getBreached().length === 0 ? 100 : Math.max(0, 100 - compl.getBreached().length * 15),
    totalObligations: obligations.length,
    breachedCount:  compl.getBreached().length,
    driftSignals:   drift.length,
    frameworkHealth,
    topDriftSignals:drift.slice(0,5),
    externalChanges:intel.getChanges().length,
    criticalRegChanges: intel.getChanges().filter(c=>c.severity==="critical").map(c=>({ framework:c.framework, title:c.title, effectiveDate:c.effectiveDate })),
  });
});

// ══════════════════════════════════════════════════════════════
// 6. BOARD READINESS — Board-grade intelligence
// ══════════════════════════════════════════════════════════════
executiveRouter.get("/board-readiness", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid    = req.tenantCtx!.tenantId;
  const board  = getBoardRuntime(tid);
  const predict= getPredictiveRuntime(tid);
  const cockpit= predict.buildExecutiveCockpit();
  const intel  = getExternalIntelligence(tid);
  intel.loadBaseline();

  const sessions    = board.getSessions();
  const resolutions = board.getResolutions();
  const assurance   = getAssuranceRuntime(tid).getLatestOpinion();

  res.json({
    tenantId:        tid,
    generatedAt:     new Date().toISOString(),
    boardReadiness:  cockpit.boardReadiness,
    sessions: {
      total:         sessions.length,
      inSession:     sessions.filter(s=>s.status==="in_session").length,
      quorumPending: sessions.filter(s=>s.status==="quorum_pending").length,
    },
    resolutions: {
      total:         resolutions.length,
      passed:        board.getPassedResolutions().length,
      underVote:     resolutions.filter(r=>r.status==="under_vote").length,
      failed:        resolutions.filter(r=>r.status==="failed").length,
    },
    assuranceOpinion: assurance ? {
      rating:       assurance.overallRating,
      score:        assurance.overallScore,
      issuedAt:     assurance.issuedAt,
    } : null,
    prediction: predict.predict("30d"),
    boardWarnings: cockpit.boardWarnings,
    immediateActions: cockpit.immediateActions.slice(0,3),
  });
});

// ══════════════════════════════════════════════════════════════
// 7. AI GOVERNANCE STATUS
// ══════════════════════════════════════════════════════════════
executiveRouter.get("/ai-governance", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const ai  = getAISafetyRuntime(tid);

  const traces       = ai.getTraces();
  const hallucinations = ai.getHallucinationReports();
  const pending      = ai.getPendingApprovals();
  const blocked      = ai.getBlockedActions();

  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    posture: {
      pendingHumanApprovals: pending.length,
      blockedActions:        blocked.length,
      hallucinationsDetected:hallucinations.filter(h=>h.detected).length,
      totalTraces:           traces.length,
    },
    recentBlocked: blocked.slice(-5).map(b => ({ traceId:b.id, agentId:b.agentId, action:b.action, reason:b.blockedReason })),
    recentHallucinations: hallucinations.filter(h=>h.detected).slice(-5).map(h => ({ agentId:h.agentId, confidence:h.confidence, action:h.action })),
    pendingApprovals: pending.map(p => ({ requestId:p.id, agentId:p.agentId, action:p.action, riskLevel:p.riskLevel })),
    governanceScore: blocked.length === 0 && hallucinations.filter(h=>h.detected).length === 0 ? 100 : Math.max(0, 100 - blocked.length*10 - hallucinations.filter(h=>h.detected).length*5),
  });
});

// ══════════════════════════════════════════════════════════════
// 8. EXTERNAL INTELLIGENCE
// ══════════════════════════════════════════════════════════════
executiveRouter.get("/external-intelligence", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const intel = getExternalIntelligence(tid);
  intel.loadBaseline();  // idempotent
  const summary   = intel.generateSummary();
  const changes   = intel.getChanges();
  const signals   = intel.getSignals();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    summary,
    criticalChanges:   changes.filter(c=>c.severity==="critical").map(c=>({ id:c.id, framework:c.framework, title:c.title, effectiveDate:c.effectiveDate, affectedAreas:c.affectedAreas })),
    earlyWarnings:     signals.filter(s=>s.earlyWarning).map(s=>({ id:s.id, type:s.signalType, title:s.title, severity:s.severity, probability:s.probability, timeHorizon:s.timeHorizon })),
    allFrameworks:     [...new Set(changes.map(c=>c.framework))],
  });
});

// ══════════════════════════════════════════════════════════════
// 9. INTEGRITY CERTIFICATE — Production certification
// ══════════════════════════════════════════════════════════════
executiveRouter.post("/integrity-certificate", checkPermission("entity:create"), async (req:Request, res:Response): Promise<void> => {
  const tid  = req.tenantCtx!.tenantId;
  const cert = await getIntegrityCertEngine(tid).runFullCertification();
  res.json(cert);
});

executiveRouter.get("/integrity-certificate", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const store = getEventStore(tid);
  const chain = store.validateChain();
  res.json({
    tenantId:     tid,
    checkedAt:    new Date().toISOString(),
    chainIntegrity: chain,
    eventCount:   store.getStats().totalEvents,
    ready:        chain.valid,
  });
});

// ══════════════════════════════════════════════════════════════
// 10. GOVERNANCE TIMELINE — Temporal replay and lineage
// ══════════════════════════════════════════════════════════════
const TimelineQuerySchema = z.object({
  fromDate:  z.string().optional(),
  toDate:    z.string().optional(),
  topic:     z.string().optional(),
  limit:     z.coerce.number().int().min(1).max(500).optional().default(50),
});

executiveRouter.get("/governance-timeline", checkPermission("dashboard:read"), validateQuery(TimelineQuerySchema), (req:Request, res:Response): void => {
  const tid    = req.tenantCtx!.tenantId;
  const q      = (req as any).validatedQuery as z.infer<typeof TimelineQuerySchema>;
  const store  = getEventStore(tid);
  const memory = getSovereignMemory(tid);

  const events  = store.replay({ topic:q.topic, fromTimestamp:q.fromDate, toTimestamp:q.toDate, limit:q.limit });
  const memories = memory.recall({ fromDate:q.fromDate, toDate:q.toDate, limit:q.limit });

  // Build unified timeline
  const timeline = [
    ...events.map(e => ({ timestamp:e.timestamp, source:"event_store", type:e.topic, actor:e.actorId, summary:`${e.topic} by ${e.actorId}`, correlationId:e.correlationId, hash:e.hash })),
    ...memories.map(m => ({ timestamp:m.createdAt, source:"sovereign_memory", type:m.type, actor:m.createdBy, summary:m.content.slice(0,100), subject:m.subject })),
  ].sort((a,b) => b.timestamp.localeCompare(a.timestamp)).slice(0, q.limit);

  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    period:      { from:q.fromDate ?? "all", to:q.toDate ?? "now" },
    eventCount:  events.length,
    memoryCount: memories.length,
    timeline,
    chainValid:  store.validateChain().valid,
  });
});

// ══════════════════════════════════════════════════════════════
// 11. SYSTEM HEALTH — Self-healing + DR status
// ══════════════════════════════════════════════════════════════
executiveRouter.get("/system-health", checkPermission("dashboard:read"), async (req:Request, res:Response): Promise<void> => {
  const tid = req.tenantCtx!.tenantId;
  const healing = getSelfHealingRuntime(tid);
  const dr      = getDRRuntime(tid);

  // Run quick health probes
  const [eventProbe, memoryProbe] = await Promise.all([
    healing.probe({ componentId:"event_store", componentType:"event_store", checkFn:async()=>{ const s=getEventStore(tid).getStats(); return {healthy:s.chainValid, latencyMs:1, details:{events:s.totalEvents}}; } }),
    healing.probe({ componentId:"sovereign_memory", componentType:"memory", checkFn:async()=>{ const s=getSovereignMemory(tid).getStats(); return {healthy:true, latencyMs:1, details:{memories:s.total}}; } }),
  ]);

  const report = healing.generateHealthReport();
  res.json({
    tenantId:     tid,
    checkedAt:    new Date().toISOString(),
    systemHealth: report.overallHealth,
    components: {
      eventStore:     eventProbe.status,
      sovereignMemory:memoryProbe.status,
    },
    activeHealings:    report.activeHealings.length,
    degradedComponents:report.degradedComponents,
    drPlans:           dr.getPlans().length,
    lastDRTest:        dr.getTestResults().at(-1)?.testedAt ?? "never",
    resilienceScore:   dr.getResilienceScore(),
  });
});


// ══════════════════════════════════════════════════════════════
// PHASE 9 ADDITIONS — Audit, Financial, Maturity
// ══════════════════════════════════════════════════════════════

// Lazy imports to avoid circular dependency issues
const getInternalAuditRuntimeLazy = () => require("../../../audit-runtime/internal/internal.audit.runtime").getInternalAuditRuntime;
const getFinancialAuditRuntimeLazy = () => require("../../../audit-runtime/financial/financial.audit.runtime").getFinancialAuditRuntime;
const getMaturityEngineLazy = () => require("../../../governance-maturity/governance.maturity.engine").getMaturityEngine;

// GET /api/executive/audit-readiness
executiveRouter.get("/audit-readiness", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const audit = getInternalAuditRuntimeLazy()(tid);
  const fin   = getFinancialAuditRuntimeLazy()(tid);
  const signals = audit.runContinuousAudit();
  const readiness = audit.scoreReadiness();

  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    internalAudit: {
      readinessScore:   readiness.overall,
      openFindings:     readiness.openFindings,
      criticalOpen:     readiness.criticalOpen,
      overdueFindings:  readiness.overdueFindings,
      universeItems:    audit.getUniverse().length,
      engagements:      audit.getEngagements().length,
      continuousSignals:signals.length,
    },
    financialAudit: {
      materialityAssessments: fin.getMateriality().length,
      controlTests:           fin.getControlTests().length,
      materialWeaknesses:     fin.getMaterialWeaknesses().length,
      evidencePackages:       fin.getEvidencePackages().length,
      externalWorkspaces:     fin.getExternalWorkspaces().length,
    },
    continuousSignals: signals.slice(0,5),
    recommendations:   readiness.recommendations,
  });
});

// GET /api/executive/governance-maturity
executiveRouter.get("/governance-maturity", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid     = req.tenantCtx!.tenantId;
  const maturity= getMaturityEngineLazy()(tid).score();
  res.json(maturity);
});

// GET /api/executive/financial-assurance
executiveRouter.get("/financial-assurance", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const fin = getFinancialAuditRuntimeLazy()(tid);
  const tests = fin.getControlTests();
  const effective = tests.filter((t:any)=>t.testResult==="effective").length;
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    materialWeaknesses:  fin.getMaterialWeaknesses().length,
    significantDeficiencies: tests.filter((t:any)=>t.deficiencyType==="significant_deficiency").length,
    effectiveControls:   effective,
    totalControlTests:   tests.length,
    evidencePackages:    fin.getEvidencePackages().length,
    latestMateriality:   fin.getMateriality().at(-1) ?? null,
    managementAssertions:fin.getAssertions().length,
    externalOpinion:     fin.getExternalWorkspaces().find((w:any)=>w.opinion)?.opinion ?? "pending",
  });
});

// GET /api/executive/regulatory-intelligence
executiveRouter.get("/regulatory-intelligence", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const intel = getExternalIntelligence(tid);
  intel.loadBaseline();
  const changes = intel.getChanges();
  const byJurisdiction = changes.reduce((acc:any, c) => { acc[c.jurisdiction]=(acc[c.jurisdiction]??0)+1; return acc; }, {});
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    totalChanges:    changes.length,
    critical:        changes.filter(c=>c.severity==="critical").length,
    byJurisdiction,
    byFramework:     [...new Set(changes.map(c=>c.framework))].map(fw=>({ framework:fw, count:changes.filter(c=>c.framework===fw).length, critical:changes.filter(c=>c.framework===fw&&c.severity==="critical").length })),
    upcomingDeadlines: changes.filter(c=>c.effectiveDate>new Date().toISOString()).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)).slice(0,5).map(c=>({ framework:c.framework, title:c.title, deadline:c.effectiveDate, severity:c.severity })),
    geoSignals:      getExternalIntelligence(tid).getSignals().length,
    earlyWarnings:   getExternalIntelligence(tid).getSignals().filter(s=>s.earlyWarning).length,
  });
});

// POST /api/executive/maturity-improvement
const MaturityActionSchema = z.object({
  dimension: z.enum(["Governance","AI Governance","Internal Audit","Compliance","Operational Resilience","Financial Governance"]),
  action:    z.string().min(10),
  actorId:   z.string().min(1),
});

executiveRouter.post("/maturity-improvement", checkPermission("entity:create"), validate(MaturityActionSchema), (req:Request, res:Response): void => {
  const tid     = req.tenantCtx!.tenantId;
  const maturity= getMaturityEngineLazy()(tid).score();
  const dim     = maturity.dimensions.find((d:any)=>d.dimension===req.body.dimension);
  if (!dim) { res.status(404).json({error:"Dimension not found"}); return; }

  res.json({
    tenantId:    tid,
    dimension:   req.body.dimension,
    currentLevel:dim.level,
    currentScore:dim.score,
    action:      req.body.action,
    nextLevel:   Math.min(5, dim.level+1),
    estimatedImpact:`Improvement could raise ${req.body.dimension} from Level ${dim.level} to Level ${Math.min(5,dim.level+1)}`,
    prerequisites:dim.nextActions,
    recordedAt:  new Date().toISOString(),
  });
});



// ══════════════════════════════════════════════════════════════
// PHASE 10 — Sovereign Knowledge Graph + Monte Carlo + API Aliases
// ══════════════════════════════════════════════════════════════
const { getSovereignKG } = require("../../../sovereign-knowledge-graph/sovereign.knowledge.graph");

// ── API Aliases (doc section 11 exact names) ─────────────────

// GET /api/executive/ai-oversight (alias for /ai-governance)
executiveRouter.get("/ai-oversight", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const ai  = getAISafetyRuntime(tid);
  const traces = ai.getTraces();
  const hallucinations = ai.getHallucinationReports();
  const pending = ai.getPendingApprovals();
  const blocked = ai.getBlockedActions();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    posture: {
      pendingHumanApprovals: pending.length,
      blockedActions:        blocked.length,
      hallucinationsDetected:hallucinations.filter((h:any)=>h.detected).length,
      totalTraces:           traces.length,
    },
    aiGovernanceScore: blocked.length===0 && hallucinations.filter((h:any)=>h.detected).length===0 ? 100 : Math.max(0,100-blocked.length*10-hallucinations.filter((h:any)=>h.detected).length*5),
    recentBlocked: blocked.slice(-5).map((b:any)=>({traceId:b.id,agentId:b.agentId,action:b.action,reason:b.blockedReason})),
    pendingApprovals: pending.map((p:any)=>({requestId:p.id,agentId:p.agentId,action:p.action,riskLevel:p.riskLevel})),
    hallucinationAlerts: hallucinations.filter((h:any)=>h.detected).slice(-5),
    maturity: getMaturityEngineLazy()(tid).score().dimensions.find((d:any)=>d.dimension==="AI Governance"),
  });
});

// GET /api/executive/internal-audit (alias for /audit-readiness with richer payload)
executiveRouter.get("/internal-audit", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const audit = getInternalAuditRuntimeLazy()(tid);
  const fin   = getFinancialAuditRuntimeLazy()(tid);
  const signals = audit.runContinuousAudit();
  const readiness = audit.scoreReadiness();
  const plan  = audit.generateRiskBasedPlan(new Date().getFullYear());

  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    readinessScore: readiness.overall,
    dimensions:  readiness.dimensions,
    internalAudit: {
      universeItems:   audit.getUniverse().length,
      engagements:     audit.getEngagements().length,
      openFindings:    audit.getOpenFindings().length,
      criticalFindings:audit.getAllFindings("critical").length,
      continuousSignals:signals.length,
      riskBasedPlan:   plan.slice(0,5),
    },
    financialAudit: {
      materialWeaknesses:     fin.getMaterialWeaknesses().length,
      evidencePackages:       fin.getEvidencePackages().length,
      managementAssertions:   fin.getAssertions().length,
      externalWorkspaces:     fin.getExternalWorkspaces().length,
    },
    recommendations: readiness.recommendations,
    iiaMandatoryStandards: ["IIA 2010 Planning","IIA 2200 Engagement Planning","IIA 2300 Fieldwork","IIA 2400 Communicating Results","IIA 2500 Monitoring Progress"],
  });
});

// POST /api/executive/integrity-certification (exact name from doc)
executiveRouter.post("/integrity-certification", checkPermission("entity:create"), async (req:Request, res:Response): Promise<void> => {
  const tid  = req.tenantCtx!.tenantId;
  const cert = await getIntegrityCertEngine(tid).runFullCertification();
  res.json(cert);
});

// ── Sovereign Knowledge Graph API ─────────────────────────────

// GET /api/executive/sovereign-knowledge-graph
executiveRouter.get("/sovereign-knowledge-graph", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const kg  = getSovereignKG(tid);
  const syncResult = kg.sync();
  const stats = kg.getStats();
  const full  = kg.query();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    sync:        syncResult,
    stats,
    atRisk:      full.nodes.filter((n:any)=>n.status==="at_risk").slice(0,10),
    orphanNodes: full.orphanNodes,
    topDomains:  Object.entries(stats.byDomain).sort((a:any,b:any)=>b[1]-a[1]).slice(0,5),
    edges:       full.edgeCount,
  });
});

// POST /api/executive/sovereign-knowledge-graph/blast-radius
executiveRouter.post("/sovereign-knowledge-graph/blast-radius", checkPermission("entity:read"), validate(z.object({nodeId:z.string().min(1),maxDepth:z.coerce.number().int().min(1).max(6).optional().default(3)})), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const kg  = getSovereignKG(tid);
  kg.sync();
  const result = kg.blastRadius(req.body.nodeId, req.body.maxDepth);
  res.json({ tenantId:tid, ...result });
});

// ── Monte Carlo Governance Simulation ─────────────────────────

const MonteCarloSchema = z.object({
  iterations:     z.coerce.number().int().min(10).max(500).optional().default(100),
  horizon:        z.enum(["30d","90d","12m"]).optional().default("90d"),
  seed:           z.coerce.number().int().min(1).max(2147483647).optional(),
  simulateEvents: z.array(z.enum(["risk_breach","control_failure","compliance_incident","board_delay","cyber_attack","regulatory_change","key_person_loss"])).optional().default(["risk_breach","control_failure","compliance_incident"]),
});

executiveRouter.post("/monte-carlo-simulation", checkPermission("entity:read"), validate(MonteCarloSchema), (req:Request, res:Response): void => {
  const tid  = req.tenantCtx!.tenantId;
  const body = req.body as z.infer<typeof MonteCarloSchema>;

  const risk   = getRiskRuntime(tid);
  const compl  = getComplianceObligationRuntime(tid);
  const ccm    = getCCMRuntime(tid);
  const simulation = runGovernanceMonteCarlo({
    iterations:body.iterations, horizon:body.horizon, simulateEvents:body.simulateEvents, seed:body.seed,
    baseline:{
      riskScore:Math.min(100,risk.getBreachingTolerance().length*10),
      controlHealth:ccm.getOverallScore(),
      complianceScore:Math.max(0,100-compl.getBreached().length*15),
    },
  });
  res.json({tenantId:tid,simulatedAt:new Date().toISOString(),...simulation});
});


// ══════════════════════════════════════════════════════════════
// PHASE 10/11/14 — Legal Governance + AI Registry + Sector Packs
// ══════════════════════════════════════════════════════════════
const { getLegalRuntime }    = require("../../../legal-governance/legal.governance.runtime");
const { getAIModelRegistry } = require("../../../ai-governance-runtime/registry/ai.model.registry");
const { sectorPackEngine }   = require("../../../sector-packs/core/sector.packs.engine");

// ── Phase 10: Legal Governance ────────────────────────────────

// GET /api/executive/legal-governance
executiveRouter.get("/legal-governance", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid  = req.tenantCtx!.tenantId;
  const legal = getLegalRuntime(tid);
  legal.loadLegalBaseline("system");
  const score = legal.scoreLegalRisk();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    legalRiskScore:  score.overallScore,
    obligations:     score.openObligations,
    contracts:       { total:legal.getContracts().length, highRisk:score.highRiskContracts, expiring:score.expiringContracts },
    contradictions:  score.contradictions.length,
    topContradictions:score.contradictions.slice(0,3),
    recommendations: score.recommendations,
    frameworks:      [...new Set(legal.getObligations().map((o:any)=>o.framework))],
  });
});

// POST /api/executive/legal-interpretation
executiveRouter.post("/legal-interpretation", checkPermission("entity:read"), validate(z.object({ question:z.string().min(10), framework:z.string().min(1), articleRef:z.string().min(1) })), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const legal = getLegalRuntime(tid);
  const result = legal.interpretRegulation({ question:req.body.question, framework:req.body.framework as any, articleRef:req.body.articleRef });
  res.json(result);
});

// ── Phase 11: AI Model Registry ───────────────────────────────

// GET /api/executive/ai-model-registry
executiveRouter.get("/ai-model-registry", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const reg = getAIModelRegistry(tid);
  const rai  = reg.scoreResponsibleAI();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    totalModels:     reg.getModels().length,
    highRiskModels:  reg.getModels("high_risk").length,
    driftAlerts:     reg.getDriftEvents().filter((d:any)=>d.severity==="critical"||d.severity==="high").length,
    biasFailures:    reg.getBiasAssessments().filter((b:any)=>b.overallResult==="fail").length,
    responsibleAIScore: rai.overallScore,
    dimensions:      rai.dimensions,
    recommendations: rai.recommendations,
    modelsByStage:   reg.getModels().reduce((acc:any,m:any)=>{ acc[m.stage]=(acc[m.stage]??0)+1; return acc; }, {}),
  });
});

// POST /api/executive/ai-model-registry/drift-alert
executiveRouter.post("/ai-model-registry/drift-alert", checkPermission("entity:create"), validate(z.object({ modelId:z.string().min(1), driftType:z.enum(["data_drift","concept_drift","performance_drift","bias_drift","distribution_shift"]), metric:z.string().min(1), baseline:z.number(), current:z.number(), threshold:z.number() })), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const reg = getAIModelRegistry(tid);
  const evt = reg.recordDrift(req.body.modelId, req.body);
  res.status(201).json(evt);
});

// ── Phase 14: Sector Packs ────────────────────────────────────

// GET /api/executive/sector-pack
executiveRouter.get("/sector-pack", checkPermission("dashboard:read"), validateQuery(z.object({ sector:z.string().optional() })), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const q   = (req as any).validatedQuery;
  if (q.sector) {
    const pack = sectorPackEngine.getPack(q.sector as any);
    if (!pack) { res.status(404).json({error:"Sector pack not found"}); return; }
    res.json({ tenantId:tid, ...pack });
  } else {
    res.json({
      tenantId:    tid,
      availableSectors: sectorPackEngine.getSectors(),
      packs:           sectorPackEngine.getAllPacks().map((p:any)=>({ sector:p.sector, name:p.name, frameworks:p.primaryFrameworks, controlCount:p.controls.length, kriCount:p.kris.length, riskCount:p.risks.length })),
    });
  }
});



// ══════════════════════════════════════════════════════════════
// PHASE 12/15/17/19 — Cyber + Autonomous + Digital Twin + DevSecOps
// ══════════════════════════════════════════════════════════════
const { getCyberGovernanceRuntime } = require("../../../cyber-governance/cyber.governance.runtime");
const { getAutonomousGovernance }   = require("../../../autonomous-governance/autonomous.governance.runtime");
const { getEnterpriseTwin }         = require("../../../digital-twin/enterprise.digital.twin");
const { getDevSecOpsRuntime }       = require("../../../devsecops-governance/devsecops.governance.runtime");

// GET /api/executive/cyber-governance
executiveRouter.get("/cyber-governance", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid   = req.tenantCtx!.tenantId;
  const cyber = getCyberGovernanceRuntime(tid);
  const score = cyber.scoreGovernance();
  const ransomware = cyber.assessRansomwareReadiness();
  const anomalies  = cyber.detectAccessAnomalies();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    cyberScore:  score.overallScore,
    dimensions: {
      patchCompliance:    score.patchComplianceRate,
      accessRisk:         score.accessRiskScore,
      dataProtection:     score.dataProtectionScore,
      privilegedAccess:   score.privilegedAccessRisk,
    },
    criticalVulnerabilities: score.criticalVulnerabilities,
    expiredAccess:           score.expiredAccess,
    overduePatches:          score.overduePatches,
    ransomwareReadiness:     ransomware.overallScore,
    accessAnomalies:         anomalies.slice(0,5),
    recommendations:         score.recommendations,
    assetCount:              cyber.getAssets().length,
    pdplDataAssets:          cyber.getDataLineage(true).length,
  });
});

// GET /api/executive/autonomous-governance
executiveRouter.get("/autonomous-governance", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const ag  = getAutonomousGovernance(tid);
  const cycle = ag.runGovernanceCycle();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    cycleResult: {
      driftsDetected:   cycle.drifts.length,
      actionsProposed:  cycle.actions.length,
      escalations:      cycle.escalations.length,
      fatigueScore:     cycle.fatigueReport.fatigueScore,
      fatigueRisk:      cycle.fatigueReport.riskLevel,
    },
    drifts:      cycle.drifts.slice(0,5),
    actions:     cycle.actions.slice(0,5),
    escalations: cycle.escalations.slice(0,3),
    fatigue:     cycle.fatigueReport,
  });
});

// POST /api/executive/digital-twin/simulate
executiveRouter.post("/digital-twin/simulate", checkPermission("entity:read"), validate(z.object({ scenario:z.enum(["board_succession","ceo_departure","regulatory_investigation","cyber_attack","data_breach","market_crash","key_vendor_failure","regulator_intervention","merger_acquisition","ai_system_failure","pandemic_disruption","financial_restatement"]) })), (req:Request, res:Response): void => {
  const tid    = req.tenantCtx!.tenantId;
  const twin   = getEnterpriseTwin(tid);
  const result = twin.simulate(req.body.scenario);
  res.json(result);
});

// GET /api/executive/digital-twin
executiveRouter.get("/digital-twin", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid  = req.tenantCtx!.tenantId;
  const twin = getEnterpriseTwin(tid);
  const state = twin.captureState();
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    currentState: state,
    availableScenarios: twin.getScenarios(),
    previousSimulations: twin.getSimulations().length,
    lastSimulation: twin.getSimulations().at(-1)?.scenario ?? null,
  });
});

// POST /api/executive/digital-twin/what-if
executiveRouter.post("/digital-twin/what-if", checkPermission("entity:read"), validate(z.object({ question:z.string().min(10), actions:z.record(z.number()).optional().default({}) })), (req:Request, res:Response): void => {
  const tid  = req.tenantCtx!.tenantId;
  const twin = getEnterpriseTwin(tid);
  const result = twin.whatIf(req.body.question, req.body.actions);
  res.json(result);
});

// GET /api/executive/devsecops
executiveRouter.get("/devsecops", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const ds  = getDevSecOpsRuntime(tid);
  res.json({
    tenantId:    tid,
    generatedAt: new Date().toISOString(),
    riskScore:   ds.getRiskScore(),
    deployments: { total:ds.getDeployments().length, blocked:ds.getBlockedDeployments().length, production:ds.getDeployments("production").length },
    artifacts:   { total:ds.getArtifacts().length, critVulns:ds.getArtifacts().filter((a:any)=>a.critVulns>0).length },
    infraDrifts: { total:ds.getDrifts().length, critical:ds.getDrifts().filter((d:any)=>d.severity==="critical").length },
    blockedDeployments: ds.getBlockedDeployments().slice(0,5).map((d:any)=>({service:d.serviceName,version:d.version,env:d.environment,reason:d.blockedReason})),
  });
});

// GET /api/executive/data-maturity — automated-vs-manual provenance sub-metric
executiveRouter.get("/data-maturity", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const engine = getDataMaturityEngine();
  // NOTE (بند48): demo seeding removed — production logic must never fabricate data.
  // An empty store returns an empty, honest result.
  res.json(engine.compute(tid));
});

// POST /api/executive/decision-confidence/explain — XAI chain-of-reasoning
executiveRouter.post("/decision-confidence/explain", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const engine = getConfidenceExplainabilityEngine();
  const maturity = getDataMaturityEngine().compute(tid);
  // Build factor inputs — use request body if provided, else representative pilot values
  const inputs = (req.body?.factors && Array.isArray(req.body.factors) && req.body.factors.length > 0)
    ? req.body.factors
    : [
        { factor:"evidence_completeness", value: 67, provenance:"smart_upload" as const },
        { factor:"control_effectiveness", value: 82, provenance:"automated"    as const },
        { factor:"data_freshness",        value: Math.round(maturity.freshnessScore) || 70, provenance:"automated" as const },
        { factor:"automated_sourcing",    value: maturity.automatedRatio || 55, provenance:"automated" as const },
        { factor:"framework_coverage",    value: 88, provenance:"automated"    as const },
        { factor:"audit_trail_integrity", value: 99, provenance:"automated"    as const },
      ];
  res.json(engine.explain(tid, inputs));
});

// GET /api/executive/upload-templates — list framework CSV templates
executiveRouter.get("/upload-templates", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  res.json({ templates: getSmartUploadEngine().listTemplates() });
});

// GET /api/executive/upload-templates/:framework — download a CSV template
executiveRouter.get("/upload-templates/:framework", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const fw = req.params.framework as FrameworkId;
  const tpl = getSmartUploadEngine().getTemplate(fw);
  if (!tpl) { res.status(404).json({ error:"Unknown framework" }); return; }
  res.json({ framework:fw, template:tpl, csv:getSmartUploadEngine().generateCsvTemplate(fw) });
});

// POST /api/executive/smart-upload — upload CSV data for a framework
executiveRouter.post("/smart-upload", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const { framework, csv } = req.body as { framework:FrameworkId; csv:string };
  if (!framework || !csv) { res.status(400).json({ error:"framework and csv are required" }); return; }
  res.json(getSmartUploadEngine().upload(tid, framework, csv));
});

// POST /api/executive/decision-confidence/override — record human override (PDPL right)
executiveRouter.post("/decision-confidence/override", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const { decisionType, entityId, originalValue, overrideValue, justification } = req.body;
  const result = getAuditOverrideEngine().recordOverride({
    tenantId: tid, actorId: req.user!.userId, actorRole: req.user!.role,
    decisionType, entityId, originalValue, overrideValue, justification,
  });
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ recorded:true, record: result.record });
});

// GET /api/executive/decision-confidence/overrides — override history + chain verification
executiveRouter.get("/decision-confidence/overrides", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const engine = getAuditOverrideEngine();
  res.json({ overrides: engine.getOverrides(tid), verification: engine.verifyChain(tid) });
});

// POST /api/executive/board-report — generate bilingual board report (HTML print-to-PDF)
executiveRouter.post("/board-report", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tid = req.tenantCtx!.tenantId;
  const b = req.body ?? {};
  const html = getBoardReportGenerator().generate({
    tenantId: tid,
    organizationName: b.organizationName ?? "Pilot Organization",
    locale: b.locale === "en" ? "en" : "ar",
    period: b.period ?? "Q2 2026",
    governanceScore: b.governanceScore ?? 85,
    complianceScore: b.complianceScore ?? 82,
    riskExposure: b.riskExposure ?? 35,
    openRisks: b.openRisks ?? 18,
    confidenceIndex: b.confidenceIndex ?? 84,
    dataMaturity: b.dataMaturity,
    confidenceNarrative: b.confidenceNarrative,
    topActions: b.topActions ?? ["مراجعة ضوابط NCA ECC الحرجة", "إكمال تدقيق تصنيف بيانات PDPL"],
  });
  res.json({ format:"html", printable:true, html });
});

// GET /api/executive/legal-update/queue — current legislative review queue
executiveRouter.get("/legal-update/queue", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const queue = getReviewQueue();
  // NOTE (بند48/55): demo regulatory item removed — injecting a fabricated
  // legislative change into a legal review queue is a RELEASE BLOCKER.
  res.json({ queue: queue.list(), pendingCount: queue.list("PENDING_REVIEW").length });
});

// POST /api/executive/legal-update/review — transition a review task (M/38 gated)
executiveRouter.post("/legal-update/review", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const { taskId, toState, isLicensedLawyer, notes } = req.body ?? {};
  if (!taskId || !toState) { res.status(400).json({ error:"taskId and toState are required" }); return; }
  const queue = getReviewQueue();
  // Mirror transition into the immutable audit-override chain
  queue.setAuditSink((e) => {
    _aoe().recordOverride({
      tenantId: req.tenantCtx!.tenantId, actorId: req.user!.userId, actorRole: req.user!.role,
      decisionType: "legal_update_review", entityId: String(e.taskId),
      originalValue: String(e.from ?? ""), overrideValue: String(e.to ?? e.state ?? ""),
      justification: `Legal review transition: ${e.eventType} -> ${e.state}. ${notes ?? "automated state change"}`,
    });
  });
  const r = queue.transition(taskId, toState, req.user!.userId, { isLicensedLawyer: !!isLicensedLawyer, notes });
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  res.json({ ok:true, task: queue.get(taskId) });
});

// GET /api/executive/third-sector/frameworks — registered entity frameworks + status
executiveRouter.get("/third-sector/frameworks", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const e = getThirdSectorEngine();
  res.json({ frameworks: e.listFrameworks(), sharedCorePractices: e.getSharedCorePractices().length });
});

// GET /api/executive/third-sector/framework/:entityType — full framework content
executiveRouter.get("/third-sector/framework/:entityType", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const t = req.params.entityType as EntityType;
  const e = getThirdSectorEngine();
  const fw = e.getFramework(t);
  if (!fw) { res.status(404).json({ error:"Unknown entity type" }); return; }
  res.json({
    framework: fw,
    principles: e.getPrinciples(t),
    outputs:    e.getOutputs(t),
    practices:  e.getPractices(t),
  });
});

// POST /api/executive/third-sector/assess — run a governance assessment
executiveRouter.post("/third-sector/assess", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const { entityId, entityType, responses } = req.body as
    { entityId?:string; entityType?:EntityType; responses?:PracticeResponse[] };
  if (!entityType) { res.status(400).json({ error:"entityType is required" }); return; }
  const e = getThirdSectorEngine();
  res.json(e.assess(entityId ?? "entity-demo", entityType, responses ?? []));
});
