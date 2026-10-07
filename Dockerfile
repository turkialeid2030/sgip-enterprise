# SGIP Sovereign GRC OS — production image
# Build/runtime Node version is intentionally aligned with qualification CI.

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache curl dumb-init \
  && addgroup -g 1001 -S sgip \
  && adduser -S sgip -u 1001 -G sgip

COPY --from=builder --chown=sgip:sgip /app/dist ./dist
COPY --from=builder --chown=sgip:sgip /app/node_modules ./node_modules
COPY --from=builder --chown=sgip:sgip /app/package.json ./
# Startup verifies the authoritative migration ledger against these files.
COPY --from=builder --chown=sgip:sgip /app/db/migrations ./db/migrations

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:4000/health/ready || exit 1

USER sgip
EXPOSE 4000
ENV NODE_ENV=production
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/api/server.js"]

LABEL org.opencontainers.image.title="SGIP Sovereign GRC OS"
LABEL org.opencontainers.image.version="8.0"
LABEL org.opencontainers.image.description="Enterprise Sovereign Governance Operating System"
LABEL org.opencontainers.image.vendor="SGIP"
LABEL org.opencontainers.image.licenses="Proprietary"
