# Escarlet v2: marcas y publicaciones

La interfaz usa cuatro conceptos visibles:

- **Espacio**: membresía, equipo, uso y facturación.
- **Marca**: identidad, canales y conexiones de un cliente. Internamente sigue siendo `sites` para conservar compatibilidad.
- **Plan de contenidos**: agrupación creada desde ChatGPT/MCP. Internamente sigue siendo `content_batches`.
- **Publicación**: un tema independiente con una variante por canal.

## Flujo de revisión

`ChatGPT/MCP → Plan → generación asíncrona → Revisión → aprobación → agenda → outbox → Metricool`.

La PWA no muestra creación por defecto. `creation_ui_enabled` y `manual_creation_enabled` viven en Postgres con override por espacio o marca; `CREATION_UI_KILL_SWITCH=true` fuerza ambos valores a `false`. MCP no usa ese encabezado y conserva la creación.

## Contratos de contexto

- `GET /api/v2/context` devuelve espacio, marcas accesibles, marca activa, rol/capacidades, flags, canales y conexiones.
- `GET /api/v2/content/plans` devuelve resúmenes listos para la PWA.
- `PATCH /api/v2/feature-flags` actualiza flags para el espacio o la marca seleccionada.
- `GET /api/v2/integrations/metricool` lista conexiones sin devolver secretos.

Los nombres técnicos (`/batches`, `content_batches`, tools MCP y feed público) se mantienen como adaptadores durante la transición.
