# Escarlet Blog CMS

CMS headless central con MCP para agentes, dashboard de revisión y API JSON multi-sitio.

## Arranque local

```bash
cp .env.example .env
npm install
npm run dev
```

### Docker (volumen data automático)

```bash
cp .env.example .env
npm run docker:up
```

Dashboard. http://localhost:3040/admin

Deploy producción. Ver [docs/DEPLOY.md](docs/DEPLOY.md).

## MCP tools

| Tool | Uso |
|------|-----|
| `blog_list_sites` | Sitios configurados |
| `blog_list_posts` | Posts por site y status |
| `blog_get_post` | Leer post |
| `blog_create_draft` | Esqueleto borrador |
| `blog_update_post` | Actualizar campos |
| `blog_validate_seo` | Quality gates |
| `blog_publish` | Publicar + webhook |
| `blog_get_seo_context` | Keywords y reglas |
| `blog_get_brand_context` | Voz, estilo visual, AGENT.md e imágenes de referencia |
| `blog_update_brand_file` | Subir o corregir un archivo del kit |
| `blog_upload_media` | Portada (`post`) o moodboard (`reference`) |

Resources. `brand://escarlet/voice`, `keywords`, `agent-rules`, `image-guide`

## Integración escarlet002

```bash
# escarlet002
BLOG_CMS_URL=http://localhost:3040 BLOG_CMS_SITE=escarlet npm run blog:sync
```

Build incluye sync automático. Ver [docs/DEPLOY.md](docs/DEPLOY.md).

## Migración

```bash
cd ../escarlet002 && npm run blog:export
cd ../escarlet-blog-cms && npm run import:escarlet
```

## Estructura

```
config/sites/{handle}/   # site.json + brand kit
lib/                     # SEO, DB, brand kit
mcp/                     # Servidor MCP
data/db.json             # Posts (gitignored)
data/media/              # Imágenes subidas
docs/DEPLOY.md           # Coolify + mcp.json
```

## Tests

```bash
npm test
```
