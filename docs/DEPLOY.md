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

En Coolify → tu app CMS → **Persistent Storage** (o Storages):

| Campo | Valor |
|-------|-------|
| Name | `cms-data` |
| Mount path | `/app/data` |
| Size | 1 GB o más |

Coolify crea el volumen solo. El entrypoint (`scripts/docker-entrypoint.mjs`) crea `data/media/` si no existe. Si el volumen está vacío, copia `data-seed/db.json` como base.

No copies `data/db.json` dentro de la imagen. Eso va en el volumen.

### Variables de entorno (CMS)

```
PORT=3040
ADMIN_TOKEN=<genera-un-secreto-largo>
DEFAULT_SITE=escarlet
CMS_PUBLIC_URL=https://blog-cms.escarlet.cc
```

Webhook por site. Configúralo en dashboard → **Sitio** (recomendado). Opcional fallback env `REBUILD_WEBHOOK_URL`.

### Dominio

`blog-cms.escarlet.cc` — uso interno del equipo. No enlazar desde escarlet.design.

---

## 2. escarlet002 en Coolify

Variables **nuevas** en la app de escarlet.design:

```
BLOG_CMS_URL=https://blog-cms.escarlet.cc
BLOG_CMS_SITE=escarlet
```

Redeploy. El build ejecutará `sync-blog-cms.mjs` y bajará los posts publicados del CMS.

---

## 3. MCP en Cursor (Hermes) — paso a paso

Hermes usa el MCP en **tu Mac**, no dentro del contenedor. El MCP llama a la API HTTP del CMS.

### A. Genera un token

Usa el mismo valor que `ADMIN_TOKEN` del CMS (local o producción).

### B. Abre la config MCP de Cursor

**Opción 1 — UI**

1. Cursor → **Settings** → **MCP**
2. **Add new MCP server** o edita el JSON

**Opción 2 — archivo**

Abre `~/.cursor/mcp.json` en un editor.

Si el archivo no existe, créalo con `{}` y dentro la clave `mcpServers`.

### C. Añade el servidor

Copia desde [`docs/mcp.json.example`](mcp.json.example) y ajusta rutas y token:

```json
{
  "mcpServers": {
    "escarlet-blog": {
      "command": "node",
      "args": [
        "/Users/carlosbrugiafredo/Documents/Escarlet/_Landigs/escarlet-blog-cms/mcp/index.mjs"
      ],
      "env": {
        "CMS_URL": "http://localhost:3040",
        "CMS_ADMIN_TOKEN": "tu-mismo-ADMIN_TOKEN",
        "DEFAULT_SITE": "escarlet"
      }
    }
  }
}
```

### D. Elige la URL del CMS

| Dónde trabajas | CMS_URL |
|----------------|---------|
| CMS en local (`npm run dev` o `docker:up`) | `http://localhost:3040` |
| CMS ya desplegado en Coolify | `https://blog-cms.escarlet.cc` |

El MCP **no** arranca el CMS. El CMS tiene que estar online cuando Hermes escriba posts.

### E. Reinicia MCP en Cursor

Settings → MCP → reinicia el servidor `escarlet-blog` o reinicia Cursor.

### F. Prueba en chat

Pide al agente que use `blog_list_posts` con site `escarlet`. Debería listar posts.

---

## 4. Webhook rebuild + activar sync — paso a paso

Objetivo. Cuando publicas en el CMS, escarlet.design se reconstruye solo con los posts nuevos.

### A. Webhook de escarlet002 en Coolify

1. Entra en Coolify
2. Abre la app **escarlet002** (escarlet.design)
3. Busca **Webhooks** o **Deploy Webhook**
4. Copia la URL. Suele ser algo como  
   `https://coolify.tudominio.com/api/v1/deploy?uuid=...&force=false`

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
4. En build, `sync-blog-cms.mjs` descarga posts del CMS
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
