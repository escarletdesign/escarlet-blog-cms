# Usabilidad e integración post product-restructure

Nota de continuidad (sep 2026). El change `product-restructure` (F0–F5) está en `develop`. Flag: `PRODUCT_RESTRUCTURE_V1`.

## ¿Es usable ya?

**Sí, como CMS operativo**, con matices.

| Capacidad | Usable hoy | Notas |
|-----------|------------|--------|
| Crear / editar / publicar posts (admin + MCP) | Sí | Sin flag también funciona el flujo legacy |
| Review agency / motivo de rechazo / magic + review links | Sí | Requiere `PRODUCT_RESTRUCTURE_V1=1` |
| Roles agency vs client en el mismo admin | Sí | Token de sitio = client; agency token = agency_admin |
| Social Pack en el CMS | Sí | Canónico en CMS. La PWA Vite en la landing es legado |
| Cupos de plan + suspend | Sí | Planes en `db.json`; gate en MCP y REST |
| Stripe Payment Links + webhook | Código listo | Hace falta secretos + links en Stripe (ops) |
| Email / password | Sí | Register por agency; login en admin. Google diferido |
| SEO público | Sin regresión | HTML SEO sigue en la landing; sync aditivo |

**No es un SaaS self-serve cerrado.** El alta de brand kit y Payment Links sigue siendo ops (Carlos). Activar en Coolify el flag y, si cobras, Stripe.

---

## Sitios custom Escarlet (Vite / SPA)

### ¿Hay que actualizarlos?

| Situación | ¿Actualizar? |
|-----------|----------------|
| Solo quieren seguir publicando blog como hasta ahora | **No urgente.** Sync + webhook Coolify siguen valiendo |
| Quieren Social Pack “producto” (UI CMS, no PWA vieja en dominio cliente) | **Sí, ligero.** Dejar de depender del generador Vite de packs; apuntar al CMS |
| Quieren review / cupos / login cliente | **Solo CMS + flag.** La landing no implementa eso |
| Runtime desactualizado (`escarlet-blog.mjs` viejo) | **Recomendado.** En el próximo deploy el hook baja `/runtime/v1/` (ahora sync-only, v1.2.0) |

### Modelo (sin cambios de filosofía)

```
MCP / Admin CMS  →  posts + socialPack + brand
                      ↓ publish
              webhook Coolify (landing)
                      ↓ build
         escarlet-blog.mjs → sync-blog-cms.mjs → blog.generated.js
                      ↓
              /blog y /blog/:slug (look en la landing)
```

### Checklist mínimo al tocar una landing existente

1. Env Coolify: `BLOG_CMS_URL`, `BLOG_CMS_SITE` (handle).
2. `scripts/escarlet-blog.mjs` presente y en `prebuild` / `build`.
3. Tras rebuild, comprobar que el runtime bajado es **v1.2.0** (solo `sync-blog-cms.mjs` en el canal).
4. Packs: preferir **CMS** (`/admin` Social Pack o rutas pack del CMS). Si aún existe `public/admin/blog-packs/` generado en build, es legado; no hace falta borrarlo el día 1.
5. Look de `/blog`: sigue en esa landing (vistas Vue o `generate-blog-pages.mjs` + CSS). El CMS no pinta la ficha pública.

Skill de integración: `~/.cursor/skills/escarlet-blog-integrate/SKILL.md` (o `escarlet-blog-integrate`).

---

## Plugin WordPress

Código: `Documents/Escarlet/_plugins/escarlet-blog-client` (fuera del repo CMS). Documentado en [ONBOARDING.md](./ONBOARDING.md) sección C2.

### Qué hace hoy

| Pieza | Comportamiento |
|-------|----------------|
| Sync | API pública del CMS → posts nativos WP (`/blog`) |
| Webhook | ` /wp-json/escarlet-blog/v1/sync` → pegar en CMS → Sitio |
| SSO | `POST /api/embed/session` → panel CMS (token de sitio) |
| Packs | **No** genera PWA en WP. Packs se abren en el CMS |

### Cómo se integra un WP cliente

1. Instalar / activar `escarlet-blog-client`.
2. Ajustes: URL del CMS, handle, token de sitio.
3. Copiar webhook + bearer al CMS → Sitio.
4. Publicar en CMS → sync → ver en `https://dominio/blog/{slug}`.
5. Packs / brand / review: botón “Abrir panel Escarlet” (SSO).

### ¿Hay que actualizar el plugin por product-restructure?

| Cambio V1 | ¿Toca el plugin? |
|-----------|------------------|
| Review / cupos / membership | **No** (viven en CMS; MCP/admin) |
| Social Pack host en CMS | **No obligatorio** (ya no dependía del generador Vite) |
| Email/password humanos | **No** (login en CMS; SSO embed sigue con token) |
| Stripe | **No** |
| Sync de posts | Solo si cambia el contrato JSON público (hoy es **aditivo**; no breaking) |

Actualizar el plugin cuando haya bugfixes o quieras UX WP (p. ej. mostrar “cupo agotado” dentro de wp-admin). Eso sería un slice futuro, no bloqueante.

---

## Cómo funciona el sync de Escarlet (escarlet.design)

Hay **dos interruptores distintos**. No los mezcles.

### 1) Sync de contenido (landing ← CMS)

En cada **build** de escarlet002 (Coolify o local):

1. `npm run build` / `blog:sync` ejecuta `scripts/escarlet-blog.mjs`
2. Ese hook baja el runtime desde  
   `https://blog-cms.escarlet.cc/runtime/v1/manifest.json`
3. Ejecuta `sync-blog-cms.mjs`, que pide  
   `GET /api/sites/escarlet/posts`
4. Escribe `src/data/blog.generated.js` (mezcla CMS + fallback local)
5. Vite monta `/blog` con esos datos

**Env en la app Coolify de escarlet002:**

```
BLOG_CMS_URL=https://blog-cms.escarlet.cc
BLOG_CMS_SITE=escarlet
```

Sin esas variables el sync cae a fallback local (posts viejos del repo).

**Activar sync = tener esas env + un redeploy.** No hay botón “sync on” aparte en Coolify.

Local:

```bash
cd escarlet002
BLOG_CMS_URL=https://blog-cms.escarlet.cc BLOG_CMS_SITE=escarlet npm run blog:sync
```

### 2) Rebuild automático al publicar (CMS → Coolify)

Cuando publicas en el CMS, el CMS llama al **Deploy webhook** de escarlet002 para que Coolify reconstruya la web y vuelva a correr el sync.

**Activar rebuild al publicar:**

1. Coolify → app **escarlet002** → copiar Deploy Webhook  
2. CMS admin → **Sitio** (handle `escarlet`) → pegar webhook + token API Coolify  
3. Probar webhook → Guardar  
4. Publicar un post → debe disparar rebuild → el post sale en `https://escarlet.design/blog/{slug}`

Detalle paso a paso: [DEPLOY.md](./DEPLOY.md) sección 4.

### 3) Interruptor “Blog en la web pública”

En CMS → Sitio → **Blog en la web pública** (`blogEnabled`).

- Encendido: el sync entrega posts y la landing muestra `/blog`
- Apagado: el sync puede devolver lista vacía / flag off (la ruta pública se apaga en el siguiente rebuild)

Eso **no** borra posts del CMS.

```
Publicar en CMS ──webhook──► Coolify rebuild escarlet002
                                  │
                                  ▼
                         escarlet-blog.mjs
                                  │
                    runtime/v1 + sync-blog-cms.mjs
                                  │
                                  ▼
                         blog.generated.js → /blog
```

---

## Smoke checklist (hecho / pendiente)

### Escarlet002 (Vite) — sep 2026

| Paso | Resultado |
|------|-----------|
| CMS health `blog-cms.escarlet.cc` | OK (persistencia, posts en volumen) |
| `GET /api/sites/escarlet/posts` | OK (`blogEnabled: true`, posts publicados) |
| Sync local `npm run blog:sync` | OK → `blog.generated.js` (CMS + fallback) |
| Runtime en **producción** | Aún **v1.1.1** (incluye generador packs Vite) |
| Runtime en **develop** local | **v1.2.0** (solo sync; packs en CMS) |
| Deploy `develop` + `PRODUCT_RESTRUCTURE_V1=1` a Coolify CMS | **Pendiente (humano)** |
| Publicar post → webhook → ver en escarlet.design/blog | **Pendiente** (verificar webhook Sitio) |

Conclusión. El sync **ya funciona** con el CMS en producción. Las features V1 (review, cupos, packs CMS, auth) requieren **desplegar `develop`** al CMS y el flag.

### WordPress — checklist (cuando tengas un WP de prueba)

1. Activar `escarlet-blog-client`
2. Ajustes: CMS URL, handle, token de sitio
3. Pegar webhook sync en CMS → Sitio
4. Publicar en CMS → comprobar `/blog/{slug}` en WP
5. SSO “Abrir panel Escarlet”
6. Packs: abrir desde CMS (no PWA en WP)

---

## Orden práctico “después”

1. Coolify CMS: desplegar rama `develop` + `PRODUCT_RESTRUCTURE_V1=1` (+ Stripe si cobras).
2. Confirmar webhook de escarlet002 en CMS → Sitio → Probar.
3. Smoke publish → rebuild → `/blog` en escarlet.design.
4. Landings: en el próximo build ya bajarán runtime nuevo (cuando el CMS prod sirva 1.2.0).
5. WP de prueba con el checklist de arriba.

## Referencias

- Engram: `sdd/product-restructure/{proposal,spec,design,tasks,verify-report,archive-report}`
- [DEPLOY.md](./DEPLOY.md) — Coolify, Stripe, volúmenes, webhook paso a paso
- [ONBOARDING.md](./ONBOARDING.md) — Vite vs WordPress
- [HANDOFF.md](./HANDOFF.md) — estado del servicio

---

## Coolify y SEO (decisión sep 2026)

**Pregunta.** ¿Se puede quitar Coolify y que el SEO siga funcionando?

**Respuesta corta.** En landings Vite actuales, Coolify (o un redeploy equivalente) sigue haciendo falta para materializar el HTML SEO en el dominio público. El CMS es headless. Guarda contenido y valida SEO. El HTML indexable lo genera la landing en build.

| Camino | Coolify rebuild | SEO público |
|--------|-----------------|-------------|
| Landing Vite / SPA | Sí (webhook deploy) | Sí, tras rebuild |
| WordPress + plugin Escarlet | No (webhook = sync WP) | Sí, posts nativos SSR |
| Futuro SSR/edge en la landing | Webhook ligero o ninguno | Sí, si el HTML sale en la primera respuesta |

En este ciclo de UX del admin **no** se mueve el ownership del HTML SEO al CMS (freeze documentado). Mejoramos validación de handle/webhook en el onboarding. Para sitios nuevos sin Coolify, la vía operativa es WordPress.
