# SGIP Sovereign GRC OS — production image
# Qualified runtime baseline: Node.js 22.
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache curl dumb-init \
 && addgroup -g 1001 -S sgip \
 && adduser -S sgip -u 1001 -G sgip

COPY --from=builder --chown=sgip:sgip /app/dist ./dist
COPY --from=builder --chown=sgip:sgip /app/node_modules ./node_modules
COPY --from=builder --chown=sgip:sgip /app/package.json ./package.json
COPY --from=builder --chown=sgip:sgip /app/package-lock.json ./package-lock.json
# Startup verifies the authoritative migration ledger/checksums against these files.
COPY --from=builder --chown=sgip:sgip /app/db/migrations ./db/migrations

USER sgip
EXPOSE 4000
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:4000/health/ready || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/api/server.js"]

LABEL org.opencontainers.image.title="SGIP Sovereign GRC OS"
LABEL org.opencontainers.image.version="V4"
LABEL org.opencontainers.image.description="Enterprise Sovereign Governance Operating System"
LABEL org.opencontainers.image.vendor="SGIP"
LABEL org.opencontainers.image.licenses="Proprietary"
