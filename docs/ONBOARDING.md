# Onboarding — añadir blog a un proyecto

Guía personal para crear un site nuevo o enchufar el blog a una landing ya existente.
Un solo CMS (`blog-cms.escarlet.cc`). Cada web es un **handle** con su brand kit y su webhook.

## Idea en 30 segundos

```
Agente (MCP) → CMS (posts + media)
                    ↓ publish
              Deploy Webhook Coolify (frontend)
                    ↓
         Build → escarlet-blog.mjs (runtime CMS) → /blog en tu dominio
```

Los posts **no van a git** del frontend. El sync los baja en cada build.

---

## Agente global (Cursor)

Skill personal. `~/.cursor/skills/escarlet-blog-integrate/`

Desde **cualquier** landing puedes pedir. «integra el blog CMS» o «explica qué tengo que hacer en Coolify».
El agente separa pasos tuyos (webhook, tokens) de lo que hace él (sync, rutas, reglas).

---

## Acceso por sitio (tokens)

- **Admin global** (`ADMIN_TOKEN`). Ve todos los sitios, crea handles, webhooks y tokens de cliente.
- **Token de sitio**. En `/app/admin` → Sitio → Token de acceso del cliente → Generar. Ese token solo gestiona ese handle (app + MCP).

Los clientes reciben su token. Tú te quedas con el `ADMIN_TOKEN`.

## A. Site nuevo en el CMS (5 min)

Desde la app. `https://blog-cms.escarlet.cc/app/admin` → **Sitio** → **Nuevo sitio**.
Asistente en 3 pasos (datos, Coolify, crear) con ayuda de dónde sacar webhook y token.

También por CLI o MCP.

```bash
npm run site:init -- \
  --handle mares24 \
  --name "Mares 24" \
  --domain https://mares24.com
```

Opciones útiles.

```bash
# Ya tienes el webhook de Coolify
npm run site:init -- --handle umbral --domain https://umbral.es \
  --webhook "https://coolify.escarlet.cc/api/v1/deploy?uuid=..." \
  --token "TU_COOLIFY_TOKEN"

# Copia plantillas al frontend
npm run site:init -- --handle demo --domain https://demo.escarlet.cc \
  --copy-frontend ../mi-landing/scripts
```

También puedes hacerlo por MCP (Hermes / Cursor con el CMS conectado).

```
blog_create_site  { handle, name, domain, rebuildWebhookUrl? }
blog_get_onboarding { site: "mares24" }
```

Luego completa el brand kit en `/app/admin` → Brand kit (o `blog_update_brand_file`).

---

## B. Frontend (Vue/Vite u otro)

1. Copia `templates/frontend/escarlet-blog.mjs` → `scripts/escarlet-blog.mjs` y los wrappers de sync/packs
2. Copia `blog-articles.fallback.js` y `blog-articles.js` a `src/data/` (o adapta rutas)
3. En `package.json`:

```json
"prebuild": "node scripts/escarlet-blog.mjs",
"predev": "node scripts/escarlet-blog.mjs",
"build": "node scripts/escarlet-blog.mjs && vite build"
```

4. `.gitignore` → `src/data/blog.generated.js` y `.escarlet-blog-runtime/`
5. Monta rutas `/blog` y `/blog/:slug` leyendo `getBlogIndex` / `getPostBySlug` (como en escarlet002)
6. **Blog-packs**. El runtime los genera en `public/admin/blog-packs/` al hacer build. Env `BLOG_SITE_URL` / `BLOG_PACKS_NAME`. Canales del pack se configuran en el CMS (`socialPackChannels`). El look de `/blog` sigue en esta landing.
7. **Interruptor**. CMS `/app/admin` → Sitio → Blog en la web pública. Encendido publica `/blog`. Apagado lo quita en el siguiente rebuild. Los posts siguen en el CMS.

### Env en Coolify (app del frontend)

```
BLOG_CMS_URL=https://blog-cms.escarlet.cc
BLOG_CMS_SITE=mares24
BLOG_SITE_URL=https://mares24.com
```

Local.

```
BLOG_CMS_URL=http://localhost:3040 BLOG_CMS_SITE=mares24 npm run dev
```

---

## C. Webhook Coolify (el paso que suele faltar)

Son **dos caminos** al mismo sitio.

| Trigger | Cuándo | Qué cambia |
|---------|--------|------------|
| Git push | Código Vue/CSS/scripts | App (con caché) |
| Deploy webhook | Publicar post o interruptor del blog | Contenido. Sin caché de capas |

### Pasos

1. Coolify → app del **frontend** (producción del cliente)
2. Webhooks → **Deploy Webhook (auth required)** → copia URL  
   Ejemplo. `https://coolify.escarlet.cc/api/v1/deploy?uuid=...`
3. Copia un API token Coolify con permiso Deploy
4. CMS `/app/admin` → tab **Sitio** → Deploy webhook + Token → **Probar webhook** → Guardar

Prioridad al publicar.

1. `rebuildWebhookUrl` del site (dashboard / `blog_create_site`)
2. Env global `REBUILD_WEBHOOK_URL` (fallback)

Si el webhook falla, puedes redeploy manual del frontend. El sync corre igual en cada build.

Detalle de volumen del CMS y variables. [DEPLOY.md](./DEPLOY.md).

---

## C2. WordPress (frontend alternativo)

Mismo CMS. En lugar de Coolify + `escarlet-blog.mjs`, el sitio público es WordPress.

Plugin principal. [`../integrations/wordpress-blog-client`](../integrations/wordpress-blog-client) sincroniza posts e imágenes como contenido nativo Gutenberg. El cliente histórico está en `_plugins/escarlet-blog-client`. Para editar páginas Elementor con REST/MCP usa el bridge opcional en [`../integrations/wordpress`](../integrations/wordpress).

### Qué hace el plugin

| Pieza | Comportamiento |
|-------|----------------|
| Sync | `GET /api/sites/{handle}/posts` → entradas nativas en `/blog` |
| Webhook | `GET/POST /wp-json/escarlet-blog/v1/sync` con Bearer. Pégalo en CMS → Sitio como webhook |
| Panel | wp-admin → Escarlet Blog → Abrir panel Escarlet (SSO con token de sitio) |
| Packs | Se usan en el CMS Escarlet. WordPress **no** genera `/admin/blog-packs` HTML como Vite |

### Pasos

1. Activa el plugin en WordPress.
2. Escarlet Blog → Ajustes. `BLOG_CMS_URL`, handle, token de sitio (CMS → Sitio → Generar).
3. Copia URL de webhook + secreto Bearer al CMS → Sitio. Probar webhook.
4. Publica un post en el CMS → sync → `https://dominio/blog/{slug}`.
5. Packs y edición. botón Abrir panel Escarlet (o la fila «Abrir pack en CMS»).

SSO. El plugin llama `POST /api/embed/session` y redirige a `/api/embed/consume?code=…` (enlace de un solo uso, 5 min).

---

## D. Agentes (Cursor / Hermes / ChatGPT / Claude)

1. MCP apuntando al CMS (mismo para todos los sites):

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

ChatGPT. Connectors → Create → URL `https://blog-cms.escarlet.cc/mcp` → OAuth. Es el mismo conector para todos los roles. Al autorizar pega el token de usuario (`user_...`), sesión (`sess_...`), agencia, sitio (`/app/admin` → Sitio → Generar token) o `ADMIN_TOKEN`. El MCP conserva rol, usuario y sitios asignados; no concede acceso adicional. El panel también ofrece el PNG del favicon (<10 KB) en `/media/{handle}/agent-icon.png`.

Claude. Customize → Connectors → Add custom connector → URL `https://blog-cms.escarlet.cc/mcp` → OAuth. Usa los mismos tokens y el mismo alcance por rol. Puede usar el mismo icono PNG.

2. Copia `templates/frontend/blog-via-mcp.mdc` al proyecto web y cambia `{{handle}}`
3. Skill del repo. `.cursor/skills/escarlet-blog-cms/SKILL.md`
4. Tool de ayuda. `blog_get_onboarding` explica setup + Coolify + flujo de posts

### Flujo de contenido

| Acción | Tools |
|--------|-------|
| Crear fácil | `blog_get_workflow` → ChatGPT genera textos e imágenes → `blog_create_draft` + `blog_upload_media` + `blog_update_post` → confirmación → `blog_publish (direct: true)` |
| Crear guiado | `blog_get_workflow` → ChatGPT genera → guardar borrador → revisar `/app/preview/{slug}` → `blog_update_post` → `blog_publish (direct: true)` |
| Social Pack | ChatGPT genera copies e imágenes → `blog_save_social_pack` (nunca genera IA en el CMS) |
| Programar | Igual + `blog_schedule_post` / `blog_publish` con `direct: true` y `publishAt` (YYYY-MM-DD) |
| Calendario | App → Posts → Programados, o `blog_list_calendar` |
| Editar | `blog_get_post` + `blog_update_post` (mismo slug) |
| Setup site | `blog_get_onboarding` / `blog_create_site` |

**Token de cliente.** El token estándar solo toca `AGENT.md`, `keywords.md` e imágenes de referencia. El rol `client_mcp` puede leer el brandkit completo en modo solo lectura; ningún token MCP puede usar la IA del CMS.

**Sitio.** Interruptor «Confirmar publicaciones programadas» (default on). Con él, un post programado espera tu OK antes de entrar en cola.

Prohibido. Commitear posts al git del frontend. Usar `create_draft` para editar.

### Cómo se edita (no lo mezcles)

| Qué | Dónde |
|-----|--------|
| Texto, portada, metas, `socialPack` | MCP o `/app` del CMS |
| Look de `/blog` y la ficha | La landing. SPA en `src/`. HTML estático en `generate-blog-pages.mjs` + CSS |
| Encender o apagar `/blog` | CMS → Sitio → interruptor **Blog en la web pública** |

`bodyHtml` es el artículo. Sin nav ni layout de página. El preview del CMS es solo revisión.

---

## E. Checklist rápido

- [ ] `site:init` o `blog_create_site` con handle + domain
- [ ] Brand kit relleno + 2–4 referencias
- [ ] Frontend Vite. sync en prebuild + env Coolify **o** WordPress. plugin + webhook de sync
- [ ] Webhook + token en tab Sitio (probado)
- [ ] Interruptor Blog en la web pública encendido
- [ ] MCP `/mcp` + regla `blog-via-mcp.mdc` con el handle correcto (landings Vite)
- [ ] Publicar post de prueba → rebuild/sync → aparece en `/blog/{slug}`
- [ ] Vite. pack en `/admin/blog-packs/{slug}` **o** WordPress. pack abierto desde el CMS

---

## Referencias

- Deploy CMS + volumen. [DEPLOY.md](./DEPLOY.md)
- Contexto del proyecto. [HANDOFF.md](./HANDOFF.md)
- Plantillas. `templates/site/`, `templates/frontend/`
- Skill. `.cursor/skills/escarlet-blog-cms/SKILL.md`
