FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# Build the Vite PWA during the image build, then remove toolchain dependencies
# from the final node_modules tree. This keeps runtime images small while making
# apps/pwa/dist available to server.mjs in production.
RUN npm ci && npm run build && npm prune --omit=dev

COPY . .

# Coolify Persistent Storage must mount exactly here
ENV CMS_DATA_DIR=/app/data
RUN mkdir -p /app/data/media /app/data/brand /app/data/site-config

ENV PORT=3040
ENV NODE_ENV=production

VOLUME ["/app/data"]

EXPOSE 3040

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "scripts/docker-entrypoint.mjs"]
