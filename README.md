# Escarlet Blog CMS

CMS headless central con MCP para agentes, app `/app` y API JSON multi-sitio. El runtime canónico v2 usa Postgres para workspaces, membresías, brand kits versionados, batches multicanal y jobs/outbox; `db.json` queda como fuente de migración y adaptador del feed público.

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

La interfaz cliente vive en `/app/` (la ruta `/` también sirve la PWA cuando existe el build).
En desarrollo puedes levantar el frontend con Vite y el CMS en paralelo:

```bash
npm run dev:server   # API en :3040
npm run dev          # Vite en :5173, proxy /api → :3040
```

La imagen Docker ejecuta `npm run build` durante el build, por lo que `server.mjs` sirve
`apps/pwa/dist` en producción. El mismo contenedor arranca `server.mjs` y el worker
persistente (`worker.mjs`); ambos comparten `/app/data` y `DATABASE_URL`. Postgres se
ejecuta como recurso gestionado aparte (en local lo levanta `docker-compose`). Activa
`PRODUCT_RESTRUCTURE_V1=1` para magic links,
roles cliente y endpoints de IA/Stripe. Las claves `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY` y `STRIPE_SECRET_KEY`
se quedan siempre en el servidor. `ADMIN_TOKEN` es obligatorio (no hay token por defecto). Para guardar claves desde **Administración → IA y Billing**, configura también `AI_CONNECTOR_ENCRYPTION_KEY` con un secreto aleatorio de al menos 32 bytes; las claves se cifran con AES-256-GCM en `data/db.json`, que se escribe con modo `0600`. Para producción v2 configura `DATABASE_URL` y `CMS_SECRET_KEY`; ejecuta `npm run db:migrate` una única vez con el CMS en modo escritura congelada. Consulta `.env.example` para el catálogo de precios y la migración explícita de instalaciones antiguas.

Para operar únicamente con ChatGPT mediante MCP y edición manual, define `CMS_AI_ENABLED=0`. Ese kill switch devuelve `403 CMS_AI_DISABLED` en todas las rutas REST de IA, bloquea conectores, transcripción, imágenes y créditos, y oculta los flujos AI de la PWA; el endpoint `/mcp`, la membresía MCP y el editor manual siguen disponibles. Puede reactivarse con `CMS_AI_ENABLED=1` o con el flag global de Administración cuando no exista un valor de entorno.

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
| `blog_get_workflow` | Elegir flujo simple o guiado; ChatGPT genera y MCP persiste |
| `blog_list_authors` | Autores asignados y autorizados para publicar |
| `blog_save_social_pack` | Guardar el Social Pack generado por ChatGPT, sin usar IA del CMS |
| `social_save_pack` | Guardar un Social Pack independiente, sin crear ni actualizar un post |
| `social_list_packs` / `social_get_pack` | Listar o recuperar Social Packs independientes |
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
| `content_create_batch` | Crear una campaña de temas y canales; devuelve `batchId`, `itemIds`, `jobId` |
| `content_get_batch` | Progreso, items y variantes de un batch |
| `content_update_item` | Editar tema, variante y media enlazada |
| `content_approve` / `content_reject` | Revisión individual o masiva |
| `content_schedule` | Agenda individual o masiva; entrega a outbox/Metricool, Planable o Postiz según la conexión de la marca |

Resources. `brand://{handle}/voice`, `keywords`, `agent`, `image-guide`, `visual-style`, `image-spec`

Contratos HTTP v2: `/api/v2/content/batches`, `/api/v2/content/items` (incluye revisión, cancelación y agenda), `/api/v2/usage`, `/api/v2/brand-kits` y `/api/v2/brands/:id/connections` (Postiz, Metricool, Planable y web). App y MCP llaman al mismo servicio de dominio; `/api/sites/:handle/posts` permanece como read adapter público.

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

ChatGPT (Developer Mode / Connectors). URL `https://blog-cms.escarlet.cc/mcp`, autenticación **OAuth**. Es el mismo conector para todos los roles: al autorizar pega el token de usuario (`user_...`), sesión (`sess_...`), agencia, sitio o `ADMIN_TOKEN`. El token conserva rol, usuario y sitios asignados; nunca se mezclan permisos entre cuentas. `/app/admin` genera un PNG del favicon (<10 KB) para el icono del conector.

Claude (Customize / Connectors). URL `https://blog-cms.escarlet.cc/mcp`, autenticación **OAuth**. Usa los mismos tokens y alcance que ChatGPT. Puede usar el mismo icono PNG.

## Integración frontend

```bash
BLOG_CMS_URL=http://localhost:3040 BLOG_CMS_SITE=escarlet npm run blog:sync
```

Plantilla genérica. `templates/frontend/escarlet-blog.mjs` baja sync y packs desde `/runtime/v1/`.
Build incluye sync automático. Ver [docs/ONBOARDING.md](docs/ONBOARDING.md).

**WordPress.** El plugin principal es [`integrations/wordpress-blog-client`](integrations/wordpress-blog-client): publica posts e imágenes nativas para Gutenberg. El bridge Elementor en [`integrations/wordpress`](integrations/wordpress) es opcional para páginas construidas con Elementor. Ambos se documentan en [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

**SEO multi-tecnología.** [`integrations/seo/index.mjs`](integrations/seo/index.mjs) comparte el contrato de metadatos, JSON-LD, sitemap, robots y navegación para landings Vite/Vue, HTML estático y adaptadores WordPress. La página debe entregar contenido semántico y `h1` en el HTML inicial; el CMS no sustituye ese ownership.

## Sistema visual de contenidos

La arquitectura nueva de portadas y carruseles está en [`content-system/`](content-system/README.md). Usa `visualBrief` para controlar variedad y referencias, y `lib/instagram-renderer.mjs` para renderizar la tipografía fuera del generador de imágenes.

Comandos útiles:

```bash
npm run visual:audit -- --site=escarlet --json=/tmp/assets.json
npm run visual:cover -- --site=escarlet --title="Título" --summary="Resumen" --mode=automatic
npm run visual:render -- --input=content-system/examples/sample-carousel-output.json --output=tmp/carousel
npm run visual:regenerate -- --site=escarlet --slug=mi-post --dry-run
```

## Escritura más humana

La política editorial compartida vive en [`lib/human-writing.mjs`](lib/human-writing.mjs)
y el MCP la entrega en `MCP_INSTRUCTIONS` y en `sharedEditorialPolicy` dentro de
`blog_get_brand_context`. Así se aplica a todos los sitios junto con su voz y
restricciones locales, sin duplicarla en cada `AGENT.md`. El editor `/app`
también ofrece «Hacer más humano» para borradores existentes.

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
