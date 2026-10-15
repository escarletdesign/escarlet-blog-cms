# Onboarding - añadir blog a un proyecto

Guía personal para crear un site nuevo o enchufar el blog a una landing ya existente.
Un solo CMS v3 (`cms.escarlet.design`). Cada web es un **handle** con su brand kit y su webhook.

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

## Acceso de usuario y membresías

- **Admin global** (`ADMIN_TOKEN`). Es un secreto de servidor para operaciones internas, no una credencial humana ni de MCP.
- **Token personal (PAT)**. En Ajustes del perfil genera un token revocable. El acceso a cada marca se deriva de tus membresías actuales.
- **OAuth**. ChatGPT y Claude autorizan al usuario y reciben el mismo alcance dinámico que su PAT.

Las invitaciones asignan una o varias marcas y un rol independiente por marca. Revocar una membresía corta el acceso sin reconectar el cliente.

## A. Site nuevo en el CMS (5 min)

Desde la app. `https://cms.escarlet.design/app/admin` → **Sitio** → **Nuevo sitio**.
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

También puedes descubrir capabilities y recetas por MCP v3 (Hermes / Cursor con Escarlet OS conectado).

```
capability.search { query: "brand reel publication" }
brand.context.get { site: "mares24" }
```

Para crear un Brand Kit desde un agente, usa `brand.version.create`, sube las
referencias con `asset.upload` y `kind: "reference"`, enlázalas con
`brand.asset.register`, valida con `brand.version.validate` y publica solo tras
confirmación humana mediante `brand.version.publish`. También puedes completar
el kit en `/app/admin` → Brand kit.

El onboarding crea `reference-library.json` en la versión activa. No publiques
una versión sin ese archivo, aunque el sitio ya tenga `referenceImages`: son
dos fuentes distintas y deben compartir el mismo `brandKitSnapshotHash`. MCP
v3 debe ejecutarse con `DATABASE_URL`; si falta, el runtime devuelve un error y
no usa un Brand Kit estático desactualizado.

### ZIP importable del Brand Kit

Si el kit se prepara fuera del CMS, entrega un `brand-kit.zip` con los archivos
canónicos en la raíz y las imágenes dentro de `assets/`. El ZIP debe incluir un
`reference-library.json` que declare cada imagen con `filename`, `role`,
`usage`, `alt` y `approved: true`. Para un storyboard visual usa
`usage: "style_board"`; para un logo usa `usage: "logo"`. El importador copia
esa clasificación a los metadatos de cada asset y evita tener que corregirlos
manualmente en la interfaz. Un ZIP que solo contiene imágenes no es portable.

---

## B. Frontend (Vue/Vite u otro)

1. Copia `templates/frontend/escarlet-blog.mjs` → `scripts/escarlet-blog.mjs` y el wrapper de sync
2. Copia `blog-articles.fallback.js` y `blog-articles.js` a `src/data/` (o adapta rutas)
3. En `package.json`:

```json
"prebuild": "node scripts/escarlet-blog.mjs",
"predev": "node scripts/escarlet-blog.mjs",
"build": "node scripts/escarlet-blog.mjs && vite build"
```

4. `.gitignore` → `src/data/blog.generated.js` y `.escarlet-blog-runtime/`
5. Monta rutas `/blog` y `/blog/:slug` leyendo `getBlogIndex` / `getPostBySlug` (como en escarlet002)
6. **Contenido**. La app sincroniza publicaciones aprobadas por canal. El agente usa
   `copy.validate`, una capability de producción y el Publisher. No se usan aliases MCP legacy.
7. **Interruptor**. CMS `/app/admin` → Sitio → Blog en la web pública. Encendido publica `/blog`. Apagado lo quita en el siguiente rebuild. Los posts siguen en el CMS.

### Env en Coolify (app del frontend)

```
BLOG_CMS_URL=https://cms.escarlet.design
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

1. `rebuildWebhookUrl` de la marca (dashboard v2)
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
| Panel | wp-admin → Escarlet Blog → Abrir panel Escarlet (SSO con PAT personal) |
| Packs | Se usan en el CMS Escarlet. WordPress **no** genera HTML estático de packs |

### Pasos

1. Activa el plugin en WordPress.
2. Escarlet Blog → Ajustes. `BLOG_CMS_URL`, handle y PAT personal generado en el perfil.
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
      "url": "https://cms.escarlet.design/mcp/v3",
      "headers": {
        "Authorization": "Bearer TU_PAT_PERSONAL_user_..."
      }
    }
  }
}
```

ChatGPT. Connectors → Create → URL `https://cms.escarlet.design/mcp/v3` → OAuth. Es el mismo conector para todos los roles. También puedes usar un PAT personal (`user_...`) en clientes que acepten Bearer. El MCP conserva rol, usuario y marcas asignadas; no concede acceso adicional. El panel también ofrece el PNG del favicon (<10 KB) en `/media/{handle}/agent-icon.png`.

Claude. Customize → Connectors → Add custom connector → URL `https://cms.escarlet.design/mcp/v3` → OAuth. Usa los mismos tokens y el mismo alcance por rol. Puede usar el mismo icono PNG.

2. Skill del repo para setup y frontend. `.cursor/skills/escarlet-blog-cms/SKILL.md`
3. Skill portable de contenido. `payload/escarlet-mcp-content/SKILL.md` se copia al cliente MCP, por ejemplo Hermes, Cursor o Claude
4. Si el proyecto usa reglas de Cursor para el frontend, copia `templates/frontend/blog-via-mcp.mdc` y cambia `{{handle}}`
5. Tool de ayuda. `capability.search` descubre primitives y recipes autorizadas

### Flujo de contenido

| Acción | Tools |
|--------|-------|
| Crear | `copy.validate` → capability de producción → resultado para revisión |
| Revisar | App → preview → aprobación humana |
| Programar | `publication.route` → `publication.schedule` con `publicationDate` y `timezone` |
| Cancelar | App o control plane antes de la publicación |
| Calendario | App → Calendario, o estado del Publisher |
| Detalle | `publication.status.get` devuelve estado interno y externo |
| Marcas | `capability.search` → elegir una marca → `brand.context.get` |

**Acceso MCP.** OAuth y los PAT personales comparten la identidad del usuario. El contexto normalizado de la marca incluye voz, keywords, paleta, tipografías, composición, arquetipos, templates y referencias aprobadas. Los archivos fuente privados no se solicitan ni se entregan al MCP.

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

### Registro y membresías

`POST /api/auth/register` permite el alta propia cuando no hay sesión. El usuario crea su workspace y su primera marca, recibe membresía `owner` y puede generar un PAT personal. Las invitaciones posteriores aceptan varias marcas y un rol independiente por marca mediante `brandIds` y `brandRoles`. Revocar la fila de `workspace_member_sites` corta el acceso de inmediato en la app y en MCP.

- [ ] `site:init` o alta de marca desde la app con handle + domain
- [ ] Brand kit relleno + 2–4 referencias
- [ ] `reference-library.json` presente y validado en el Brand Kit activo
- [ ] Frontend Vite. sync en prebuild + env Coolify **o** WordPress. plugin + webhook de sync
- [ ] Webhook + secreto del proveedor en tab Sitio (probado)
- [ ] Interruptor Blog en la web pública encendido
- [ ] MCP `/mcp/v3` + descubrimiento de capabilities y selección explícita de marca
- [ ] Ejecutar una receta de prueba, revisar el artefacto y aprobarlo desde la app

---

## Referencias

- Deploy CMS + volumen. [DEPLOY.md](./DEPLOY.md)
- Contexto del proyecto. [HANDOFF.md](./HANDOFF.md)
- Plantillas. `templates/site/`, `templates/frontend/`
- Skill. `.cursor/skills/escarlet-blog-cms/SKILL.md`
