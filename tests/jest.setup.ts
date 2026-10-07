// Deterministic test-only secret contract. No product bypass is introduced.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "dev_secret";
process.env.JWT_REFRESH_SECRET = "dev_refresh_secret";
