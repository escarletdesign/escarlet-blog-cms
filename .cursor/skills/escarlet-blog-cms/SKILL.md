---
name: escarlet-blog-cms
description: >-
  Onboarding multi-sitio del CMS headless Escarlet. Usa cuando hay que crear un
  site nuevo, añadir sección blog a una landing, configurar sync/Coolify webhook,
  preparar un brand kit compatible o explicar a un agente el flujo MCP de crear/editar posts.
---

# Skill Escarlet Blog CMS (multi-sitio)

CMS **central** white-label. Un servicio. Muchos handles (`escarlet`, `mares24`, …).
Los posts viven en el CMS. El frontend solo hace pull en build.

**Headless.** El CMS guarda datos (`bodyHtml`, portada, metas). El look de `/blog/{slug}` lo pinta la landing. Para cambiar diseño de ficha usa la skill global `escarlet-blog-integrate` (sección Headless) y el generador/vista de esa landing.

## Cuándo usar

- Instalar blog en un proyecto nuevo o existente
- Construir/importar el brand kit de un site desde otra landing
- Configurar Deploy webhook de Coolify
- Crear/editar posts vía MCP sin tocar git del frontend
- Dudas de Hermes sobre el flujo

## Primera acción del agente

1. Si el humano pide **setup / instalar / otro sitio** desde **cualquier** workspace → skill global `escarlet-blog-integrate` (`~/.cursor/skills/escarlet-blog-integrate/`)
2. Si pide construir el brand kit → skill global `escarlet-cms-brandkit` (`~/.cursor/skills/escarlet-cms-brandkit/`)
3. En este repo o con MCP. `blog_get_onboarding` (y si hace falta `blog_create_site`)
4. Si pide **escribir o editar un post** → `blog_get_brand_context` con el `site` correcto
5. Leer también `docs/ONBOARDING.md` si trabajas en el workspace del CMS
6. UI de la app. patrones en `apps/pwa/src/styles.css` y componentes de `apps/pwa/src/App.tsx`

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

Luego brand kit. Dashboard `/app/admin`, `blog_update_brand_file` o la skill
`escarlet-cms-brandkit` + fotos `kind=reference`.

## Frontend

Runtime en `{CMS}/runtime/v1/`. Cada landing guarda `scripts/escarlet-blog.mjs`.

1. `escarlet-blog.mjs` → `scripts/` + hook en `prebuild`/`build`
2. Sync servido desde `/runtime/v1/`; los Social Packs viven en el CMS
3. `blog-articles` reexporta el archivo generado (JS o TS)
4. Fallback vacío
5. `.gitignore` → archivo generado y `.escarlet-blog-runtime/`
6. Coolify env. `BLOG_CMS_URL`, `BLOG_CMS_SITE={handle}`, `BLOG_SITE_URL`
7. Regla Cursor. copia `blog-via-mcp.mdc` y sustituye `{{handle}}`
8. **Social Pack**. El runtime v1.2.0 solo sincroniza posts. El pack canónico vive en CMS `/app/social-pack/{slug}`. Canales por sitio en CMS (`socialPackChannels`).
9. **Interruptor**. CMS Sitio → Blog en la web pública. Apagar no borra posts y el sync emite un módulo vacío.
10. **Dashboard `/app/admin`**. La PWA gestiona brand kit, sitios, revisión y el interruptor. El look de `/blog` sigue en la landing.

## Cómo se edita

- **Texto e imágenes del post.** MCP o `/app`. Skill global `escarlet-blog-integrate` (sección Contenido y publicación).
- **Humanizar contenido.** Usa la skill global `$storyscope-human-writing` para revisar el cuerpo sin inventar hechos ni intentar esquivar detectores. En `/app`, la acción «Hacer más humano» aplica la misma guía a un borrador existente.
- **Look de listado y ficha.** En la landing. `generate-blog-pages.mjs` + CSS, o vistas Vue.
- **On/off.** Interruptor del CMS. No uses env de Coolify salvo override local.

## Coolify webhook (contenido → rebuild)

1. Coolify → app del **frontend** (producción) → Deploy Webhook
2. CMS `/app/admin` → Sitio → pega URL + token API → Probar → Guardar
3. `blog_publish` dispara el POST. Coolify rebuild. Sync baja posts

Git push = código (con caché). Webhook del CMS = contenido. Usa force=true para no reciclar el dist.

## Flujo de posts (MCP)

| Crear | Editar |
|-------|--------|
| `blog_get_brand_context` | igual |
| `blog_create_draft` | `blog_get_post` |
| `blog_update_post` | `blog_update_post` (mismo slug) |
| `blog_upload_media_file` (`kind` `post` o `social`. Adjunta el PNG en `file`. El CMS descarga y comprime a JPEG) | idem |
| `blog_validate_seo` → `blog_publish` o `blog_schedule_post` con `publishAt` | idem |

**Programar.** `publishAt` YYYY-MM-DD futuro. Con el interruptor del sitio activo queda `pending_schedule` hasta `blog_confirm_schedule` (solo super-admin). Luego `scheduled` y el ticker lo publica el día. Calendario en `/app/calendar`.

**Brand kit y PAT personal.** El MCP recibe el contexto normalizado completo de la marca, incluidos voz, estilo, paleta, tipografías, composición, arquetipos, templates y referencias aprobadas. Los archivos fuente privados quedan en la app para owner/admin. Para construirlos desde una landing usa `escarlet-cms-brandkit` y luego importa el ZIP con `blog_import_brand_zip`.

Prohibido. Commitear posts al frontend. Usar `create_draft` para editar.

## API pública

```
GET {CMS}/api/sites/{handle}/posts
GET {CMS}/api/sites/{handle}/posts/{slug}
```

Solo `published`.

## Docs

- `docs/ONBOARDING.md`: checklist completo
- `docs/DEPLOY.md`: volumen CMS + Coolify
- `docs/HANDOFF.md`: contexto histórico escarlet002
