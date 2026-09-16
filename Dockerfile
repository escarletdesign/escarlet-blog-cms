FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build the Vite PWA during the image build, then remove toolchain dependencies
# from the final node_modules tree. This keeps runtime images small while making
# apps/pwa/dist available to server.mjs in production.
RUN npm run build && npm prune --omit=dev

# Coolify Persistent Storage must mount exactly here
ENV CMS_DATA_DIR=/app/data
RUN mkdir -p /app/data/media /app/data/brand /app/data/site-config

ENV PORT=3040
ENV NODE_ENV=production
ENV WORKER_ENABLED=1
# Safe default for deployments: content generation comes from ChatGPT via MCP
# or the manual editor until CMS_AI_ENABLED=1 is explicitly configured.
ENV CMS_AI_ENABLED=0

VOLUME ["/app/data"]

EXPOSE 3040
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "scripts/docker-entrypoint.mjs"]
