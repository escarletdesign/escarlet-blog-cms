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
- **Token de sitio**. En dashboard → Sitio → Token de acceso del cliente → Generar. Ese token solo gestiona ese handle (dashboard + MCP).

Los clientes reciben su token. Tú te quedas con el `ADMIN_TOKEN`.

## A. Site nuevo en el CMS (5 min)

Desde el dashboard. `https://blog-cms.escarlet.cc/admin` → **Sitio** → **Nuevo sitio**.  
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

Luego completa el brand kit en `/admin` → Brand kit (o `blog_update_brand_file`).

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
7. **Interruptor**. CMS `/admin` → Sitio → Blog en la web pública. Encendido publica `/blog`. Apagado lo quita en el siguiente rebuild. Los posts siguen en el CMS.

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
4. CMS `/admin` → tab **Sitio** → Deploy webhook + Token → **Probar webhook** → Guardar

Prioridad al publicar.

1. `rebuildWebhookUrl` del site (dashboard / `blog_create_site`)
2. Env global `REBUILD_WEBHOOK_URL` (fallback)

Si el webhook falla, puedes redeploy manual del frontend. El sync corre igual en cada build.

Detalle de volumen del CMS y variables. [DEPLOY.md](./DEPLOY.md).

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

ChatGPT. Connectors → Create → URL `https://blog-cms.escarlet.cc/mcp` → OAuth. Al autorizar pega el token de sitio (dashboard → Sitio → Generar token) o `ADMIN_TOKEN`. El panel también ofrece el PNG del favicon (<10 KB) en `/media/{handle}/agent-icon.png`.

Claude. Customize → Connectors → Add custom connector → URL `https://blog-cms.escarlet.cc/mcp` → OAuth. Al autorizar pega el token de sitio o `ADMIN_TOKEN`. Puede usar el mismo icono PNG.

2. Copia `templates/frontend/blog-via-mcp.mdc` al proyecto web y cambia `{{handle}}`
3. Skill del repo. `.cursor/skills/escarlet-blog-cms/SKILL.md`
4. Tool de ayuda. `blog_get_onboarding` explica setup + Coolify + flujo de posts

### Flujo de contenido

| Acción | Tools |
|--------|-------|
| Crear | `blog_get_brand_context` → `blog_create_draft` → `blog_update_post` → `blog_validate_seo` → `blog_publish` |
| Programar | Igual + `blog_schedule_post` / `blog_publish` con `publishAt` (YYYY-MM-DD). Super-admin confirma con `blog_confirm_schedule` si el sitio lo pide |
| Calendario | Dashboard → Calendario, o `blog_list_calendar` |
| Editar | `blog_get_post` + `blog_update_post` (mismo slug) |
| Setup site | `blog_get_onboarding` / `blog_create_site` |

**Token de cliente.** Solo toca `AGENT.md`, `keywords.md` e imágenes de referencia. La voz de marca y el image-spec quedan ocultos (super-admin).

**Sitio.** Interruptor «Confirmar publicaciones programadas» (default on). Con él, un post programado espera tu OK antes de entrar en cola.

Prohibido. Commitear posts al git del frontend. Usar `create_draft` para editar.

### Cómo se edita (no lo mezcles)

| Qué | Dónde |
|-----|--------|
| Texto, portada, metas, `socialPack` | MCP o dashboard del CMS |
| Look de `/blog` y la ficha | La landing. SPA en `src/`. HTML estático en `generate-blog-pages.mjs` + CSS |
| Encender o apagar `/blog` | CMS → Sitio → interruptor **Blog en la web pública** |

`bodyHtml` es el artículo. Sin nav ni layout de página. El preview del CMS es solo revisión.

---

## E. Checklist rápido

- [ ] `site:init` o `blog_create_site` con handle + domain
- [ ] Brand kit relleno + 2–4 referencias
- [ ] Sync en prebuild del frontend
- [ ] Env `BLOG_CMS_URL` + `BLOG_CMS_SITE` en Coolify
- [ ] Webhook + token en tab Sitio (probado)
- [ ] Interruptor Blog en la web pública encendido
- [ ] MCP + regla `blog-via-mcp.mdc` con el handle correcto
- [ ] Publicar post de prueba → rebuild → aparece en `/blog/{slug}`

---

## Referencias

- Deploy CMS + volumen. [DEPLOY.md](./DEPLOY.md)
- Contexto del proyecto. [HANDOFF.md](./HANDOFF.md)
- Plantillas. `templates/site/`, `templates/frontend/`
- Skill. `.cursor/skills/escarlet-blog-cms/SKILL.md`
