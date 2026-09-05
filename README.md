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
| `blog_publish` | Publicar, revisión o programar (`publishAt`) |
| `blog_schedule_post` | Programar fecha futura |
| `blog_confirm_schedule` | Confirmar pendiente (super-admin) |
| `blog_cancel_schedule` | Cancelar programación |
| `blog_list_calendar` | Posts del calendario |
| `blog_get_seo_context` | Keywords y reglas |
| `blog_get_brand_context` | Contexto de marca (site token sin voz ni image-spec) |
| `blog_update_brand_file` | Site token. solo AGENT.md y keywords.md |
| `blog_upload_media` | PNG/JPG en `contentBase64` o `blob` (2–3 MB valen). `kind` `post` o `social`. El CMS comprime a JPEG. Si recorta, `uploadId` a trozos |
| `blog_import_remote_image` | Solo URL https pública (atajo) |
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

Claude (Customize / Connectors). URL `https://blog-cms.escarlet.cc/mcp`, autenticación **OAuth**. Al autorizar pega el token de sitio o `ADMIN_TOKEN`. Puede usar el mismo icono PNG.

## Integración frontend

```bash
BLOG_CMS_URL=http://localhost:3040 BLOG_CMS_SITE=escarlet npm run blog:sync
```

Plantilla genérica. `templates/frontend/escarlet-blog.mjs` baja sync y packs desde `/runtime/v1/`.
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
templates/frontend/        # hook escarlet-blog + runtime sync/packs
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
