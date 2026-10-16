# Escarlet Blog CMS

CMS headless central con MCP para agentes, app `/app` y API JSON multi-sitio. El runtime de datos v2 usa Postgres para workspaces, membresías, brand kits versionados, batches multicanal y jobs/outbox; el contrato de agentes es MCP v3. `db.json` queda como fuente de migración y adaptador del feed público.

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
`PRODUCT_RESTRUCTURE_V1=1` para magic links y roles de workspace. `ADMIN_TOKEN` es obligatorio, no hay token por defecto. Para producción V3 configura `DATABASE_URL` y `CMS_SECRET_KEY`; ejecuta `npm run db:migrate:v3` una única vez con el CMS en modo escritura congelada. Consulta `.env.example` para el resto de variables.

El CMS no genera contenido, imágenes ni vídeo en el servidor. Las rutas `/api/ai/*` devuelven `410 server_side_ai_removed`; `/mcp/v3` es el único contrato externo para preparar contexto, guardar resultados de una IA externa y publicar con revisión humana.

### Sistema de diseño de la PWA

La UI compartida está en `apps/pwa/src/ui/`, con tokens en `apps/pwa/src/ui/tokens.css`.
Consulta el [contrato de UI](docs/UI-DESIGN-SYSTEM.md) y las reglas para agentes en
[`AGENTS.md`](AGENTS.md) antes de crear una pantalla nueva. El guard se ejecuta con
`npm run ui:check` y el build de la PWA con `npm run build`.

Showcase público para revisar visualmente los componentes: `/app/design-system`.

### Escarlet V3

El producto canónico se organiza como Marca → Campaña opcional → Post → variantes por canal → publicación. La PWA usa la API Postgres `/api/v2` y los agentes externos usan únicamente `/mcp/v3`.

- [Modelo operativo V3](docs/ESCARLET-V3-OPERATING-MODEL.md)
- [Contrato de contenido](docs/CONTENT-MODEL.md)
- [Contrato MCP V3](docs/MCP-V3-CONTRACT.md)
- [Migración legacy](docs/MIGRATION-LEGACY-TO-V3.md)
- [UX de la PWA](docs/PWA-UX-V3.md)
- [Destinos de publicación](docs/PUBLICATION-DESTINATIONS.md)
- [Handoff para agentes](docs/AGENT-HANDOFF.md)
- [Skill portable para clientes MCP](payload/escarlet-mcp-content/SKILL.md)

## Nuevo sitio / onboarding

Guía completa. [docs/ONBOARDING.md](docs/ONBOARDING.md)

Skill global opcional para integrar el frontend desde cualquier workspace Cursor. `~/.cursor/skills/escarlet-blog-integrate/`
Pídele. «integra el blog CMS en este proyecto» o «añade la sección blog».

Para operar contenido desde Hermes, Cursor, Claude u otro cliente MCP, copia la
[skill portable de contenido](payload/escarlet-mcp-content/SKILL.md) en el cliente.
Esa es la guía pública de generación, revisión, administración y publicación.

```bash
# Alta de un handle nuevo + brand stubs
npm run site:init -- --handle mares24 --name "Mares 24" --domain https://mares24.com

# Copia plantillas sync al frontend
npm run site:init -- --handle demo --domain https://demo.example \
  --copy-frontend ../mi-landing/scripts
```

Por MCP v3, usa `capability.search` y después fija la marca con `brand.context.get`. El endpoint anterior `/mcp` está retirado.

Deploy producción. [docs/DEPLOY.md](docs/DEPLOY.md).

Extender el sistema. [docs/MICROAPP-DEVELOPMENT.md](docs/MICROAPP-DEVELOPMENT.md).

## MCP v3 tools

| Tool | Uso |
|------|-----|
| `capability.guide` / `capability.search` / `capability.get` | Explicar el MCP a un agente nuevo y descubrir el contrato correcto |
| `recipe.list` / `recipe.get` / `recipe.run` | Descubrir y ejecutar recipes compuestas hasta revisión |
| `brand.context.get` / `brand.voice.get` | Leer contexto y voz del snapshot activo |
| `workspace.context.get` / `content.post.list` | Resolver el scope autorizado y listar Posts canónicos paginados |
| `content.audit.inventory` / `content.audit.repair.plan` | Auditar vínculos, huérfanos y borradores vacíos sin escribir datos |
| `content.post.archive` | Archivar o restaurar Posts con confirmación e idempotencia |
| `brand.visual_style.get` / `brand.rules.get` | Leer estilo visual y reglas publicables |
| `brand.references.resolve` | Fijar referencias visuales permitidas |
| `brand.generation.prepare` | Crear una preparación versionada para un agente externo |
| `asset.upload` | Guardar el PNG final del agente con validación de dimensiones, copy y procedencia |
| `asset.list` / `asset.delete` | Consultar y limpiar assets canónicos con preflight de vínculos y confirmación explícita |
| `copy.validate` | Validar copy contra el Brand Kernel |
| `production.motion.compose` | Composición local con Remotion para escenas de imagen, fallback FFmpeg y handoff explícito a un proveedor externo |
| `production.video.upload` / `production.video.import` | Recibir un MP4 desde un conector MCP o importar una URL HTTPS para dejarlo listo para revisión y publicación |
| `production.image.product.transform` | Composición local determinista con Brand Kit y procedencia, o preparación para generación externa |
| `publication.destination.list` / `publication.route` | Elegir canal y proveedor compatibles |
| `publication.schedule` / `publication.publish` | Programar o publicar solo después de aprobación humana |
| `publication.status.get` | Consultar estado interno y externo |

La PWA concentra la creación en `/app/apps`, que crea un Post borrador con sus canales. El trabajo editorial continúa en `/app/content/:postId` y la publicación en `/app/publication`. No se exponen microapps de generación ni proveedores como flujo principal.

Resources. `escarlet://capabilities/index`, `escarlet://recipes/index` y `escarlet://brand/kernel` exponen el índice y el contrato. Los archivos fuente privados solo se gestionan desde la app por owner/admin.

Contratos HTTP v2: `/api/v2/content/batches`, `/api/v2/content/items` (incluye revisión, cancelación y agenda), `/api/v2/usage`, `/api/v2/brand-kits` y `/api/v2/brands/:id/connections`. La PWA y MCP v3 llaman al mismo servicio de dominio; `/api/sites/:handle/posts` permanece como read adapter público. La generación server-side y los endpoints `/api/ai/*` están retirados: la IA externa opera exclusivamente mediante `/mcp/v3`.

Hermes Agent no clona el CMS. En su configuración MCP:

```json
{
  "mcpServers": {
    "escarlet-blog": {
      "url": "https://cms.escarlet.design/mcp/v3",
      "headers": {
        "Authorization": "Bearer TU_PAT_PERSONAL_user_..."
      }
    }
  }
}
```

Hermes Agent también puede gestionar OAuth 2.1 directamente:

```yaml
mcp_servers:
  escarlet_blog:
    url: "https://cms.escarlet.design/mcp/v3"
    auth: oauth
```

En Grok Web, crea un conector personalizado con la misma URL y completa el
flujo OAuth. Grok usa Streamable HTTP y descubre las herramientas con
`tools/list`; si el conector solicita una credencial manual, usa un PAT
personal con alcance de usuario, nunca `ADMIN_TOKEN`.

ChatGPT (Developer Mode / Connectors). URL `https://cms.escarlet.design/mcp/v3`, autenticación **OAuth**. Es el mismo conector para todos los roles. Autoriza con tu usuario o usa un PAT personal (`user_...`). El rol y las marcas se resuelven desde las membresías actuales en cada solicitud; `ADMIN_TOKEN` queda reservado al servidor. `/app/admin` genera un PNG del favicon (<10 KB) para el icono del conector.

Claude (Customize / Connectors). URL `https://cms.escarlet.design/mcp/v3`, autenticación **OAuth**. Usa el mismo PAT personal y alcance por membresía que ChatGPT. Puede usar el mismo icono PNG.

## Publicación del repositorio

Este repositorio contiene el código, contratos, plantillas y skills públicas del
CMS. No contiene datos de producción ni credenciales. Antes de desplegar una
instancia, configura los secretos en el entorno del servidor, usa HTTPS y deja
`ADMIN_TOKEN` reservado para operaciones internas. Los clientes MCP deben usar
OAuth o un PAT personal con alcance por membresía.

Consulta la [política de seguridad](SECURITY.md) y la [guía de despliegue](docs/DEPLOY.md)
antes de exponer una instancia a Internet.

## Integración frontend

```bash
BLOG_CMS_URL=http://localhost:3040 BLOG_CMS_SITE=escarlet npm run blog:sync
```

Plantilla genérica. `templates/frontend/escarlet-blog.mjs` baja sync y packs desde `/runtime/v1/`.
Build incluye sync automático. Ver [docs/ONBOARDING.md](docs/ONBOARDING.md).

**WordPress.** El plugin principal es [`integrations/wordpress-blog-client`](integrations/wordpress-blog-client): publica posts e imágenes nativas para Gutenberg. El bridge Elementor en [`integrations/wordpress`](integrations/wordpress) es opcional para páginas construidas con Elementor. Ambos se documentan en [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

**SEO multi-tecnología.** [`integrations/seo/index.mjs`](integrations/seo/index.mjs) comparte el contrato de metadatos, JSON-LD, sitemap, robots y navegación para landings Vite/Vue, HTML estático y adaptadores WordPress. La página debe entregar contenido semántico y `h1` en el HTML inicial; el CMS no sustituye ese ownership.

## Sistema visual de contenidos

La arquitectura nueva de portadas y carruseles está en [`content-system/`](content-system/README.md). El MCP entrega referencias y reglas, la IA externa genera los textos y píxeles finales, y el CMS conserva los archivos sin recomponerlos.

Comandos útiles:

```bash
npm run visual:audit -- --site=escarlet --json=/tmp/assets.json
npm run visual:cover -- --site=escarlet --title="Título" --summary="Resumen" --mode=automatic
npm run visual:render -- --input=content-system/examples/sample-carousel-output.json --output=tmp/carousel
```

## Escritura más humana

La política editorial compartida vive en [`lib/human-writing.mjs`](lib/human-writing.mjs)
y el MCP v3 la entrega en `sharedEditorialPolicy` dentro de
`brand.context.get`. Así se aplica a todos los sitios junto con su voz y
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
