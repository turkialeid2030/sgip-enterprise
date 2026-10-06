/**
 * SCEOS API Routes — all 12 SCEOS endpoints
 * /api/sceos/* — Sovereign Cognitive Enterprise OS runtime APIs
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate } from "../middleware/validate.middleware";
import { injectTenantContext } from "../../tenant/tenant.context";
import { getEventFabric, buildAuthority, SCEOSEventType } from "../../runtime/event-fabric/unified.event.fabric";
import { getKernel } from "../../runtime/institutional-kernel/institutional.kernel";
import { getEconomicEngine } from "../../runtime/economic-cognition/economic.cognition.engine";
import { getSimulationEngine } from "../../runtime/simulation/simulation.engine";
import { getThermodynamics } from "../../runtime/thermodynamics/organizational.thermodynamics";
import { getTimeIntelligence } from "../../runtime/time-intelligence/strategic.time.intelligence";
import { getAIReadinessEngine } from "../../runtime/ai-readiness/ai.readiness.engine";
import { getAgentConstitutionEngine, AgentRole } from "../../agents/policies/adaptive.agent.constitution";
import { getSovereignMemory } from "../../sovereign-memory/core/sovereign.memory.engine";
import { getGovernanceOntology } from "../../sovereign-memory/ontology/governance.ontology.engine";

export const sceosRouter = Router();
sceosRouter.use(authMiddleware);
sceosRouter.use(injectTenantContext);

// ── 1. Unified Event Fabric ───────────────────────────────────
const EmitEventSchema = z.object({
  eventType:    z.string().min(1),
  actorId:      z.string().min(1),
  actorRole:    z.string().min(1),
  payload:      z.record(z.unknown()).default({}),
  evidenceLinks:z.array(z.string()).default([]),
  causationId:  z.string().optional(),
});

// POST /api/sceos/event
sceosRouter.post("/event", checkPermission("entity:create"), validate(EmitEventSchema), (req:Request, res:Response): void => {
  const fabric = getEventFabric(req.tenantCtx!.tenantId);
  const authority = buildAuthority(req.body.actorId, req.body.actorRole, [req.user!.role]);
  const event = fabric.emit({
    eventType:        req.body.eventType as SCEOSEventType,
    actorId:          req.body.actorId,
    actorRole:        req.body.actorRole,
    authorityContext: authority,
    payload:          req.body.payload,
    evidenceLinks:    req.body.evidenceLinks,
    causationId:      req.body.causationId,
  });
  res.status(201).json(event);
});

// GET /api/sceos/event — list events
sceosRouter.get("/event", checkPermission("entity:read"), (req:Request, res:Response): void => {
  const fabric = getEventFabric(req.tenantCtx!.tenantId);
  const events = fabric.getEvents(req.query.type as SCEOSEventType | undefined);
  res.json({ events, stats: fabric.getStats() });
});

// GET /api/sceos/event/:id/validate — integrity check
sceosRouter.get("/event/:id/validate", checkPermission("entity:read"), (req:Request, res:Response): void => {
  const fabric = getEventFabric(req.tenantCtx!.tenantId);
  const result = fabric.validate(String(req.params.id));
  res.json(result);
});

// ── 2. Institutional State ────────────────────────────────────
// GET /api/sceos/state
sceosRouter.get("/state", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const kernel = getKernel(req.tenantCtx!.tenantId);
  const ctx    = kernel.buildRuntimeContext(req.user!.userId, req.user!.role);
  res.json(ctx);
});

// GET /api/sceos/state/health
sceosRouter.get("/state/health", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const kernel = getKernel(req.tenantCtx!.tenantId);
  const health = kernel.computeHealthState();
  res.json(health);
});

// ── 3. Economic Impact ────────────────────────────────────────
const EconSchema = z.object({
  entityId:   z.string().min(1),
  entityType: z.string().min(1),
  scenario:   z.enum(["control_failure","compliance_breach","evidence_gap","kri_breach","audit_delay","governance_gap"]),
});

// POST /api/sceos/economic-impact
sceosRouter.post("/economic-impact", checkPermission("entity:read"), validate(EconSchema), (req:Request, res:Response): void => {
  const engine = getEconomicEngine(req.tenantCtx!.tenantId);
  const impact = engine.assess(req.body);
  res.json(impact);
});

// GET /api/sceos/economic-impact — cost model
sceosRouter.get("/economic-impact", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const engine = getEconomicEngine(req.tenantCtx!.tenantId);
  res.json({ costModel:engine.buildCostModel(), impacts:engine.getImpacts(), totalExposure:engine.getTotalExposure() });
});

// ── 4. Simulation ─────────────────────────────────────────────
const SimSchema = z.object({
  scenario:   z.enum(["change_authority","approve_policy","control_failure","project_delay","kri_breach","compliance_incident","evidence_weakness","conflict_of_interest","risk_owner_loss","board_pressure"]),
  entityId:   z.string().min(1),
  entityType: z.string().min(1),
  actorId:    z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
});

// POST /api/sceos/simulate
sceosRouter.post("/simulate", checkPermission("entity:read"), validate(SimSchema), (req:Request, res:Response): void => {
  const engine = getSimulationEngine(req.tenantCtx!.tenantId);
  const result = engine.simulate({ ...req.body, simulatedBy:req.user!.userId });
  res.json(result);
});

// GET /api/sceos/simulate — past simulations
sceosRouter.get("/simulate", checkPermission("entity:read"), (req:Request, res:Response): void => {
  const engine = getSimulationEngine(req.tenantCtx!.tenantId);
  res.json({ simulations:engine.getSimulations() });
});

// ── 5. Thermodynamics ─────────────────────────────────────────
// GET /api/sceos/thermodynamics
sceosRouter.get("/thermodynamics", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const engine = getThermodynamics(req.tenantCtx!.tenantId);
  res.json(engine.generateReport());
});

// ── 6. Strategic Forecast ─────────────────────────────────────
// GET /api/sceos/forecast
sceosRouter.get("/forecast", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const period = (req.query.period as any) ?? "30d";
  const intel  = getTimeIntelligence(req.tenantCtx!.tenantId);
  res.json(intel.generateReport(period));
});

// ── 7. AI Readiness ───────────────────────────────────────────
const IntakeSchema = z.object({
  sector:                    z.enum(["banking","insurance","healthcare","government","retail","energy","telecom","manufacturing","education","other"]),
  companySize:               z.enum(["startup","sme","enterprise","large_enterprise","government_entity"]),
  userRole:                  z.string().min(1),
  currentAIUsage:            z.enum(["none","experimental","limited","moderate","extensive"]),
  aiDepartments:             z.array(z.string()).default([]),
  adoptionBarriers:          z.array(z.string()).default([]),
  timeConsumingTasks:        z.array(z.string()).default([]),
  willingToGrantAIAccess:    z.boolean(),
  dataMaturity:              z.coerce.number().int().min(1).max(5),
  governanceMaturity:        z.coerce.number().int().min(1).max(5),
  cyberMaturity:             z.coerce.number().int().min(1).max(5),
  complianceMaturity:        z.coerce.number().int().min(1).max(5),
  seniorLeadershipReadiness: z.coerce.number().int().min(1).max(5),
  budgetLevel:               z.enum(["none","minimal","moderate","significant","strategic"]),
});

// POST /api/sceos/ai-readiness
sceosRouter.post("/ai-readiness", checkPermission("entity:create"), validate(IntakeSchema), (req:Request, res:Response): void => {
  const engine  = getAIReadinessEngine(req.tenantCtx!.tenantId);
  const intake  = engine.submitIntake(req.body as any);
  const score   = engine.scoreIntake(intake.id);
  res.status(201).json({ intake, score });
});

// GET /api/sceos/ai-readiness
sceosRouter.get("/ai-readiness", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const engine = getAIReadinessEngine(req.tenantCtx!.tenantId);
  const score  = engine.getLatestScore();
  res.json({ score: score ?? null, hasIntake: !!score });
});

// ── 8. Stakeholder Intelligence ───────────────────────────────
// GET /api/sceos/stakeholders
sceosRouter.get("/stakeholders", checkPermission("entity:read"), (req:Request, res:Response): void => {
  const ontology     = getGovernanceOntology(req.tenantCtx!.tenantId);
  const executives   = ontology.getNodesByType("executive");
  const stakeholders = ontology.getNodesByType("stakeholder");
  const committees   = ontology.getNodesByType("committee");
  const allActors    = [...executives, ...stakeholders, ...committees];
  const result = allActors.map(a => ({
    ...a,
    accountability:    ontology.traceAccountability(a.id),
    blastRadius:       ontology.computeBlastRadius(a.id).score,
    governanceQuestions: ontology.generateGovernanceQuestions().filter(q => q.entityIds.includes(a.id)),
  }));
  res.json({ stakeholders: result, orphanCount: ontology.getStats().orphanNodes });
});

// GET /api/sceos/stakeholders/authority-graph
sceosRouter.get("/stakeholders/authority-graph", checkPermission("entity:read"), (req:Request, res:Response): void => {
  const ontology = getGovernanceOntology(req.tenantCtx!.tenantId);
  const stats    = ontology.getStats();
  const questions = ontology.generateGovernanceQuestions();
  res.json({ ontologyStats:stats, governanceQuestions:questions, authorityGaps: questions.filter(q=>q.category==="accountability").length });
});

// ── 9. Executive Intelligence ─────────────────────────────────
// GET /api/sceos/executive-intelligence
sceosRouter.get("/executive-intelligence", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tenantId  = req.tenantCtx!.tenantId;
  const kernel    = getKernel(tenantId);
  const health    = kernel.computeHealthState();
  const thermo    = getThermodynamics(tenantId).generateReport();
  const forecast  = getTimeIntelligence(tenantId).generateReport("30d");
  const economic  = getEconomicEngine(tenantId).buildCostModel();
  const memory    = getSovereignMemory(tenantId).getStats();

  res.json({
    tenantId, generatedAt:new Date().toISOString(),
    executiveSnapshot: { overallHealth:health.overallHealthScore, governancePressure:health.governancePressureIndex, organizationalTemperature:thermo.metrics.overallTemperature, memoryDepth:memory.total, trendDirection:forecast.trendDirection },
    financials:        { annualGovernanceCost:economic.annualGovernanceCost, automationOpportunity:economic.automationOpportunity, wastedSpend:economic.wastedGovernanceSpend },
    urgentActions:     [...health.recommendations, ...thermo.immediateActions, ...thermo.boardWarnings].slice(0,5),
    earlyWarnings:     forecast.earlyWarnings,
  });
});

// GET /api/sceos/dashboards — overview of all SCEOS dashboards
sceosRouter.get("/dashboards", checkPermission("dashboard:read"), (req:Request, res:Response): void => {
  const tenantId = req.tenantCtx!.tenantId;
  res.json({
    availableDashboards: [
      { id:"board",         name:"Board Reporting Dashboard",        endpoint:"/api/governance/executive-dashboard" },
      { id:"compliance",    name:"Compliance Dashboard",             endpoint:"/api/frameworks/gaps" },
      { id:"risk",          name:"Enterprise Risk Dashboard",        endpoint:"/api/graph-runtime/governance-signals" },
      { id:"kri",           name:"KPI/KRI Monitoring Panel",         endpoint:"/api/graph-runtime/alerts" },
      { id:"evidence",      name:"Evidence Hub Dashboard",           endpoint:"/api/graph-runtime/retention-scan" },
      { id:"thermodynamics",name:"Organizational Heat Dashboard",    endpoint:"/api/sceos/thermodynamics" },
      { id:"forecast",      name:"Strategic Forecast",               endpoint:"/api/sceos/forecast" },
      { id:"executive",     name:"Executive Cockpit",                endpoint:"/api/sceos/executive-intelligence" },
      { id:"ai-readiness",  name:"AI Governance Dashboard",          endpoint:"/api/sceos/ai-readiness" },
      { id:"simulation",    name:"Simulation Results",               endpoint:"/api/sceos/simulate" },
    ],
    generatedAt:new Date().toISOString(),
  });
});

// ── Agent Governance ──────────────────────────────────────────
const AgentRegisterSchema = z.object({
  agentId:      z.string().min(1),
  role:         z.enum(["risk_analyst","compliance_agent","audit_agent","governance_analyst","executive_briefer","evidence_collector","remediation_tracker"]),
  sector:       z.string().min(1),
  maturityLevel:z.coerce.number().int().min(1).max(5),
  allowedDataAccess:z.array(z.string()).default([]),
});

// POST /api/sceos/agent-governance
sceosRouter.post("/agent-governance", checkPermission("entity:create"), validate(AgentRegisterSchema), (req:Request, res:Response): void => {
  const engine  = getAgentConstitutionEngine(req.tenantCtx!.tenantId);
  const result  = engine.registerAgent({ ...req.body, autonomyLevel:"supervised", confidenceThreshold:80, humanApprovalRequired:[], forbiddenActions:[], constitutionVersion:"1.0" } as any);
  res.status(201).json(result);
});

// GET /api/sceos/agent-governance/:agentId
sceosRouter.get("/agent-governance/:agentId", checkPermission("entity:read"), (req:Request, res:Response): void => {
  const engine = getAgentConstitutionEngine(req.tenantCtx!.tenantId);
  const constitution = engine.getConstitution(String(req.params.agentId));
  if (!constitution) { res.status(404).json({error:"Agent not registered"}); return; }
  const auditTrail = engine.getAuditTrail(String(req.params.agentId));
  res.json({ constitution, auditTrail, auditCount:auditTrail.length });
});
