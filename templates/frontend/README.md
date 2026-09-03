# Plantillas frontend (blog)

Copia estos archivos al proyecto web. Fuente única. no uses `escarlet002` como origen.

| Archivo | Destino |
|---------|---------|
| `sync-blog-cms.mjs` | `scripts/sync-blog-cms.mjs` |
| `generate-blog-social-packs.mjs` | `scripts/generate-blog-social-packs.mjs` |
| `blog-articles.js` | `src/data/blog-articles.js` |
| `blog-articles.fallback.js` | `src/data/blog-articles.fallback.js` |
| `blog-via-mcp.mdc` | `.cursor/rules/` (sustituye `{{handle}}` / `{{domain}}`) |
| `blog-social-packs.mdc` | `.cursor/rules/` (sustituye placeholders) |

## Build

```bash
node scripts/sync-blog-cms.mjs && node scripts/generate-blog-social-packs.mjs && vite build
```

## Env packs

```
BLOG_SITE_URL=https://dominio.com
BLOG_PACKS_NAME=Packs Cliente
BLOG_PACKS_THEME=#47a4e7
BLOG_PACKS_CHANNELS=substack,linkedin,x,videoScript,instagramCarousel
```

Los canales activos vienen del CMS (`socialPackChannels`) vía sync (`SOCIAL_PACK_CHANNELS`). `BLOG_PACKS_CHANNELS` es un override opcional.

Helper desde el CMS.

```bash
npm run site:init -- --handle X --domain https://… --copy-frontend ../landing/scripts
```

(`--copy-frontend` copia todo `templates/frontend/` al directorio indicado.)
