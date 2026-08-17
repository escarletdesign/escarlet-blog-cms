# Escarlet Blog CMS

Panel para cargar posts (título, slug, extracto, cuerpo, SEO, imagen, fechas, autor, estado) y una API JSON que cualquier web puede consumir en **build time**. El SEO vive en el dominio que renderiza el HTML, no aquí.

Hay dos modos:

1. **Ahora (recomendado para empezar):** servidor Node + SQLite/JSON, panel en `/admin`, API pública. Sin WordPress y sin Next.
2. **Después:** las colecciones de Payload 3 en `payload/collections/` se copian a un `create-payload-app` con Postgres en Coolify si necesitáis usuarios, roles y media library a lo grande.

## Contrato JSON (cualquier stack)

`GET /api/sites/:site/posts`

```json
{
  "site": "escarlet",
  "posts": [
    {
      "slug": "cuanto-cuesta-una-pagina-web",
      "title": "...",
      "metaTitle": { "es": "..." },
      "metaDescription": { "es": "..." },
      "datePublished": "2026-04-29",
      "dateModified": "2026-08-17",
      "imageUrl": "/images/blog/....webp",
      "imageAlt": "...",
      "authorName": "Silvia",
      "excerptEs": "...",
      "bodyHtml": "<p>...</p>",
      "relatedSlugs": ["otro-slug"],
      "status": "published"
    }
  ]
}
```

`GET /api/sites/:site/posts/:slug` — un post publicado.

Al publicar, si existe `REBUILD_WEBHOOK_URL`, se hace `POST` a esa URL (Coolify rebuild).

## Arranque

```bash
cp .env.example .env
npm install
npm run import:escarlet   # opcional: trae los posts de escarlet002
npm run dev
```

- Panel: http://localhost:3040/admin (cabecera `Authorization: Bearer ADMIN_TOKEN` o login del propio panel)
- API: http://localhost:3040/api/sites/escarlet/posts

## Integrar en Vite (escarlet.design)

En el repo de la web:

```
BLOG_CMS_URL=http://localhost:3040
BLOG_CMS_SITE=escarlet
```

`npm run build` llama a `scripts/sync-blog-cms.mjs`, que escribe `src/data/blog.generated.js`. Si no hay CMS, se usan los posts locales.

Otras tecnologías: mismo GET, pintar listado + artículo + JSON-LD `BlogPosting`. Plantilla mínima en `templates/post.html`.

## Payload 3

Las colecciones (`sites`, `posts`, `authors`, `media`, `categories`) están en `payload/`. Postgres de referencia: `docker compose up -d`. No hace falta Payload para publicar el blog de Escarlet: el servidor Node de este repo ya cubre panel, API y webhook.
