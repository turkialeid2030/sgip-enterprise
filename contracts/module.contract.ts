/**
 * Typed Inter-Module Contracts
 * Modules communicate through these contracts — never through direct imports
 * of each other's internals. This enables true modularity.
 */
import { BaseGovernanceObject, UGOMType, RiskLevel } from "../types/governance.types";
import { AgentId } from "../types/agent.types";

// ── Registry Contract (what modules can do with UGOM) ─────────────────
export interface IEntityRegistry {
  findById<T extends BaseGovernanceObject>(id: string): T | undefined;
  findByType<T extends BaseGovernanceObject>(type: UGOMType, filter?: Partial<T>): T[];
  create<T extends BaseGovernanceObject>(type: UGOMType, data: Partial<T>, createdBy: string): Promise<T>;
  update<T extends BaseGovernanceObject>(id: string, patch: Partial<T>, updatedBy: string, reason?: string): Promise<T | undefined>;
}

// ── Graph Contract ─────────────────────────────────────────────────────
export interface IGraphEngine {
  upsertNode(params: { id: string; type: UGOMType; label: string; properties: Record<string, unknown>; createdBy: string }): unknown;
  createEdge(params: { fromId: string; fromType: UGOMType; toId: string; toType: UGOMType; relationship: string; createdBy: string }): unknown;
  getTraceabilityChain(startId: string, maxDepth?: number): unknown;
  analyzeImpact(sourceId: string): unknown;
  detectBlindSpots(): unknown;
}

// ── Audit Contract ────────────────────────────────────────────────────
export interface IAuditLogger {
  log(params: { action: string; entityId: string; entityType: UGOMType; performedBy: string; details?: unknown }): unknown;
  getEntriesForEntity(entityId: string): unknown[];
}

// ── Memory Contract ───────────────────────────────────────────────────
export interface IGovernanceMemory {
  store(entry: { type: string; title: string; summary: string; source: string; importance: string; tags: string[]; tenantId: string; relatedEntityIds: string[]; confidenceScore: number }): unknown;
  retrieve(query: { types?: string[]; tags?: string[]; textSearch?: string; tenantId: string; limit?: number }): unknown[];
}

// ── Orchestration Contract ────────────────────────────────────────────
export interface IOrchestrator {
  orchestrate(request: {
    agentId:    AgentId;
    action:     string;
    entityId?:  string;
    entityType?:UGOMType;
    input:      unknown;
    requestedBy:string;
    tenantId:   string;
    confidenceScore?: number;
    evidenceIds?:string[];
  }): Promise<{ status: string; output?: unknown; blockReasons: string[]; orchestrationId: string }>;
}

// ── Quality Gate Contract ─────────────────────────────────────────────
export interface IQualityGate {
  run(input: {
    type: string;
    evidenceIds: string[];
    owner: string | null | undefined;
    auditTrail: string[];
    confidenceScore: number;
    linkedRegulations: string[];
    riskLevel: string;
  }): { status: string; overallScore: number; blockers: Array<{ gate: string; issue: string }> };
}

// ── Event Bus Contract ────────────────────────────────────────────────
export interface IEventBus {
  emit(event: { type: string; source: string; payload: unknown; tenantId: string; severity?: RiskLevel }): void;
  on(type: string, handler: (event: unknown) => void): void;
}

// ── Module Manifest (self-registration) ──────────────────────────────
export interface ModuleManifest {
  moduleId:       string;
  version:        string;
  entityTypes:    UGOMType[];    // entity types this module owns
  dependsOn:      string[];      // module IDs this module depends on
  emitsEvents:    string[];      // event types this module emits
  consumesEvents: string[];      // event types this module handles
  agents:         AgentId[];     // agents assigned to this module
}

// ── Module base class ─────────────────────────────────────────────────
export abstract class GovernanceModule {
  abstract readonly manifest: ModuleManifest;
  abstract initialize(): Promise<void>;
  abstract healthCheck(): Promise<{ healthy: boolean; details: string }>;
}
