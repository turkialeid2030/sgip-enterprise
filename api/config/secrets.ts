/**
 * Secret contract (P0).
 * In production a missing secret is a startup/authn failure — never a silent
 * fallback to a well-known development value, which would make every token
 * forgeable by anyone who has read the source.
 */
const DEV_DEFAULTS: Record<string, string> = {
  JWT_SECRET:         "dev_secret",
  JWT_REFRESH_SECRET: "dev_refresh_secret",
};

export function requireSecret(name: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v;
  if (process.env.NODE_ENV === "production") {
    throw Object.assign(new Error(`SGIP: ${name} is required in production — refusing to use a development default.`),
      { code: "SECRET_MISSING", secret: name });
  }
  const dev = DEV_DEFAULTS[name];
  if (!dev) throw new Error(`SGIP: unknown secret '${name}'.`);
  return dev;
}

/** Called at startup so a misconfigured production process never reaches listen(). */
export function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== "production") return;
  const missing = Object.keys(DEV_DEFAULTS).filter(k => !process.env[k]?.trim());
  if (missing.length) {
    throw Object.assign(new Error(`SGIP: missing required production secret(s): ${missing.join(", ")}`),
      { code: "SECRET_MISSING" });
  }
}
