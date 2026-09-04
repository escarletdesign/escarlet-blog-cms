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

**Headless.** El CMS guarda datos (`bodyHtml`, portada, metas). El look de `/blog/{slug}` lo pinta la landing. El preview del CMS y `templates/post.html` no son la web pública. Para cambiar diseño de ficha. skill global `escarlet-blog-integrate` (sección Headless) y el generador/vista de esa landing.

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

Runtime en `{CMS}/runtime/v1/`. Cada landing guarda `scripts/escarlet-blog.mjs`.

1. `escarlet-blog.mjs` → `scripts/` + hook en `prebuild`/`build`
2. Wrappers `sync-blog-cms.mjs` / `generate-blog-social-packs.mjs` o un solo `node scripts/escarlet-blog.mjs`
3. `blog-articles.js` reexporta `blog.generated.js`
4. Fallback vacío opcional
5. `.gitignore` → `blog.generated.js` y `.escarlet-blog-runtime/`
6. Coolify env. `BLOG_CMS_URL`, `BLOG_CMS_SITE={handle}`, `BLOG_SITE_URL`
7. Regla Cursor. copia `blog-via-mcp.mdc` y sustituye `{{handle}}`
8. **Blog-packs**. El runtime los genera. Canales por sitio en CMS (`socialPackChannels`). El look de `/blog` sigue en la landing. Ver skill global `escarlet-blog-integrate`
9. **Interruptor**. CMS Sitio → Blog en la web pública. Apagar no borra posts. Quita `/blog` del siguiente rebuild.

## Cómo se edita

- **Texto e imágenes del post.** MCP o dashboard. Skill global `escarlet-blog-integrate` (sección Cómo se edita).
- **Look de listado y ficha.** En la landing. `generate-blog-pages.mjs` + CSS, o vistas Vue. Nunca `templates/post.html` del CMS.
- **On/off.** Interruptor del CMS. No uses env de Coolify salvo override local.

## Coolify webhook (contenido → rebuild)

1. Coolify → app del **frontend** (producción) → Deploy Webhook
2. CMS `/admin` → Sitio → pega URL + token API → Probar → Guardar
3. `blog_publish` dispara el POST. Coolify rebuild. Sync baja posts

Git push = código (con caché). Webhook del CMS = contenido. Usa force=true para no reciclar el dist.

## Flujo de posts (MCP)

| Crear | Editar |
|-------|--------|
| `blog_get_brand_context` | igual |
| `blog_create_draft` | `blog_get_post` |
| `blog_update_post` | `blog_update_post` (mismo slug) |
| `blog_upload_media_file` (`kind` `post` o `social`. Adjunta el PNG en `file`. El CMS descarga y comprime a JPEG) | idem |
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
