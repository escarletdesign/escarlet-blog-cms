---
name: escarlet-blog-cms
description: >-
  Onboarding multi-sitio del CMS headless Escarlet. Usa cuando hay que crear un
  site nuevo, añadir sección blog a una landing, configurar sync/Coolify webhook,
  preparar un brand kit compatible o explicar a un agente el flujo MCP de crear/editar posts.
---

# Skill Escarlet Blog CMS (multi-sitio)

CMS **central** white-label. Un servicio. Muchos handles (`escarlet`, `mares24`, …).
Los posts viven en el CMS. El frontend solo hace pull en build.

**Headless.** El CMS guarda datos (`bodyHtml`, portada, metas). El look de `/blog/{slug}` lo pinta la landing. Para cambiar diseño de ficha usa la skill global `escarlet-blog-integrate` (sección Headless) y el generador/vista de esa landing.

## Cuándo usar

- Instalar blog en un proyecto nuevo o existente
- Construir/importar el brand kit de un site desde otra landing
- Configurar Deploy webhook de Coolify
- Crear/editar posts vía MCP sin tocar git del frontend
- Dudas de Hermes sobre el flujo

## Primera acción del agente

1. Si el humano pide **setup / instalar / otro sitio** desde **cualquier** workspace → skill global `escarlet-blog-integrate` (`~/.cursor/skills/escarlet-blog-integrate/`)
2. Si pide construir el brand kit → skill global `escarlet-cms-brandkit` (`~/.cursor/skills/escarlet-cms-brandkit/`)
3. En este repo o con MCP. `workspace.context.get` para resolver el Espacio y la Marca
4. Si pide **escribir o editar un post** → `brand.context.get` con el `site` correcto
5. Leer también `docs/ONBOARDING.md` si trabajas en el workspace del CMS
6. UI de la app. patrones en `apps/pwa/src/styles.css` y componentes de `apps/pwa/src/App.tsx`

## Alta rápida de un site

### CLI (en escarlet-blog-cms)

```bash
npm run site:init -- --handle CLIENT --name "Nombre" --domain https://dominio.com
# opcional. --webhook URL --token COOLIFY_TOKEN --copy-frontend ../landing/scripts
```

### MCP v3

La creación del site se hace desde la app o con `npm run site:init`; MCP v3 no
expone una capability pública para dar de alta sites. Después resuelve el
contexto con `workspace.context.get` y usa la skill `escarlet-cms-brandkit`.
Con MCP v3 el flujo es `brand.version.create` → `asset.upload` con
`kind=reference` → `brand.asset.register` → `brand.version.validate` →
`brand.version.publish`.
Antes de crear contenido, compara el `brandKitSnapshotHash` de
`brand.context.get` con `brand.generation.prepare`. Si falta
`reference-library.json` o la preparación queda bloqueada, corrige el
onboarding y no generes ni subas assets publicables. El proceso MCP necesita
`DATABASE_URL`; no debe caer a un Brand Kit estático cuando hay un usuario
autenticado y un scope de workspace/marca.

En cada Brand Kit publicado, `reference-library.json` y las filas aprobadas de
`brand_assets` deben estar sincronizadas por nombre y por archivo. Si el
manifest declara rutas sin `default`, el backend puede derivar una ruta
determinista, pero el onboarding debe persistir también
`selection.routes.default`. Para un carrusel ya existente, conserva sus assets
`reference`, prepara con el Brand Kit activo y sube las imágenes finales como
`kind=social` con índices consecutivos. No uses referencias del moodboard como
medios de una variante.

### ZIP portable del Brand Kit

Cuando el Brand Kit se entrega desde una landing o desde otro workspace, crea
un `brand-kit.zip` con los archivos canónicos y `assets/`. Incluye siempre
`reference-library.json` y declara allí cada imagen con `filename`, `role`,
`usage`, `alt` y `approved: true`. Usa `usage: "style_board"` para un
storyboard visual y `usage: "logo"` para logos. El importador del CMS conserva
esa clasificación en los metadatos del asset. No subas imágenes sueltas ni
dejes la clasificación para una edición manual posterior.

## Frontend

Runtime en `{CMS}/runtime/v1/`. Cada landing guarda `scripts/escarlet-blog.mjs`.

1. `escarlet-blog.mjs` → `scripts/` + hook en `prebuild`/`build`
2. Sync servido desde `/runtime/v1/`; los Social Packs viven en el CMS
3. `blog-articles` reexporta el archivo generado (JS o TS)
4. Fallback vacío
5. `.gitignore` → archivo generado y `.escarlet-blog-runtime/`
6. Coolify env. `BLOG_CMS_URL`, `BLOG_CMS_SITE={handle}`, `BLOG_SITE_URL`
7. Regla Cursor. copia `blog-via-mcp.mdc` y sustituye `{{handle}}`
8. **Social Pack**. El runtime v1.2.0 solo sincroniza posts. El pack canónico vive en CMS `/app/social-pack/{slug}`. Canales por sitio en CMS (`socialPackChannels`).
9. **Interruptor**. CMS Sitio → Blog en la web pública. Apagar no borra posts y el sync emite un módulo vacío.
10. **Dashboard `/app/admin`**. La PWA gestiona brand kit, sitios, revisión y el interruptor. El look de `/blog` sigue en la landing.

## Cómo se edita

- **Texto e imágenes del post.** MCP o `/app`. Para el flujo canónico de generación, administración y publicación vía MCP v3, usa la skill portable [`payload/escarlet-mcp-content/SKILL.md`](../../../payload/escarlet-mcp-content/SKILL.md).
- **Humanizar contenido.** Usa la skill global `$storyscope-human-writing` para revisar el cuerpo sin inventar hechos ni intentar esquivar detectores. En `/app`, la acción «Hacer más humano» aplica la misma guía a un borrador existente.
- **Look de listado y ficha.** En la landing. `generate-blog-pages.mjs` + CSS, o vistas Vue.
- **On/off.** Interruptor del CMS. No uses env de Coolify salvo override local.

## Coolify webhook (contenido → rebuild)

1. Coolify → app del **frontend** (producción) → Deploy Webhook
2. CMS `/app/admin` → Sitio → pega URL + token API → Probar → Guardar
3. `publication.publish` encola el despliegue cuando el destino es Coolify. Coolify rebuild. Sync baja posts

Git push = código (con caché). Webhook del CMS = contenido. Usa force=true para no reciclar el dist.

## Flujo de posts (MCP v3)

La guía operativa completa y portable está en
[`payload/escarlet-mcp-content/SKILL.md`](../../../payload/escarlet-mcp-content/SKILL.md).
En resumen, el flujo canónico es:

`workspace.context.get` → `brand.context.get` → `copy.validate` →
`content.post.create` → `brand.generation.prepare` → `asset.upload` →
`content.media.attach` → `content.post.review` → confirmación humana →
`content.post.approve` → `publication.destination.list` →
`publication.route` → `publication.prepare` → `publication.schedule` o
`publication.publish`.

Para editar se conserva el mismo `postId` o `itemId` y se usa
`content.post.update` o `content.post.variant.upsert`. Para coordinar varios
Posts se usan `content.campaign.*` o `release.*` solo cuando el usuario lo
solicita. No uses aliases legacy ni `create_draft`.

**Brand Kit y PAT personal.** El MCP recibe el contexto normalizado completo de la marca, incluidos voz, estilo, paleta, tipografías, composición, arquetipos, templates y referencias aprobadas. Los archivos fuente privados quedan en la app para owner/admin. Para construirlos desde una landing usa `escarlet-cms-brandkit`, genera el ZIP portable con su `reference-library.json` y persiste el resultado con las capabilities namespaced de v3. El ZIP también sirve como staging o respaldo.

Prohibido. Commitear posts al frontend. Usar `create_draft` para editar.

## API pública

```
GET {CMS}/api/sites/{handle}/posts
GET {CMS}/api/sites/{handle}/posts/{slug}
```

Solo `published`.

## Docs

- `docs/ONBOARDING.md`: checklist completo
- `docs/DEPLOY.md`: volumen CMS + Coolify
- `docs/HANDOFF.md`: contexto histórico escarlet002
