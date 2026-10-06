/**
 * Entity DAO — typed CRUD for GovernanceEntity table.
 * Single source of truth for all entity DB operations.
 * No raw SQL outside this file for entity operations.
 */
import { v4 as uuidv4 } from "uuid";
import { query, queryOne, queryCount, transaction } from "./db.service";

export interface DBEntity extends Record<string, unknown> {
  id:                   string;
  type:                 string;
  title:                string;
  description?:         string;
  owner:                string;
  ownerId?:             string;
  department?:          string;
  status:               string;
  priority:             string;
  riskLevel:            string;
  impactLevel:          string;
  financialImpactJson?: Record<string, unknown>;
  legalImpact?:         string;
  complianceImpact?:    string;
  dueDate?:             Date;
  reviewDate?:          Date;
  closedDate?:          Date;
  confidentiality:      string;
  evidenceSufficiency?: number;
  confidenceScore?:     number;
  dataJson:             Record<string, unknown>;
  linkedPolicies:       string[];
  linkedRisks:          string[];
  linkedControls:       string[];
  linkedEvidence:       string[];
  linkedRegulations:    string[];
  linkedFindings:       string[];
  linkedCAPAs:          string[];
  linkedDecisions:      string[];
  linkedObligations:    string[];
  tags:                 string[];
  version:              number;
  tenantId:             string;
  organizationId:       string;
  createdBy:            string;
  updatedBy:            string;
  createdAt:            Date;
  updatedAt:            Date;
}

export interface FindManyOpts {
  tenantId:  string;
  type?:     string;
  status?:   string;
  owner?:    string;
  riskLevel?:string;
  take?:     number;
  skip?:     number;
  orderBy?:  "updatedAt" | "createdAt" | "title";
  orderDir?: "ASC" | "DESC";
}

const SELECT_ALL = `
  SELECT id, type, title, description, owner, "ownerId", department,
         status, priority, "riskLevel", "impactLevel",
         "financialImpactJson", "legalImpact", "complianceImpact",
         "dueDate", "reviewDate", "closedDate", confidentiality,
         "evidenceSufficiency", "confidenceScore", "dataJson",
         "linkedPolicies", "linkedRisks", "linkedControls", "linkedEvidence",
         "linkedRegulations", "linkedFindings", "linkedCAPAs", "linkedDecisions",
         "linkedObligations", tags, version, "tenantId", "organizationId",
         "createdBy", "updatedBy", "createdAt", "updatedAt"
  FROM "GovernanceEntity"
`;

export const EntityDAO = {
  async findMany(opts: FindManyOpts): Promise<DBEntity[]> {
    const conditions: string[] = ['"tenantId" = $1', 'status != \'archived\''];
    const params: unknown[] = [opts.tenantId];
    let p = 2;
    if (opts.type)      { conditions.push(`type = $${p++}`);           params.push(opts.type); }
    if (opts.status)    { conditions.push(`status = $${p++}`);         params.push(opts.status); }
    if (opts.owner)     { conditions.push(`owner = $${p++}`);          params.push(opts.owner); }
    if (opts.riskLevel) { conditions.push(`"riskLevel" = $${p++}`);    params.push(opts.riskLevel); }
    const where  = `WHERE ${conditions.join(" AND ")}`;
    const order  = `ORDER BY "${opts.orderBy ?? "updatedAt"}" ${opts.orderDir ?? "DESC"}`;
    const limit  = `LIMIT $${p++}`;   params.push(opts.take  ?? 50);
    const offset = `OFFSET $${p++}`;  params.push(opts.skip  ?? 0);
    return query<DBEntity>(`${SELECT_ALL} ${where} ${order} ${limit} ${offset}`, params);
  },

  async findOne(id: string, tenantId: string): Promise<DBEntity | null> {
    return queryOne<DBEntity>(
      `${SELECT_ALL} WHERE id = $1 AND "tenantId" = $2 LIMIT 1`,
      [id, tenantId],
    );
  },

  async count(opts: FindManyOpts): Promise<number> {
    return queryCount("GovernanceEntity", {
      ...(opts.type      && { type:      opts.type }),
      ...(opts.status    && { status:    opts.status }),
      ...(opts.riskLevel && { riskLevel: opts.riskLevel }),
    }, opts.tenantId);
  },

  /** V5.2A: tx-aware — INSERT runs on the caller's transaction when supplied. */
  async createIn(tx: { query: (sql: string, p?: unknown[]) => Promise<unknown> },
                 data: Omit<DBEntity, "createdAt" | "updatedAt">): Promise<DBEntity> {
    return this.create(data, tx);
  },

  async create(data: Omit<DBEntity, "createdAt" | "updatedAt">,
               tx?: { query: (sql: string, p?: unknown[]) => Promise<unknown> }): Promise<DBEntity> {
    const exec = tx
      ? ((sql: string, p?: unknown[]) => tx.query(sql, p) as Promise<DBEntity[]>)
      : query<DBEntity>;
    const rows = await exec(
      `INSERT INTO "GovernanceEntity" (
        id, type, title, description, owner, "ownerId", department,
        status, priority, "riskLevel", "impactLevel",
        "financialImpactJson", "legalImpact", "complianceImpact",
        "dueDate", "reviewDate", confidentiality, "dataJson",
        "linkedPolicies", "linkedRisks", "linkedControls", "linkedEvidence",
        "linkedRegulations", "linkedFindings", "linkedCAPAs", "linkedDecisions",
        "linkedObligations", tags, version, "tenantId", "organizationId",
        "createdBy", "updatedBy"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
      ) RETURNING *`,
      [
        data.id, data.type, data.title, data.description ?? null,
        data.owner, data.ownerId ?? null, data.department ?? null,
        data.status, data.priority, data.riskLevel, data.impactLevel,
        data.financialImpactJson ? JSON.stringify(data.financialImpactJson) : null,
        data.legalImpact ?? null, data.complianceImpact ?? null,
        data.dueDate ?? null, data.reviewDate ?? null,
        data.confidentiality, JSON.stringify(data.dataJson ?? {}),
        data.linkedPolicies, data.linkedRisks, data.linkedControls,
        data.linkedEvidence, data.linkedRegulations, data.linkedFindings,
        data.linkedCAPAs, data.linkedDecisions, data.linkedObligations,
        data.tags, data.version, data.tenantId, data.organizationId,
        data.createdBy, data.updatedBy,
      ],
    );
    if (!rows[0]) throw new Error("Entity creation failed — no row returned");
    return rows[0];
  },

  async update(
    id: string,
    tenantId: string,
    patch: Partial<DBEntity>,
    updatedBy: string,
  ): Promise<DBEntity | null> {
    const setClauses: string[] = [`"updatedBy" = $1`, `version = version + 1`, `"updatedAt" = NOW()`];
    const params: unknown[]    = [updatedBy];
    let p = 2;

    const colMap: Record<string, string> = {
      title: "title", description: "description", status: "status",
      priority: "priority", riskLevel: '"riskLevel"', owner: "owner",
      dueDate: '"dueDate"', reviewDate: '"reviewDate"', closedDate: '"closedDate"',
      dataJson: '"dataJson"', tags: "tags", confidenceScore: '"confidenceScore"',
      evidenceSufficiency: '"evidenceSufficiency"', legalImpact: '"legalImpact"',
    };

    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !(k in colMap)) continue;
      setClauses.push(`${colMap[k]} = $${p++}`);
      params.push(k === "dataJson" ? JSON.stringify(v) : v);
    }

    params.push(id, tenantId);
    const idP  = p++;
    const tidP = p;

    const rows = await query<DBEntity>(
      `UPDATE "GovernanceEntity" SET ${setClauses.join(", ")}
       WHERE id = $${idP} AND "tenantId" = $${tidP}
       RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  },

  async archive(id: string, tenantId: string, updatedBy: string): Promise<void> {
    await query(
      `UPDATE "GovernanceEntity" SET status = 'archived', "updatedBy" = $1, version = version + 1
       WHERE id = $2 AND "tenantId" = $3`,
      [updatedBy, id, tenantId],
    );
  },

  // ── Graph edges via SQL ──────────────────────────────────────
  async getEdges(entityId: string, tenantId: string): Promise<unknown[]> {
    return query(
      `SELECT ge.*, e.type AS "toType_ref", e.title AS "toTitle", e.status AS "toStatus", e."riskLevel" AS "toRiskLevel"
       FROM "GraphEdge" ge
       JOIN "GovernanceEntity" e ON ge."toId" = e.id
       WHERE ge."fromId" = $1 AND ge."tenantId" = $2
       ORDER BY ge."createdAt" DESC`,
      [entityId, tenantId],
    );
  },

  async getInEdges(entityId: string, tenantId: string): Promise<unknown[]> {
    return query(
      `SELECT ge.*, e.type AS "fromType_ref", e.title AS "fromTitle"
       FROM "GraphEdge" ge
       JOIN "GovernanceEntity" e ON ge."fromId" = e.id
       WHERE ge."toId" = $1 AND ge."tenantId" = $2
       ORDER BY ge."createdAt" DESC`,
      [entityId, tenantId],
    );
  },

  async upsertEdge(params: {
    fromId: string; fromType: string; toId: string; toType: string;
    relationship: string; weight?: number; tenantId: string; createdBy: string;
  }): Promise<void> {
    await query(
      `INSERT INTO "GraphEdge" (id, "fromId", "fromType", "toId", "toType", relationship, weight, "tenantId", "createdBy")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT ("fromId","toId",relationship) DO UPDATE SET weight = EXCLUDED.weight`,
      [uuidv4(), params.fromId, params.fromType, params.toId, params.toType,
       params.relationship, params.weight ?? 5, params.tenantId, params.createdBy],
    );
  },
};
