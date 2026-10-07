#!/usr/bin/env node
/**
 * Secondary static guard for the SGIP HTTP error contract.
 * Runtime fault injection remains authoritative; this script catches regressions
 * before the heavier E2E harness is executed.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const failures = [];
const pass = [];

function assert(name, condition, detail) {
  if (condition) pass.push(name);
  else failures.push(`${name}: ${detail}`);
}
function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const apiFiles = walk(path.join(root, 'api'));
const productFiles = [
  ...apiFiles,
  ...walk(path.join(root, 'tenant')),
  ...walk(path.join(root, 'policy-engine')),
  ...walk(path.join(root, 'runtime')),
];
const allTsFiles = walk(root).filter(f => !f.includes(`${path.sep}node_modules${path.sep}`) && !f.includes(`${path.sep}dist${path.sep}`));

// 1) No raw err.message/stack/detail in outbound JSON.
const rawResponsePatterns = [
  /\.json\([^\n]{0,260}(?:err(?:or)?(?:\s+as\s+Error)?\)?\.message|err\.message|err\.stack)/i,
  /(?:detail|error)\s*:\s*process\.env\.NODE_ENV[^\n]{0,180}(?:message|stack|detail)/i,
  /\.json\(\s*(?:err|error)\s*\)/i,
];
let rawResponseFindings = [];
for (const f of apiFiles) {
  const rel = path.relative(root, f);
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (rawResponsePatterns.some((rx) => rx.test(line))) rawResponseFindings.push(`${rel}:${i + 1}:${line.trim()}`);
  });
}
assert('NO_RAW_ERROR_RESPONSE', rawResponseFindings.length === 0, rawResponseFindings.join(' | '));

// 2) Correlation is globally installed before security/auth routes and is present in errors.
const server = read('api/server.ts');
assert('CORRELATION_BEFORE_ROUTES',
  server.indexOf('app.use(correlationMiddleware)') >= 0 &&
  server.indexOf('app.use(correlationMiddleware)') < server.indexOf('app.use("/api/auth"'),
  'correlationMiddleware must execute before rate limits/routes');
assert('UNIFIED_ERROR_BOUNDARY', server.includes('app.use(errorMiddleware)'), 'global errorMiddleware is not mounted');

// 2b) Hidden C0 control characters in TypeScript can silently change regex semantics
// (for example 0x08 instead of a literal \\b word-boundary) while remaining valid syntax.
const controlChars = [];
for (const f of allTsFiles) {
  const buf = fs.readFileSync(f);
  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (let j = 0; j < line.length; j++) {
      const c = line.charCodeAt(j);
      if (c < 32 && c !== 9) controlChars.push(`${path.relative(root, f)}:${i + 1}:0x${c.toString(16).padStart(2,'0')}`);
    }
  });
}
assert('NO_HIDDEN_C0_CONTROL_CHARS', controlChars.length === 0, controlChars.join(', '));

const errorBoundary = read('api/middleware/error.middleware.ts');
assert('HEADERS_SENT_DELEGATES',
  /if\s*\(res\.headersSent\)\s*\{\s*next\(err\);\s*return;\s*\}/.test(errorBoundary),
  'error middleware must delegate to Express default handler after headers are sent');

const corr = read('api/middleware/correlation.middleware.ts');
assert('CORRELATION_HEADER', corr.includes('X-Correlation-Id'), 'response correlation header missing');
assert('CORRELATION_4XX_BODY', corr.includes('res.statusCode >= 400') && corr.includes('correlationId'), 'direct 4xx JSON is not correlated');

// 3) Importing app must not start persistence/listeners during Jest/Supertest import.
assert('SIDE_EFFECT_FREE_SERVER_IMPORT',
  /if\s*\(require\.main\s*===\s*module\)/.test(server) && !/\nstart\(\);/.test(server),
  'server starts unconditionally on module import');

// 4) Entity type contract: canonical/legacy normalize; unknowns rejected.
const schema = read('api/validation/entity.schemas.ts');
const entityType = read('api/validation/entity-type.ts');
assert('ENTITY_TYPE_CANONICALIZATION', schema.includes('normalizeEntityType(value)') && entityType.includes('resolveEntityType(value)'), 'canonical resolver not used');
assert('ENTITY_TYPE_UNKNOWN_REJECTED', schema.includes('unsupported entity type') && schema.includes('ctx.addIssue'), 'unknown entity type is not rejected');

// 5) Graph route must match the documented/harness endpoint.
const graph = read('api/routes/graph.routes.ts');
assert('GRAPH_NODE_ROUTE', graph.includes('"/node/:nodeId"'), 'GET /api/graph/node/:id route missing');

// AI provider status belongs to the governed HTTP boundary, not the SDK error.
const aiGateway = read('api/services/ai.gateway.ts');
assert('AI_UNAVAILABLE_503', aiGateway.includes('code: "AI_SERVICE_UNAVAILABLE"') && aiGateway.includes('statusCode: 503'), 'AI configuration/auth unavailability is not governed as 503');
assert('AI_PROVIDER_STATUS_STRIPPED', aiGateway.includes('code: "AI_PROVIDER_ERROR"') && aiGateway.includes('new Error(e.message)'), 'provider-specific status may escape into HTTP status');
assert('AI_HEURISTIC_WORD_BOUNDARIES', aiGateway.includes('/\\b(definitely|certainly|always|never|guaranteed)\\b/i') && aiGateway.includes('/\\b(ref:|citation:|source:|regulation:|article:|section:)/i'), 'AI hallucination/citation heuristics do not use literal regex word boundaries');

// 6) Approval state transition must be serialized and surface governed 409.
const approval = read('policy-engine/approval/approval.runtime.ts');
assert('APPROVAL_ROW_LOCK', approval.includes('FOR UPDATE'), 'approval decision read lacks row lock');
assert('APPROVAL_CAS_UPDATE', approval.includes("status='pending'") && approval.includes('RETURNING id'), 'approval update lacks pending-state CAS');
assert('APPROVAL_CONCURRENT_409', approval.includes('CONCURRENT_APPROVAL_STATE_CHANGED'), 'governed concurrency code missing');

// 7) Test auth must be deterministic without adding a product-side test bypass.
const jestConfig = read('jest.config.js');
const jestSetup = read('tests/jest.setup.ts');
assert('JEST_TEST_SECRET_SETUP', jestConfig.includes('tests/jest.setup.ts') && jestSetup.includes('JWT_SECRET = "dev_secret"'), 'Jest auth secret not aligned with fixtures');
const seamRx = /SGIP_.*CANARY|FAULT_INJECT|TEST_SEAM|__test/i;
const seams = [];
for (const f of productFiles) {
  const t = fs.readFileSync(f, 'utf8');
  if (seamRx.test(t)) seams.push(path.relative(root, f));
}
const authMiddlewareSrc = read('api/middleware/auth.middleware.ts');
assert('TENANT_SCOPE_REJECTION_FORWARDED',
  /runInTenantScope\(payload\.tenantId[\s\S]*?\.catch\(next\)/.test(authMiddlewareSrc),
  'auth middleware must forward async tenant-scope rejection to unified boundary');

assert('NO_TEST_SEAM_IN_PRODUCT', seams.length === 0, seams.join(', '));

console.log(`STATIC_ERROR_CONTRACT_CHECKS=${pass.length + failures.length}`);
console.log(`STATIC_ERROR_CONTRACT_PASS=${pass.length}`);
console.log(`STATIC_ERROR_CONTRACT_FAIL=${failures.length}`);
for (const p of pass) console.log(`PASS ${p}`);
for (const f of failures) console.error(`FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
