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
workspace.context.get
content.post.list
content.post.create
content.post.get
content.post.update
content.post.variant.upsert
content.post.review
content.post.approve
content.post.archive
content.audit.inventory
content.audit.repair.plan
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

## Auditoría editorial

`workspace.context.get` resuelve el workspace y las marcas autorizadas. Las lecturas de `asset.list`, `content.post.list` y `content.audit.inventory` pueden reutilizar la marca activa o devolver las opciones autorizadas sin adivinar IDs.

`content.audit.inventory` es de solo lectura. Devuelve Posts, variantes, assets, procedencia, vínculos a contenido, vídeo, Brand Kit y publicaciones, además de assets sin Post, assets realmente no usados, reutilización, hashes duplicados y borradores de vídeo sin media.

`content.audit.repair.plan` también es de solo lectura. Solo propone adjuntar un asset cuando su procedencia identifica un Post y un canal existentes, o archivar un borrador de vídeo vacío. Nunca ejecuta la reparación, no borra assets y requiere confirmación humana en una operación posterior.

`content.post.archive` es reversible, exige `confirm: true`, conserva variantes y media, registra auditoría y rechaza archivar un Post ya publicado. `idempotencyKey` permite repetir la misma solicitud sin duplicar el cambio.

Ejemplo de auditoría segura:

```text
workspace.context.get {}
content.post.list { site: "escarlet", limit: 50 }
asset.list { site: "escarlet", limit: 100 }
content.audit.inventory { site: "escarlet", limit: 50 }
content.audit.repair.plan { site: "escarlet" }
```

El plan no modifica nada. Después de una confirmación humana, cada propuesta se ejecuta con su capability canónica (`content.media.attach`, `content.post.archive` o `asset.delete`) y una clave de idempotencia cuando corresponda. Los clientes anteriores reciben un error namespaced o `410` en `/mcp`; no existen aliases de compatibilidad que vuelvan a escribir legacy.

## IA externa

El servidor no ejecuta IA generativa. MCP entrega contexto versionado, preparación, validación, procedencia y persistencia para una IA externa.
