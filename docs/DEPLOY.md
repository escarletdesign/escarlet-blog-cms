# Deploy Escarlet Blog CMS

## Docker local (volumen automático)

El `docker-compose.yml` monta un volumen nombrado en `/app/data`. No hace falta crear carpetas a mano.

```bash
cp .env.example .env
# Edita ADMIN_TOKEN y REBUILD_WEBHOOK_URL

npm run docker:up
```

El volumen `escarlet_blog_cms_data` guarda `db.json` y `data/media/` entre reinicios.

Primera vez con DB vacía. Importa posts después:

```bash
npm run blog:export   # en escarlet002
npm run import:escarlet
# O copia tu db.json al volumen si ya lo tienes local
```

---

## 1. CMS en Coolify

### Build

- Tipo. **Dockerfile** (raíz del repo)
- Puerto expuesto. `3040`
- Health check. `GET /api/health`

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

Si montaste el volumen en otra ruta:

```
CMS_DATA_DIR=/ruta/del/volumen
```

El entrypoint crea `media/`, `brand/` y `site-config/`. Si el volumen está vacío, copia `data-seed/db.json` como base.

No copies `data/db.json` dentro de la imagen. Eso va en el volumen.

Si el volumen se montó **después** de subir medios, esos archivos se perdieron. Vuelve a subirlos. Una imagen de pocos bytes también se ve rota. El CMS rechaza subidas incompletas.

### Variables de entorno (CMS)

```
PORT=3040
ADMIN_TOKEN=<genera-un-secreto-largo>
DEFAULT_SITE=escarlet
CMS_PUBLIC_URL=https://blog-cms.escarlet.cc
```

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

1. Abre `https://blog-cms.escarlet.cc/admin` (o local)
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

1. Publica un post en el CMS (dashboard `/admin` o MCP `blog_publish`)
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
