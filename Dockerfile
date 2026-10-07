# SGIP Sovereign GRC OS — Multi-stage Dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --prefer-offline
COPY . .
RUN npm run build
RUN npm prune --production

# Stage 2: Security scan (in CI)
FROM aquasec/trivy:latest AS scanner
COPY --from=builder /app/dist ./dist
RUN trivy fs --exit-code 0 --severity HIGH,CRITICAL ./dist || true

# Stage 3: Production
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache curl dumb-init
# Security: run as non-root
RUN addgroup -g 1001 -S sgip && adduser -S sgip -u 1001 -G sgip
COPY --from=builder --chown=sgip:sgip /app/dist ./dist
COPY --from=builder --chown=sgip:sgip /app/node_modules ./node_modules
COPY --from=builder --chown=sgip:sgip /app/package.json ./

# Health endpoint for Kubernetes probes
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3   CMD curl -f http://localhost:4000/health || exit 1

USER sgip
EXPOSE 4000
ENV NODE_ENV=production
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/api/server.js"]

# Labels for SBOM / supply chain
LABEL org.opencontainers.image.title="SGIP Sovereign GRC OS"
LABEL org.opencontainers.image.version="8.0"
LABEL org.opencontainers.image.description="Enterprise Sovereign Governance Operating System"
LABEL org.opencontainers.image.vendor="SGIP"
LABEL org.opencontainers.image.licenses="Proprietary"
