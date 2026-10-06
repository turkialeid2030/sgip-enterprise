-- Initial PostgreSQL setup
-- Runs on first container start via docker-entrypoint-initdb.d

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Row-Level Security preparation (enable after Prisma migrations)
-- ALTER TABLE "GovernanceEntity" ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON "GovernanceEntity"
--   USING ("tenantId" = current_setting('app.tenant_id', true));
