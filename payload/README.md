# Payload 3 (Postgres)

El panel que corre hoy es Node + JSON (`server.mjs`). Estas colecciones son el contrato para migrar a Payload 3 en Coolify cuando haga falta usuarios, roles y media library.

```bash
npx create-payload-app@latest -t blank
# Postgres en Coolify o docker compose de este repo
# Copiar payload/collections.js y este config a src/
```

Colecciones: `sites`, `posts`, `authors`, `media`, `categories`. El webhook de rebuild se dispara al publicar (hook `afterChange` si `status === published`).

La API pública de lectura la sigue exponiendo el sitio consumidor o un route handler Next que reexpone el mismo JSON:

`GET /api/sites/:site/posts`
