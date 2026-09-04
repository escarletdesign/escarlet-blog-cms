# Plantillas frontend (blog)

El CMS es la fuente de sync y packs. Cada landing solo guarda un hook estable.

| Archivo | Destino |
|---------|---------|
| `escarlet-blog.mjs` | `scripts/escarlet-blog.mjs` (casi no cambia) |
| `wrappers/sync-blog-cms.mjs` | `scripts/sync-blog-cms.mjs` |
| `wrappers/generate-blog-social-packs.mjs` | `scripts/generate-blog-social-packs.mjs` |
| `blog-articles.js` | `src/data/blog-articles.js` |
| `blog-articles.fallback.js` | `src/data/blog-articles.fallback.js` |
| `blog-via-mcp.mdc` | `.cursor/rules/` (sustituye `{{handle}}` / `{{domain}}`) |
| `blog-social-packs.mdc` | `.cursor/rules/` (sustituye placeholders) |

Sync y packs reales. `GET {CMS}/runtime/v1/manifest.json`. El hook los baja a `.escarlet-blog-runtime/` en cada build.

## Headless

El CMS entrega datos y las herramientas de publicación. El look de listado y ficha lo pinta **esta landing**.

- SPA. vistas `/blog` y `/blog/:slug` en `src/`
- HTML estático. `scripts/generate-blog-pages.mjs` + CSS (`blog-*`). Engancha `blog:pages` en el build tras el hook.
- Preview del CMS y `templates/post.html` del repo CMS. solo ejemplo/revisión. no producción.

`bodyHtml` = contenido semántico. Sin nav, footer ni layout de página.

## Build

SPA:

```bash
node scripts/escarlet-blog.mjs && vite build
```

HTML estático (añade generador de páginas):

```bash
node scripts/escarlet-blog.mjs && node scripts/generate-blog-pages.mjs && vite build
```

Los wrappers `blog:sync` / `blog:packs` siguen valiendo. Llaman al mismo hook.

`.gitignore`

```
src/data/blog.generated.js
.escarlet-blog-runtime/
```

## Env

```
BLOG_CMS_URL=https://blog-cms.escarlet.cc
BLOG_CMS_SITE=handle
BLOG_SITE_URL=https://dominio.com
BLOG_PACKS_NAME=Packs Cliente
BLOG_PACKS_THEME=#47a4e7
BLOG_RUNTIME_CHANNEL=v1
```

Los canales activos vienen del CMS (`socialPackChannels`) vía sync (`SOCIAL_PACK_CHANNELS`).

Helper.

```bash
npm run site:init -- --handle X --domain https://… --copy-frontend ../landing/scripts
```

(`--copy-frontend` copia el hook y stubs. No pega los generadores gordos.)
