# Deploy Escarlet Blog CMS

## Docker local (volumen automático)

El `docker-compose.yml` monta un volumen nombrado en `/app/data`. No hace falta crear carpetas a mano.

```bash
cp .env.example .env
# Edita ADMIN_TOKEN y REBUILD_WEBHOOK_URL

npm run docker:up
```

El volumen `escarlet_blog_cms_data` conserva el feed público y los archivos de migración. La operación nueva vive en Postgres; `db.json` solo es fuente de importación/exportación.

El compose levanta `postgres` y un único servicio `cms`. Ese contenedor inicia la API y
el worker Node persistente (`worker.mjs`), que reclama jobs/outbox con leases y
reintentos; no depende de Redis ni de un segundo contenedor de aplicación.

Primera vez con DB vacía. Importa posts después:

```bash
npm run blog:export   # en escarlet002
npm run import:escarlet
# O copia tu db.json al volumen si ya lo tienes local
```

---

## 1. CMS en Coolify

### Arquitectura recomendada

En producción crea dos recursos dentro del mismo proyecto/red de Coolify:

1. Un recurso **PostgreSQL gestionado** para la base canónica (no ejecutes Postgres
   dentro del contenedor de la aplicación).
2. Esta aplicación Docker, cuyo contenedor ejecuta API + worker. Usa el hostname
   interno del recurso Postgres en `DATABASE_URL`; `localhost` dentro del contenedor
   apunta al CMS, no a Postgres.

### Build

- Tipo. **Dockerfile** (raíz del repo)
- Puerto expuesto. `3040`
- Health check. `GET /api/health`
- Rama. `master`
- No configures un proceso/servicio adicional `node worker.mjs`: el entrypoint ya lo
  inicia en el mismo contenedor cuando `WORKER_ENABLED=1`.

### Volumen persistente (importante)

Sin este volumen, **cada redeploy borra posts, media y brand kit**.

En Coolify → tu app CMS → **Storages / Persistent Storage** → Add:

| Campo | Valor exacto |
|-------|----------------|
| Name | `cms-data` |
| Destination Path | `/app/data` |
| Size | 1 GB o más |

Comprueba tres veces:

1. Destination Path es exactamente `/app/data` (no `/data`, no `/app/data/db.json`).
2. El storage está **activo** en la app de `blog-cms.escarlet.cc`.
3. Tras el deploy, abre `https://blog-cms.escarlet.cc/api/health` y mira `persistence`.

Ejemplo sano:

```json
{
  "persistence": {
    "dataDir": "/app/data",
    "writable": true,
    "posts": 1,
    "mediaFiles": 2,
    "likelyDockerVolume": true,
    "ok": true
  }
}
```

Si `likelyDockerVolume` es `false` o `posts` vuelve a `0` tras un redeploy, el volumen no está montado. Corrígelo antes de volver a generar posts con Hermes.

### Postgres en Coolify

1. Crea **PostgreSQL** (16 o superior) en el mismo proyecto y red privada.
2. Guarda usuario, contraseña y nombre de base generados por Coolify.
3. En la app CMS configura una URL como
   `postgres://usuario:password@<nombre-interno-del-servicio>:5432/escarlet_blog`.
   Si tu proveedor exige TLS, añade los parámetros SSL que indique el proveedor.
4. No publiques el puerto 5432 a Internet salvo que una operación externa lo
   necesite. Activa backups programados y prueba una restauración antes de migrar.

### Variables de entorno (CMS)

Configúralas como secretos/variables de Coolify, nunca en el repositorio:

```
NODE_ENV=production
PORT=3040
CMS_PUBLIC_URL=https://blog-cms.escarlet.cc
ADMIN_TOKEN=<secreto-aleatorio-largo>
DEFAULT_SITE=escarlet
DATABASE_URL=postgres://usuario:password@postgres:5432/escarlet_blog
CMS_SECRET_KEY=<32+ bytes aleatorios; 64 hex recomendado>
WORKER_ENABLED=1
CMS_AI_ENABLED=0
PRODUCT_RESTRUCTURE_V1=1
```

Añade además las variables de la funcionalidad que actives: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `PWA_STRIPE_PRICE_*`, `RESEND_API_KEY` y las claves de
proveedores de IA. `CMS_SECRET_KEY` es necesaria para cifrar credenciales de
Metricool; no la cambies entre deploys.

### Stripe Payment Links (product-restructure F4)

Con `PRODUCT_RESTRUCTURE_V1=1`:

1. Crea Payment Links en Stripe (setup, membership, hosting opcional).
2. En cada link, metadata: `site=<handle>`, `kind=setup|membership|hosting`, `planId=standard` (membership/setup).
3. Webhook Stripe → `POST https://blog-cms…/api/stripe/webhook` (evento `checkout.session.completed`).
4. Env: `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL` y `CMS_SECRET_KEY` (32 bytes o más). Postgres es obligatorio para `/api/v2`, membresías workspace y jobs; el ledger Stripe conserva compatibilidad JSON solo durante la importación.
5. Agency: `GET /api/admin/payment-links` muestra el contrato de metadata.

Si el contenido lo genera ChatGPT por MCP, añade `CMS_AI_ENABLED=0` al entorno del CMS. Se desactivan las rutas REST de IA, conectores, transcripción, imágenes y créditos; `/mcp` y el editor manual siguen operativos.

Si montaste el volumen en otra ruta:

```
CMS_DATA_DIR=/ruta/del/volumen
```

El entrypoint crea `media/`, `brand/` y `site-config/`. Si el volumen está vacío, copia `data-seed/db.json` como base.

No copies `data/db.json` dentro de la imagen. Eso va en el volumen.

Si el volumen se montó **después** de subir medios, esos archivos se perdieron. Vuelve a subirlos. Una imagen de pocos bytes también se ve rota. El CMS rechaza subidas incompletas.

### Corte único JSON → Postgres

Con el CMS detenido para escritura, ejecuta una vez:

```bash
npm run db:migrate -- --dry-run
npm run db:migrate
```

El importador crea un backup verificable en `data/migration-backups/`, aplica las migraciones SQL, conserva hashes SHA-256 de media e informa conteos de sitios, miembros, posts, variantes y entitlements. Revisa el resultado antes de habilitar clientes.

En Coolify puedes abrir **Terminal / Execute Command** sobre el contenedor CMS y
ejecutar esos comandos allí. Haz primero `--dry-run`, comprueba los conteos y luego
el import real. Congela las escrituras del CMS durante el corte; no ejecutes el
importador en cada deploy. El arranque normal solo aplica migraciones SQL
idempotentes.

### Metricool (después del primer deploy)

Conecta cada workspace/sitio desde un cliente con rol `owner` o `admin`:

```bash
curl -X POST https://blog-cms.escarlet.cc/api/v2/integrations/metricool/connect \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"site":"escarlet","userToken":"<metricool-token>","userId":"<metricool-user-id>","blogId":"<metricool-blog-id>","timezone":"Europe/Madrid","capabilities":["instagram","linkedin","x","blog"]}'
curl -X POST https://blog-cms.escarlet.cc/api/v2/integrations/metricool/test \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"site":"escarlet"}'
```

El token se cifra con `CMS_SECRET_KEY` y no se guarda en la imagen. Las URLs de
media que se envíen a Metricool deben ser públicas y permanentes. El worker crea
el outbox al aprobar y sincroniza estados periódicamente; revisa los logs
`[entrypoint] iniciando worker` y los estados en `/api/v2/usage`/batch.

Documentación de referencia: [scheduler de Metricool](https://help.metricool.com/wli-scheduler-endpoint-example-on-a-custom-backend-proxy-frko7) y [autenticación/media](https://help.metricool.com/common-questions-and-errors-when-using-the-api-8x9nq).

Webhook por site. Configúralo en dashboard → **Sitio** (recomendado). Opcional fallback env `REBUILD_WEBHOOK_URL`.

`CMS_PUBLIC_URL` en producción tiene que ser `https://blog-cms.escarlet.cc`. Si queda vacío o en `localhost`, el MCP igual devolverá links absolutos con fallback a `https://blog-cms.escarlet.cc` (preview y media) para que Hermes pueda pegar un enlace clicable.

### Dominio

`blog-cms.escarlet.cc` — uso interno del equipo. No enlazar desde escarlet.design.

---

## 2. escarlet002 en Coolify

Variables **nuevas** en la app de escarlet.design:

```
BLOG_CMS_URL=https://blog-cms.escarlet.cc
BLOG_CMS_SITE=escarlet
```

Redeploy. El build ejecutará `escarlet-blog.mjs`, bajará el runtime del CMS y sincronizará los posts publicados.

---

## 3. MCP en Cursor (Hermes)

El MCP corre **dentro del CMS**. Hermes no clona el repo. Solo apunta a la URL.

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

Local. `http://localhost:3040/mcp` con el mismo `ADMIN_TOKEN`.

Reinicia el servidor MCP en Cursor. Prueba `blog_list_posts` con site `escarlet`.

### ChatGPT (Developer Mode)

ChatGPT solo ofrece OAuth (o sin autenticación). El CMS incluye un OAuth 2.1 mínimo en el mismo host.

1. En ChatGPT. Settings → Connectors → Create
2. URL. `https://blog-cms.escarlet.cc/mcp`
3. Autenticación. **OAuth**
4. Nombre. `escarlet-blog` (o el del cliente)
5. Al conectar, ChatGPT abre la pantalla del CMS. Pega el **token de sitio** (dashboard → Sitio → Generar token) o el `ADMIN_TOKEN` y autoriza una vez.
6. Icono. Descarga el PNG del favicon (<10 KB) que muestra el panel al generar el token. Ruta pública típica. `https://blog-cms.escarlet.cc/media/{handle}/agent-icon.png`

Cursor y Hermes siguen con Bearer directo. No hace falta migrarlos a OAuth.

### Claude

Claude también puede usar el mismo endpoint OAuth del CMS.

1. En Claude. `Customize → Connectors → Add custom connector`
2. URL. `https://blog-cms.escarlet.cc/mcp`
3. Autenticación. **OAuth**
4. Nombre. `escarlet-blog` (o el del cliente)
5. Al conectar, Claude abre la pantalla del CMS. Pega el **token de sitio** o el `ADMIN_TOKEN` y autoriza una vez.
6. Si quieres un icono, usa el mismo PNG del favicon que genera el panel.

ChatGPT y Claude comparten el mismo OAuth del CMS. Cursor y Hermes siguen con Bearer directo.

---

## 4. Webhook rebuild + activar sync — paso a paso

Objetivo. Cuando publicas en el CMS, escarlet.design se reconstruye solo con los posts nuevos.

### A. Webhook de escarlet002 en Coolify

1. Entra en Coolify
2. Abre la app **escarlet002** (escarlet.design)
3. Busca **Webhooks** o **Deploy Webhook**
4. Copia la URL. Suele ser algo como  
   `https://coolify.tudominio.com/api/v1/deploy?uuid=...`

   No pegues `force=false`. En Coolify 4.1 ese string se interpreta como true. El CMS limpia eso al guardar. Al publicar o al interruptor, el CMS llama con `force=true` a propósito. Así Docker no recicla un dist viejo.

### B. Pégala en el CMS (dashboard)

1. Abre `https://blog-cms.escarlet.cc/app` (o local)
2. Tab **Sitio**
3. Campo **Deploy webhook** → pega la URL
4. Campo **Token API Coolify** → pega el token con permiso Deploy
5. **Probar webhook** para comprobar que Coolify responde OK
6. Guardar sitio

La config se guarda en el volumen `/app/data/site-config/` (persiste entre redeploys).

Fallback opcional por env en la app CMS. `REBUILD_WEBHOOK_URL` y `COOLIFY_API_TOKEN`.

### C. Variables en escarlet002

En la app escarlet002:

```
BLOG_CMS_URL=https://blog-cms.escarlet.cc
BLOG_CMS_SITE=escarlet
```

Redeploy de escarlet002.

### D. Comprueba el flujo

1. Publica un post en el CMS (dashboard `/app` o MCP `blog_publish`)
2. El CMS hace `POST` al webhook
3. Coolify reconstruye escarlet002
4. En build, `escarlet-blog.mjs` baja el runtime del CMS y descarga posts
5. El post aparece en `https://escarlet.design/blog/{slug}`

### E. Si el webhook falla

Puedes redeploy manual de escarlet002 en Coolify. El sync corre en cada build igualmente.

---

## Migración inicial de posts

```bash
cd escarlet002 && npm run blog:export
cd ../escarlet-blog-cms && npm run import:escarlet
```

Si el CMS corre en Docker y el import es local, el `db.json` importado está en `./data/` local. Para producción:

- Importa antes del deploy y sube volumen, o
- Ejecuta import contra el volumen montado, o
- Usa el dashboard admin en producción

---

## Backup

El volumen `/app/data` contiene todo lo crítico. Backup periódico de Coolify o copia de `db.json` + `media/`.
