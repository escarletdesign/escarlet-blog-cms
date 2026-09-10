# Escarlet Blog CMS

CMS headless central con MCP para agentes, app `/app` y API JSON multi-sitio.

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

App. http://localhost:3040/app

### PWA de contenidos

La nueva interfaz cliente vive en `/app/` (la ruta `/` también sirve la PWA cuando existe
el build); `/admin` queda solo para compatibilidad legacy. En desarrollo puedes levantar el
frontend con Vite y el CMS en paralelo:

```bash
npm run dev:server   # API en :3040
npm run dev          # Vite en :5173, proxy /api → :3040
```

La imagen Docker ejecuta `npm run build` durante el build, por lo que `server.mjs` sirve
`apps/pwa/dist` en producción. Activa `PRODUCT_RESTRUCTURE_V1=1` para magic links,
roles cliente y endpoints de IA/Stripe. Las claves `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY` y `STRIPE_SECRET_KEY`
se quedan siempre en el servidor. `ADMIN_TOKEN` es obligatorio (no hay token por defecto). Para guardar claves desde **Administración → IA y Billing**, configura también `AI_CONNECTOR_ENCRYPTION_KEY` con un secreto aleatorio de al menos 32 bytes; las claves se cifran con AES-256-GCM en `data/db.json`, que se escribe con modo `0600`. Consulta `.env.example` para el catálogo de precios y la migración explícita de instalaciones antiguas.

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
| `blog_get_workflow` | Elegir flujo simple o guiado en `/app` |
| `blog_generate_assisted_content` | Generar título, cuerpo, resumen y meta sin crear post |
| `blog_create_assisted_post` | Crear borrador + portada con IA y brand kit en servidor |
| `blog_generate_post_image` | Generar opciones de portada y guardarlas en la galería |
| `blog_generate_social_pack` | Generar copy + carrusel Instagram en servidor |
| `blog_create_draft` | Esqueleto borrador |
| `blog_update_post` | Actualizar campos |
| `blog_validate_seo` | Quality gates |
| `blog_publish` | Publicar o programar desde `/app` (`direct`, `publishAt`) |
| `blog_schedule_post` | Programar fecha futura desde `/app` (`direct`) |
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

ChatGPT (Developer Mode / Connectors). URL `https://blog-cms.escarlet.cc/mcp`, autenticación **OAuth**. Al autorizar pega el token de sitio o `ADMIN_TOKEN`. `/app/admin` genera un PNG del favicon (<10 KB) para el icono del conector al crear el token de cliente.

Claude (Customize / Connectors). URL `https://blog-cms.escarlet.cc/mcp`, autenticación **OAuth**. Al autorizar pega el token de sitio o `ADMIN_TOKEN`. Puede usar el mismo icono PNG.

## Integración frontend

```bash
BLOG_CMS_URL=http://localhost:3040 BLOG_CMS_SITE=escarlet npm run blog:sync
```

Plantilla genérica. `templates/frontend/escarlet-blog.mjs` baja sync y packs desde `/runtime/v1/`.
Build incluye sync automático. Ver [docs/ONBOARDING.md](docs/ONBOARDING.md).

**WordPress.** El plugin principal es [`integrations/wordpress-blog-client`](integrations/wordpress-blog-client): publica posts e imágenes nativas para Gutenberg. El bridge Elementor en [`integrations/wordpress`](integrations/wordpress) es opcional para páginas construidas con Elementor. Ambos se documentan en [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

**SEO multi-tecnología.** [`integrations/seo/index.mjs`](integrations/seo/index.mjs) comparte el contrato de metadatos, JSON-LD, sitemap, robots y navegación para landings Vite/Vue, HTML estático y adaptadores WordPress. La página debe entregar contenido semántico y `h1` en el HTML inicial; el CMS no sustituye ese ownership.

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
integrations/wordpress/     # plugin Elementor Bridge integrado y empaquetable
integrations/seo/           # contrato SEO común para landings y adaptadores
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
