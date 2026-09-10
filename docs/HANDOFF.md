# Handoff — Escarlet Blog CMS

Documento para retomar el proyecto desde otro chat o workspace Cursor.

## Qué es

CMS headless central + MCP para agentes (Hermes). Los posts **no van a git** de escarlet002. El frontend hace pull en build.

```
Hermes → HTTPS /mcp (mismo servicio CMS)
                    ↓
              data/db.json + brand kit
                    ↓ publish
              webhook Coolify
                    ↓
         escarlet002 rebuild → sync-blog-cms → escarlet.design/blog
```

## Onboarding multi-sitio (sep 2026)

Para dar de alta otro proyecto. [ONBOARDING.md](./ONBOARDING.md)

```bash
npm run site:init -- --handle CLIENTE --domain https://...
```

MCP. `blog_get_onboarding` + `blog_create_site`. Plantillas en `templates/`.

## Repos

| Repo | Ruta local |
|------|------------|
| CMS + MCP | `/Users/carlosbrugiafredo/Documents/Escarlet/_Landigs/escarlet-blog-cms` |
| Web Escarlet | `/Users/carlosbrugiafredo/Documents/Escarlet/_Landigs/escarlet002` |

## Estado implementado (sep 2026)

- MCP con 10 tools + 4 resources brand kit
- SEO validator + tests
- App `/app` (posts, preview, media contextual, **brand kit** con voz + referencias, **sitio**); `/admin` queda solo como compatibilidad temporal
- Docker + compose con volumen `/app/data`
- 21 posts migrados al CMS
- escarlet002 sync en `prebuild` y `dev`
- Regla `.cursor/rules/blog-via-mcp.mdc` en escarlet002

## Arranque local

```bash
# CMS
cd escarlet-blog-cms && npm run dev
# o
npm run docker:up

# Web
cd escarlet002
BLOG_CMS_URL=http://localhost:3040 npm run dev
```

App. http://localhost:3040/app

## MCP Cursor

El MCP es el endpoint `POST https://blog-cms.escarlet.cc/mcp` del mismo servicio. Hermes solo pone `url` + `Authorization` Bearer. Ver `docs/mcp.json.example`.

## Deploy pendiente (Carlos)

1. Repo GitHub para `escarlet-blog-cms`
2. Coolify app CMS (Dockerfile, volumen `/app/data`, puerto 3040)
3. Coolify escarlet002 → env `BLOG_CMS_URL`, `BLOG_CMS_SITE=escarlet`
4. Webhook en `/app/admin` → tab **Sitio** (no solo env var)
5. MCP en `~/.cursor/mcp.json`

## Git deploy vs webhook de posts

Son **dos caminos distintos** al mismo sitio (escarlet.design):

| Trigger | Cuándo | Qué cambia |
|---------|--------|------------|
| **Git push** | Commits en escarlet002 (código Vue, CSS, scripts) | Código de la app |
| **Deploy webhook** | Publicar post en CMS | Contenido del blog (pull API en build) |

No necesitas otro repo git para posts. El CMS guarda contenido. Al publicar, el CMS llama al **Deploy Webhook** de Coolify y escarlet002 se reconstruye **sin push**.

### URL del webhook correcta

Usa el webhook de la app **escarlet.design en producción**, no la de preview `trino blog`.

En Coolify → app producción escarlet002 → Webhooks → **Deploy Webhook (auth required)**.

Ejemplo formato:
`https://coolify.escarlet.cc/api/v1/deploy?uuid=...`

Pégala en `/app/admin` → tab **Sitio** → Deploy webhook.

La captura de `trino blog (localhost)` es otra app. Solo sirve si quieres rebuild de esa preview.

## Webhook white-label (app)

Desde v2 el webhook va en `config/sites/{handle}/site.json` → campo `rebuildWebhookUrl`.

Editable en `/app/admin` → tab **Sitio**. Cada cliente/site tiene su URL de rebuild del frontend.

Prioridad al publicar:
1. `rebuildWebhookUrl` del site (`/app/admin`)
2. Variable env `REBUILD_WEBHOOK_URL` (fallback global)

## Archivos clave

```
escarlet-blog-cms/
  server.mjs              API + admin
  mcp/index.mjs           MCP stdio
  lib/seo-validator.mjs
  config/sites/escarlet/  seed. voz, visual-style, AGENT.md
  data/brand/{site}/       kit editable (volumen, gitignored)
  docs/DEPLOY.md
  docs/mcp.json.example
  Dockerfile
  docker-compose.yml

escarlet002/
  scripts/sync-blog-cms.mjs
  src/data/blog-articles.js          → re-export
  src/data/blog-articles.fallback.js → offline
  .cursor/rules/blog-via-mcp.mdc
```

## Decisiones de arquitectura

- CMS en repo **separado**, no dentro de escarlet002
- Servicio **central white-label**, no una instancia CMS por web
- SEO vive en escarlet.design (HTML prerenderizado), no en el CMS
- Agente **nunca** commitea posts a git del frontend

## Comandos útiles

```bash
# Migración posts
cd escarlet002 && npm run blog:export
cd ../escarlet-blog-cms && npm run import:escarlet

# Tests CMS
cd escarlet-blog-cms && npm test
```

## Chat origen

Plan e implementación desde conversación en workspace escarlet002 (sep 2026). Problema original: agente Trino/Hermes mergeaba código basura en `trino/blogs` al publicar blogs.
