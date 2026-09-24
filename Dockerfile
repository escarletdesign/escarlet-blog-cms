# Vite 8 uses native Rolldown bindings. Debian avoids the silent musl failure
# observed in Coolify while keeping the same Node major version.
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
# Coolify can expose NODE_ENV=production while building the image. Vite and
# TypeScript are devDependencies, so explicitly include them for the build;
# they are removed by the prune step below before the runtime image is used.
RUN npm ci --include=dev

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
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3040) + '/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["node", "scripts/docker-entrypoint.mjs"]
