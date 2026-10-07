/**
 * prisma.service.ts — compatibility shim
 * All imports resolve to db.service (native pg).
 * This file exists only to avoid breaking imports during migration.
 * New code: import directly from "./db.service"
 */
export {
  connectDB,
  disconnectDB,
  query,
  queryOne,
  queryCount,
  transaction,
  getPool,
} from "./db.service";
