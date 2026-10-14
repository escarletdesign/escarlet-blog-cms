# Migración legacy a Escarlet V3

## Política

La migración es de corte definitivo. No se conservan escrituras legacy ni una ventana de compatibilidad.

## Herramienta

```text
node scripts/migrations/import-legacy-to-v3.mjs --dry-run
node scripts/migrations/import-legacy-to-v3.mjs
```

La herramienta crea respaldos, importa datos, normaliza contenido y escribe un informe JSON. Es una herramienta histórica y no se carga desde el runtime web.

## Mapeo

- Post de `db.json` → `content_items` + variante `blog`.
- Social pack → variantes `instagram`, `instagram_story`, `linkedin`, `x` o `substack` cuando existan.
- Imagen asociada → `media_assets` + `content_variant_media`.
- Asset publicable sin relación → Post borrador en `Inbox editorial`.
- Identificadores antiguos → `metadata.migration.legacyId`.

## Verificación

La migración falla si:

- existe una publicación sin Post;
- existe una variante sin `content_item`;
- existe un asset publicable que no está asociado o no tiene Post borrador;
- la marca o el Brand Kit no pueden resolverse;
- la segunda ejecución no es idempotente.

Después del corte, las rutas antiguas responden `404` o `410` y las herramientas MCP antiguas no aparecen en el catálogo.
