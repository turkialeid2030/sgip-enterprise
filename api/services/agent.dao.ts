/**
 * Agent Output DAO — persists AI Gateway outputs for review tracking.
 */
import { query, queryOne } from "./db.service";

export const AgentDAO = {
  async create(params: {
    id: string; agentId: string; outputType: string; inputSummary: string;
    outputJson: unknown; confidenceScore: number; evidenceRefs: string[];
    hallucinationCheckPassed: boolean; requiresHumanReview: boolean;
    reviewerStatus: string; modelName: string; promptVersion: string;
    traceId: string; sessionId: string; tenantId: string;
  }): Promise<void> {
    await query(
      `INSERT INTO "AgentOutput"
       (id,"agentId","outputType","inputSummary","outputJson","confidenceScore",
        "evidenceRefs","hallucinationCheckPassed","requiresHumanReview",
        "reviewerStatus","modelName","promptVersion","traceId","sessionId","tenantId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        params.id, params.agentId, params.outputType,
        params.inputSummary.slice(0, 200),
        JSON.stringify(params.outputJson),
        params.confidenceScore, params.evidenceRefs,
        params.hallucinationCheckPassed, params.requiresHumanReview,
        params.reviewerStatus, params.modelName, params.promptVersion,
        params.traceId, params.sessionId, params.tenantId,
      ],
    );
  },

  async findPending(tenantId: string, status = "pending", agentId?: string) {
    const cond = agentId ? `AND "agentId" = $3` : "";
    const params: unknown[] = [tenantId, status];
    if (agentId) params.push(agentId);
    return query(
      `SELECT * FROM "AgentOutput" WHERE "tenantId"=$1 AND "reviewerStatus"=$2 ${cond} ORDER BY "createdAt" DESC LIMIT 50`,
      params,
    );
  },

  async findOne(id: string, tenantId: string) {
    return queryOne(`SELECT * FROM "AgentOutput" WHERE id=$1 AND "tenantId"=$2`, [id, tenantId]);
  },

  async review(id: string, tenantId: string, decision: "approved"|"rejected", reviewedBy: string) {
    const rows = await query(
      `UPDATE "AgentOutput" SET "reviewerStatus"=$1, "reviewedBy"=$2, "reviewedAt"=NOW()
       WHERE id=$3 AND "tenantId"=$4 RETURNING *`,
      [decision, reviewedBy, id, tenantId],
    );
    if (!rows[0]) throw new Error(`AgentOutput ${id} not found`);
    return rows[0];
  },

  async count(tenantId: string, status?: string): Promise<number> {
    const cond = status ? "AND \"reviewerStatus\" = $2" : "";
    const params: unknown[] = [tenantId];
    if (status) params.push(status);
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "AgentOutput" WHERE "tenantId"=$1 ${cond}`, params,
    );
    return parseInt(row?.count ?? "0");
  },
};
