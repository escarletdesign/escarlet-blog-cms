---
name: escarlet-blog-cms
description: >-
  Onboarding multi-sitio del CMS headless Escarlet. Usa cuando hay que crear un
  site nuevo, añadir sección blog a una landing, configurar sync/Coolify webhook,
  o explicar a un agente el flujo MCP de crear/editar posts.
---

# Skill Escarlet Blog CMS (multi-sitio)

CMS **central** white-label. Un servicio. Muchos handles (`escarlet`, `mares24`, …).
Los posts viven en el CMS. El frontend solo hace pull en build.

## Cuándo usar

- Instalar blog en un proyecto nuevo o existente
- Configurar Deploy webhook de Coolify
- Crear/editar posts vía MCP sin tocar git del frontend
- Dudas de Hermes sobre el flujo

## Primera acción del agente

1. Si el humano pide **setup / instalar / otro sitio** desde **cualquier** workspace → skill global `escarlet-blog-integrate` (`~/.cursor/skills/escarlet-blog-integrate/`)
2. En este repo o con MCP. `blog_get_onboarding` (y si hace falta `blog_create_site`)
3. Si pide **escribir o editar un post** → `blog_get_brand_context` con el `site` correcto
4. Leer también `docs/ONBOARDING.md` si trabajas en el workspace del CMS

## Alta rápida de un site

### CLI (en escarlet-blog-cms)

```bash
npm run site:init -- --handle CLIENT --name "Nombre" --domain https://dominio.com
# opcional. --webhook URL --token COOLIFY_TOKEN --copy-frontend ../landing/scripts
```

### MCP

```
blog_create_site { handle, name, domain, rebuildWebhookUrl?, coolifyApiToken? }
blog_get_onboarding { site: handle }
```

Luego brand kit. Dashboard `/admin` o `blog_update_brand_file` + fotos `kind=reference`.

## Frontend

Plantillas en `templates/frontend/`.

1. `sync-blog-cms.mjs` → `scripts/` + hook en `prebuild`/`build`
2. `blog-articles.js` reexporta `blog.generated.js`
3. Fallback vacío opcional
4. `.gitignore` → `blog.generated.js`
5. Coolify env. `BLOG_CMS_URL`, `BLOG_CMS_SITE={handle}`, `BLOG_SITE_URL`
6. Regla Cursor. copia `blog-via-mcp.mdc` y sustituye `{{handle}}`
7. **Blog-packs**. Copia `templates/frontend/generate-blog-social-packs.mjs` (env `BLOG_SITE_URL` / `BLOG_PACKS_*`). Build: sync → packs → vite. Ver skill global `escarlet-blog-integrate`

## Coolify webhook (contenido → rebuild)

1. Coolify → app del **frontend** (producción) → Deploy Webhook
2. CMS `/admin` → Sitio → pega URL + token API → Probar → Guardar
3. `blog_publish` dispara el POST. Coolify rebuild. Sync baja posts

Git push = código. Webhook = solo blog.

## Flujo de posts (MCP)

| Crear | Editar |
|-------|--------|
| `blog_get_brand_context` | igual |
| `blog_create_draft` | `blog_get_post` |
| `blog_update_post` | `blog_update_post` (mismo slug) |
| `blog_upload_media` (preferir `imageUrl`) | idem |
| `blog_validate_seo` → `blog_publish` | idem |

Prohibido. Commitear posts al frontend. Usar `create_draft` para editar.

## API pública

```
GET {CMS}/api/sites/{handle}/posts
GET {CMS}/api/sites/{handle}/posts/{slug}
```

Solo `published`.

## Docs

- `docs/ONBOARDING.md` — checklist completo
- `docs/DEPLOY.md` — volumen CMS + Coolify
- `docs/HANDOFF.md` — contexto histórico escarlet002
