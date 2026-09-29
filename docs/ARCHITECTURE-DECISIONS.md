# Decisiones de arquitectura

## Alcance

La cuenta cliente es el `workspace` y contiene usuarios, membresías y facturación. Cada marca operativa es un `site` y contiene su Brand Kit, canales, publicaciones y cuota de producción. Las cuotas comerciales futuras se aplican por marca y pueden agregarse por workspace.

Durante la beta no se bloquea la producción por cuota.

## Datos y Brand Kits

- Postgres es la fuente canónica.
- Un Brand Kit publicado es inmutable. Los cambios parten de un draft y se publican como una nueva versión.
- Los drafts usan `baseVersionId`, `expectedActiveVersionId` e `idempotencyKey` para evitar duplicados y conflictos.
- Los personajes son assets con `metadata.usage = "character"` y `characterId` opcional.
- Las APIs legacy conservan sus rutas y campos mientras se completa la migración.

El flujo MCP de edición es `brand_create_draft`, `brand_upload_asset`, `brand_update_file`, `brand_validate_draft` y `brand_publish_draft`. La publicación exige revisión humana y una versión activa esperada.

## Media

Cada imagen puede exponer el original y derivados de visualización:

```json
{
  "url": "/media/brand/post.jpg",
  "previewUrl": "/media/brand/post_preview.jpg",
  "thumbUrl": "/media/brand/post_thumb.jpg",
  "width": 1600,
  "height": 1067,
  "originalBytes": 420000,
  "storedBytes": 420000,
  "previewBytes": 180000,
  "thumbBytes": 42000
}
```

Los listados usan `thumbUrl`, las revisiones usan `previewUrl` y el original queda para publicación, descarga o apertura explícita. Las URLs versionadas se sirven con caché inmutable. El servidor entrega media mediante streams y soporta `ETag`, `Last-Modified`, `304` y `HEAD`.

La beta mantiene media local. Antes de ejecutar varias réplicas se migrará a S3, R2 o almacenamiento compatible con CDN. Postgres seguirá guardando `storage_key`, hash, tamaños y relaciones.

## Operación

Los objetivos iniciales son miniaturas menores de 150 KB, previews menores de 500 KB, p95 menor de 500 ms para lecturas internas y una cola de jobs normalmente menor de 60 segundos. Las métricas de peso, latencia, memoria, caché y almacenamiento se medirán antes de ajustar límites.

La separación de API y worker, OpenTelemetry, Sentry, k6, Playwright y el almacenamiento externo requieren configuración de infraestructura y quedan como siguientes pasos operativos, no como dependencias de la beta.
