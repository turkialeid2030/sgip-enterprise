# Security Audit — SGIP

**Method:** Static code review + live auth test. Classified Critical/High/Medium/Low.

## Findings

### HIGH
- **H1 — Hardcoded dev secret fallbacks.** `api/middleware/auth.middleware.ts:27` and `api/routes/auth.routes.ts` use `process.env.JWT_SECRET ?? "dev_secret"` (and `dev_refresh_secret`). There is **no startup guard** refusing to boot when these env vars are unset in production. Risk: if deployed without JWT_SECRET, tokens are signed with a publicly-known string → full auth bypass.
  - **Fix:** fail-fast at boot if `NODE_ENV=production` and `JWT_SECRET`/`JWT_REFRESH_SECRET` unset.
- **H2 — 6 high npm vulnerabilities** (minimatch ReDoS ×3 advisories). `npm audit fix` available (non-breaking). Also 4 moderate (@hono/node-server middleware bypass, uuid bounds — breaking fixes).

### MEDIUM
- **M1 — JWT algorithm not pinned.** `jwt.verify` does not restrict `algorithms: ['HS256']`, leaving theoretical alg-confusion surface. Fix: pass explicit algorithms array.
- **M2 — Token lifetime.** Access token default 8h is long for a governance console; consider 15m access + refresh (refresh already implemented).

### LOW
- **L1 — Error leakage** is correctly gated (`NODE_ENV==='production'` hides err.message). ✅ good.

## Controls VERIFIED present (positives)
- ✅ **helmet()** enabled (`api/server.ts:72`).
- ✅ **CORS** configured (`api/server.ts:86`).
- ✅ **Rate limiting** — auth 20/15min, AI 30/min, global 200/min (`express-rate-limit`).
- ✅ **bcrypt** password hashing, cost factor **12** (`bcrypt.hash(password, 12)`).
- ✅ **RBAC** — `checkPermission`/`authMiddleware` applied across all route files (executive: 47 checks, governance: 16, sceos: 22, etc.).
- ✅ **Auth enforced** — verified live: protected route with no token → 401.
- ✅ **Tenant isolation** — RLS at SQL layer (75 policy statements).

## OWASP Top 10 quick map
- A01 Broken Access Control: RBAC + RLS present; verify per-route in prod. 
- A02 Crypto Failures: bcrypt✅; **fix dev_secret (H1)**.
- A05 Security Misconfig: helmet✅; **fix prod secret guard**.
- A06 Vulnerable Components: **6 high / 4 moderate — run npm audit fix**.
- A07 Auth Failures: rate-limit✅, bcrypt✅; pin JWT alg (M1).
