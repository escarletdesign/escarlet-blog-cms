# Retirada de legacy

La PWA en `/app` es la única interfaz humana del CMS. La migración está cerrada:

- se eliminó el shell estático `admin.html` y sus assets públicos;
- el Social Pack se sirve por post desde `/app/social-pack/{slug}`;
- el runtime de landings solo sincroniza contenido (`sync-blog-cms.mjs`);
- las plantillas de packs Vite y el preview HTML independiente ya no forman parte del producto.

Las rutas históricas `/admin`, `/admin/blog-packs/{slug}` y `/preview/{site}/{slug}`
responden con una redirección permanente a sus equivalentes en `/app` para no romper
marcadores ni integraciones antiguas. El contrato `/api/admin/*` se conserva porque es
la API interna que consumen la PWA y MCP; no es una superficie legacy.

## Verificación

- `npm run build`
- `npm test`
- comprobar `/app`, `/app/admin`, `/app/preview/{slug}` y `/app/social-pack/{slug}`
- comprobar SSO WordPress (`POST /api/embed/session` → `/app`)

No se mantienen copias ni generadores alternativos del panel. Si una landing aún
incluye un pack HTML propio, debe migrarlo al Social Pack del CMS antes de retirar
su integración.
