/**
 * Graph DB Adapter
 * Bridges SovereignKnowledgeGraph (in-memory engine) ↔ PostgreSQL.
 *
 * On startup: loads all edges from DB into the in-memory engine.
 * On write:   persists every upsertNode / createEdge to DB AND in-memory.
 *
 * Production: replace load/persist with Neo4j driver.
 */
import { query } from "../api/services/db.service";
import { SovereignKnowledgeGraph } from "./graph.engine";
import { EventBus } from "../core/event-bus";
import { AuditLogger } from "../audit/audit.logger";

export class GraphDBAdapter {
  private graph: SovereignKnowledgeGraph;

  constructor(
    private readonly tenantId: string,
    private readonly eventBus: EventBus,
    private readonly audit: AuditLogger,
  ) {
    this.graph = new SovereignKnowledgeGraph(eventBus, audit, tenantId);
  }

  /** Load existing nodes + edges from PostgreSQL into in-memory graph. */
  async hydrate(): Promise<{ nodes: number; edges: number }> {
    try {
      // Load nodes
      const entities = await query<{ id: string; type: string; title: string; status: string; riskLevel: string; owner: string }>(
        `SELECT id, type, title, status, "riskLevel", owner
         FROM "GovernanceEntity"
         WHERE "tenantId" = $1 AND status != 'archived'
         LIMIT 2000`,
        [this.tenantId],
      );
      for (const e of entities) {
        this.graph.upsertNode({
          id: e.id, type: e.type as any, label: e.title,
          properties: { status: e.status, riskLevel: e.riskLevel, owner: e.owner },
          createdBy: "system:hydrate",
        });
      }

      // Load edges
      const edges = await query<{
        id: string; fromId: string; fromType: string;
        toId: string; toType: string; relationship: string; weight: number;
      }>(
        `SELECT id, "fromId", "fromType", "toId", "toType", relationship, weight
         FROM "GraphEdge"
         WHERE "tenantId" = $1
         LIMIT 10000`,
        [this.tenantId],
      );
      for (const e of edges) {
        this.graph.createEdge({
          fromId: e.fromId, fromType: e.fromType as any,
          toId: e.toId, toType: e.toType as any,
          relationship: e.relationship as any,
          weight: e.weight,
          createdBy: "system:hydrate",
        });
      }

      console.log(`[GraphDBAdapter] Hydrated ${entities.length} nodes + ${edges.length} edges for tenant ${this.tenantId}`);
      return { nodes: entities.length, edges: edges.length };
    } catch (err) {
      // DB unavailable — graph starts empty (in-memory mode)
      // P0: no silent memory-only graph in production. A governance graph that
      // quietly loses its edges is a data-integrity failure.
      if (process.env.NODE_ENV === "production" && process.env.GRAPH_MODE !== "memory") {
        throw Object.assign(
          new Error(`SGIP: graph hydration failed — ${(err as Error).message}`),
          { code: "GRAPH_HYDRATION_FAILED" });
      }
      console.warn("[GraphDBAdapter] DB unavailable, graph in memory-only mode (non-production):", (err as Error).message);
      return { nodes: 0, edges: 0 };
    }
  }

  /** Persist a new edge to DB (in addition to in-memory). */
  async persistEdge(params: {
    fromId: string; fromType: string; toId: string; toType: string;
    relationship: string; weight?: number; createdBy: string;
  }): Promise<void> {
    try {
      const { v4: uuidv4 } = await import("uuid");
      await query(
        `INSERT INTO "GraphEdge" (id,"fromId","fromType","toId","toType",relationship,weight,"tenantId","createdBy")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT ("fromId","toId",relationship) DO UPDATE SET weight = EXCLUDED.weight`,
        [
          uuidv4(), params.fromId, params.fromType, params.toId, params.toType,
          params.relationship, params.weight ?? 5, this.tenantId, params.createdBy,
        ],
      );
      // Also update in-memory engine
      this.graph.createEdge({
        fromId: params.fromId, fromType: params.fromType as any,
        toId: params.toId,   toType: params.toType as any,
        relationship: params.relationship as any,
        weight: params.weight, createdBy: params.createdBy,
      });
    } catch (err) {
      // Log clearly — never swallow
      // P0: in production a lost edge silently corrupts the governance graph.
      if (process.env.NODE_ENV === "production" && process.env.GRAPH_MODE !== "memory") {
        throw Object.assign(new Error(`SGIP: graph edge persistence failed — ${(err as Error).message}`),
          { code: "GRAPH_PERSIST_FAILED" });
      }
      console.error("[GraphDBAdapter] Failed to persist edge:", (err as Error).message,
        { from: params.fromId, to: params.toId, rel: params.relationship });
    }
  }

  /** Get the underlying in-memory graph (for queries/analysis). */
  getEngine(): SovereignKnowledgeGraph {
    return this.graph;
  }

  /** Sync a single entity node from DB record into graph. */
  async syncNode(entityId: string): Promise<void> {
    try {
      const rows = await query<{ id: string; type: string; title: string; status: string; riskLevel: string; owner: string }>(
        `SELECT id, type, title, status, "riskLevel", owner FROM "GovernanceEntity" WHERE id=$1 LIMIT 1`,
        [entityId],
      );
      if (rows[0]) {
        const e = rows[0];
        this.graph.upsertNode({
          id: e.id, type: e.type as any, label: e.title,
          properties: { status: e.status, riskLevel: e.riskLevel, owner: e.owner },
          createdBy: "system:sync",
        });
      }
    } catch (err) {
      if (process.env.NODE_ENV === "production" && process.env.GRAPH_MODE !== "memory") {
        throw Object.assign(new Error(`SGIP: graph node sync failed — ${(err as Error).message}`),
          { code: "GRAPH_SYNC_FAILED" });
      }
      console.warn("[GraphDBAdapter] syncNode failed (non-production):", (err as Error).message);
    }
  }
}
