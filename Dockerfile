FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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
