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

## Nuevo sitio / onboarding

Guía completa. [docs/ONBOARDING.md](docs/ONBOARDING.md)

Skill **global** (cualquier workspace Cursor). `~/.cursor/skills/escarlet-blog-integrate/`  
Pídele. «integra el blog CMS en este proyecto» o «añade la sección blog».

```bash
# Alta de un handle nuevo + brand stubs
npm run site:init -- --handle mares24 --name "Mares 24" --domain https://mares24.com

# Copia plantillas sync al frontend
npm run site:init -- --handle demo --domain https://demo.example \
  --copy-frontend ../mi-landing/scripts
```

Por MCP. `blog_get_onboarding` y `blog_create_site`.

Deploy producción. [docs/DEPLOY.md](docs/DEPLOY.md).

## MCP tools

| Tool | Uso |
|------|-----|
| `blog_get_onboarding` | Playbook setup + Coolify + flujo posts |
| `blog_create_site` | Alta de un site (handle + brand stubs) |
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
| `blog_import_brand_zip` | ZIP de brand kit (cualquier estructura). Preferir `zipUrl` |

Resources. `brand://{handle}/voice`, `keywords`, `agent`, `image-guide`, `visual-style`, `image-spec`

Hermes (otro servidor) no clona el CMS. En su `mcp.json`:

```json
{
  "mcpServers": {
    "escarlet-blog": {
      "url": "https://blog-cms.escarlet.cc/mcp",
      "headers": {
        "Authorization": "Bearer EL_MISMO_ADMIN_TOKEN_DEL_CMS"
      }
    }
  }
}
```

ChatGPT (Developer Mode / Connectors). URL `https://blog-cms.escarlet.cc/mcp`, autenticación **OAuth**. Al autorizar pega el token de sitio o `ADMIN_TOKEN`. El dashboard genera un PNG del favicon (<10 KB) para el icono del conector al crear el token de cliente.

## Integración frontend

```bash
BLOG_CMS_URL=http://localhost:3040 BLOG_CMS_SITE=escarlet npm run blog:sync
```

Plantilla genérica. `templates/frontend/sync-blog-cms.mjs`.
Build incluye sync automático. Ver [docs/ONBOARDING.md](docs/ONBOARDING.md).

## Migración (escarlet)

```bash
cd ../escarlet002 && npm run blog:export
cd ../escarlet-blog-cms && npm run import:escarlet
```

## Estructura

```
config/sites/{handle}/     # seed site.json + brand kit
templates/site/            # stubs para site:init
templates/frontend/        # sync + regla Cursor
lib/                       # SEO, DB, brand kit, onboarding
mcp/                       # Servidor MCP
data/db.json               # Posts (gitignored)
data/media/                # Imágenes subidas
docs/ONBOARDING.md         # Multi-sitio + Coolify
docs/DEPLOY.md             # Coolify CMS + volumen
```

## Tests

```bash
npm test
```
