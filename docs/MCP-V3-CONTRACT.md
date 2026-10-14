# Escarlet MCP V3

## Endpoint

El único endpoint MCP soportado es:

```text
/mcp/v3
```

`/mcp` responde `410 mcp_v3_required`. No existen aliases de herramientas antiguas.

## Capabilities canónicas

```text
brand.context.get
content.post.create
content.post.get
content.post.update
content.post.variant.upsert
content.post.review
content.post.approve
content.media.attach
release.create
release.add_post
release.schedule
release.publish
publication.destination.list
publication.destination.validate
publication.route
publication.prepare
publication.schedule
publication.publish
publication.status.get
```

Las capabilities técnicas de producción (`brand.generation.prepare`, `asset.upload`, `production.motion.*`) permanecen disponibles dentro del contrato v3, pero deben terminar asociadas a un Post cuando el resultado sea publicable.

## Permisos

Las operaciones de lectura requieren `brand:read`, `content:read` o `publication:read`. Las operaciones de edición requieren `content:write`. Aprobar, programar y publicar requieren `content:publish` o `publication:publish` según la operación.

## IA externa

El servidor no ejecuta IA generativa. MCP entrega contexto versionado, preparación, validación, procedencia y persistencia para una IA externa.
