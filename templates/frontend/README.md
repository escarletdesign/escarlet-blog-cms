# Plantillas frontend (blog)

El CMS es la fuente de sync y del Social Pack canónico. Cada landing solo guarda
un hook estable.

| Archivo | Destino |
|---------|---------|
| `escarlet-blog.mjs` | `scripts/escarlet-blog.mjs` (casi no cambia) |
| `wrappers/sync-blog-cms.mjs` | `scripts/sync-blog-cms.mjs` |
| `blog-articles.js` | `src/data/blog-articles.js` |
| `blog-articles.fallback.js` | `src/data/blog-articles.fallback.js` |
| `blog-via-mcp.mdc` | `.cursor/rules/` (sustituye `{{handle}}` / `{{domain}}`) |

Sync real. `GET {CMS}/runtime/v1/manifest.json`. El hook baja el runtime a
`.escarlet-blog-runtime/` en cada build; en v1.2.0 el manifiesto solo contiene
`sync-blog-cms.mjs`.

## Headless

El CMS entrega datos y las herramientas de publicación. El look de listado y ficha lo pinta **esta landing**.

- SPA. vistas `/blog` y `/blog/:slug` en `src/`
- HTML estático. `scripts/generate-blog-pages.mjs` + CSS (`blog-*`). Engancha `blog:pages` en el build tras el hook.
- La revisión humana vive en `/app/preview/{slug}`. El look público de `/blog` sigue en la landing.

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

El wrapper `blog:sync` sigue valiendo. Los Social Packs se consultan en el CMS.

`.gitignore`

```
src/data/blog.generated.js
.escarlet-blog-runtime/
```

## Env

```
BLOG_CMS_URL=https://cms.escarlet.design
BLOG_CMS_SITE=handle
BLOG_SITE_URL=https://dominio.com
BLOG_RUNTIME_CHANNEL=v1
```

Los canales activos vienen del CMS (`socialPackChannels`) vía sync (`SOCIAL_PACK_CHANNELS`).

Interruptor. CMS `/app/admin` → Sitio → **Blog en la web pública**. Env
`BLOG_ENABLED=false` solo como override local.

Helper.

```bash
npm run site:init -- --handle X --domain https://… --copy-frontend ../landing/scripts
```

(`--copy-frontend` copia el hook y stubs. No pega los generadores gordos.)
