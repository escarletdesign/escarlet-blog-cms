# Skill Escarlet Blog CMS

Conecta un proyecto web al CMS central de blogs Escarlet.

## Cuándo usar

- Nuevo sitio Escarlet/cliente con blog headless
- Agente Hermes debe crear posts sin tocar git del frontend

## Checklist onboarding

### En escarlet-blog-cms

1. Crear `config/sites/{handle}/site.json`
2. Copiar brand kit. `voice.md`, `visual-style.md`, `image-guide.md`, `keywords.md`, `AGENT.md`
3. Registrar site en DB vía dashboard o editar `data/db.json`
4. Configurar webhook rebuild del frontend

### En el proyecto web (Vue/Vite template)

1. Copiar [`scripts/sync-blog-cms.mjs`](../../../escarlet002/scripts/sync-blog-cms.mjs)
2. Añadir al build. `node scripts/sync-blog-cms.mjs && ...`
3. `src/data/blog-articles.js` → `export * from './blog.generated.js'`
4. Mantener `blog-articles.fallback.js` para offline
5. `.gitignore` → `src/data/blog.generated.js`
6. Env Coolify. `BLOG_CMS_URL`, `BLOG_CMS_SITE`

### Cursor

1. Regla `.cursor/rules/blog-via-mcp.mdc` adaptada al `{handle}`
2. MCP `escarlet-blog` en mcp.json

## API pública

```
GET /api/sites/{handle}/posts
GET /api/sites/{handle}/posts/{slug}
```

Solo posts `published`.

## WordPress (futuro)

Plugin stub. consume misma API y mapea a `post` + meta SEO.
