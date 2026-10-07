/**
 * Tenant-Aware Repository Base
 * All database repositories MUST extend this class.
 * Guarantees every query is scoped to the correct tenant.
 * Cross-tenant joins are structurally impossible through this layer.
 */
import { TenantContext } from "../types/tenant.types";
import { query, queryOne } from "../api/services/db.service";
import { assertTenantOwnership, requireTenantContext } from "./tenant.context";

export abstract class TenantAwareRepository<T extends { id: string; tenantId: string }> {
  constructor(protected readonly tableName: string) {}

  /**
   * Find a single entity — ALWAYS scoped to tenant.
   * Returns null if not found OR if belongs to different tenant.
   */
  async findById(id: string, ctx: TenantContext): Promise<T | null> {
    requireTenantContext(ctx, `${this.tableName}.findById`);
    const row = await queryOne<T>(
      `SELECT * FROM "${this.tableName}" WHERE id = $1 AND "tenantId" = $2 LIMIT 1`,
      [id, ctx.tenantId],
    );
    return row;
  }

  /**
   * Find many — ALWAYS scoped to tenant. No cross-tenant leakage possible.
   */
  async findMany(
    ctx:    TenantContext,
    filter: Record<string, unknown> = {},
    opts:   { limit?: number; offset?: number; orderBy?: string } = {},
  ): Promise<T[]> {
    requireTenantContext(ctx, `${this.tableName}.findMany`);
    const conditions: string[] = ['"tenantId" = $1'];
    const params:     unknown[] = [ctx.tenantId];
    let p = 2;

    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null) {
        conditions.push(`"${k}" = $${p++}`);
        params.push(v);
      }
    }

    const where  = `WHERE ${conditions.join(" AND ")}`;
    const order  = opts.orderBy ? `ORDER BY "${opts.orderBy}" DESC` : `ORDER BY "createdAt" DESC`;
    const limit  = `LIMIT $${p++}`;   params.push(opts.limit  ?? 50);
    const offset = `OFFSET $${p}`;    params.push(opts.offset ?? 0);

    return query<T>(`SELECT * FROM "${this.tableName}" ${where} ${order} ${limit} ${offset}`, params);
  }

  /**
   * Count — ALWAYS tenant-scoped.
   */
  async count(ctx: TenantContext, filter: Record<string, unknown> = {}): Promise<number> {
    requireTenantContext(ctx, `${this.tableName}.count`);
    const conditions: string[] = ['"tenantId" = $1'];
    const params:     unknown[] = [ctx.tenantId];
    let p = 2;

    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null) {
        conditions.push(`"${k}" = $${p++}`);
        params.push(v);
      }
    }

    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM "${this.tableName}" WHERE ${conditions.join(" AND ")}`,
      params,
    );
    return parseInt(row?.count ?? "0");
  }

  /**
   * Verify ownership before any mutation. Throws 403 if mismatch.
   */
  async assertOwnership(id: string, ctx: TenantContext): Promise<T> {
    requireTenantContext(ctx, `${this.tableName}.assertOwnership`);
    const entity = await queryOne<T>(
      `SELECT id, "tenantId" FROM "${this.tableName}" WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!entity) {
      throw Object.assign(
        new Error(`Entity not found: ${this.tableName}/${id}`),
        { statusCode: 404, code: "ENTITY_NOT_FOUND" },
      );
    }
    assertTenantOwnership(ctx, entity.tenantId, id, this.tableName);
    return entity;
  }
}
