# Escarlet v2: marcas y publicaciones

La interfaz usa cuatro conceptos visibles:

- **Espacio**: membresía, equipo, uso y facturación.
- **Marca**: identidad, canales y conexiones de un cliente. Internamente sigue siendo `sites` para conservar compatibilidad.
- **Campaña**: agrupación de publicaciones relacionadas creada desde ChatGPT/MCP. Internamente sigue siendo `content_batches`.
- **Publicación**: un tema independiente con una variante por canal.

## Flujo de revisión

`brand_list → brand_get_context → content_create_batch → brand_prepare_image_generation → ChatGPT genera → content_upload_media → content_get_batch → Revisión → aprobación → agenda → outbox → Buffer/Coolify`.

La PWA no muestra creación por defecto. `creation_ui_enabled` y `manual_creation_enabled` viven en Postgres con override por espacio o marca; `CREATION_UI_KILL_SWITCH=true` fuerza ambos valores a `false`. MCP no usa ese encabezado y conserva la creación.

## Contratos de contexto

- `GET /api/v2/context` devuelve espacio, marcas accesibles, marca activa, rol/capacidades, flags, canales y conexiones.
- `GET /api/v2/content/plans` devuelve resúmenes listos para la PWA.
- `PATCH /api/v2/feature-flags` actualiza flags para el espacio o la marca seleccionada.
- `GET /api/v2/integrations/metricool` lista conexiones sin devolver secretos.
- `POST /api/v2/brands/:id/connections` acepta `provider: "planable"` con `apiToken`, `workspaceId` y `pageId`; el token se cifra en el servidor.
- `POST /api/v2/connections/:id/test` valida las credenciales del proveedor configurado y comprueba su cuenta/workspace cuando aplica.
- `POST /api/v2/brands/:id/connections` acepta `provider: "postiz"` con `apiToken` (API key u OAuth), `integrationId` y una `apiBaseUrl` opcional para self-hosted; el token se cifra en el servidor.
- `POST /api/v2/brands/:id/connections/postiz/integrations` consulta las cuentas conectadas sin persistir el token y permite elegir el `Integration ID` desde la PWA.
- `POST /api/v2/brands/:id/connections/buffer/channels` consulta organizaciones y canales Buffer sin persistir la API key y permite elegir el `organizationId` y `channelId` desde la PWA.

El MCP v2 usa Postgres como única fuente de contenido. `content_batches`, `/batches` y los nombres históricos de algunas tools son identificadores técnicos internos del modelo que la app presenta como campañas. No se exponen tools de posts ni Social Packs del modelo anterior.

Contrato MCP 3.8.0: Brand Consult + Publish Workflow:

- `content_list_items` devuelve un resumen (id, campaña, título, topic corto, estado, canales, estado por variante, cantidad de medios y fechas). El body y los medios se leen con `content_get_item` o `content_get_batch`.
- `content` de cada tool es un resumen. El objeto va en `structuredContent`, en camelCase, con fechas ISO 8601.
- `brand_list` sin `workspaceId` devuelve los workspaces y marcas visibles. Con un solo workspace mantiene también `workspace`, `brands` y `handles`.
- `readyForReview` lee `socialPack.instagramSlides` o `socialPack.instagramStory.frames[]` y lo compara con `expectedAssetCount` y los `assetIndex` 0..n-1. Cada asset social exige `textRendered`, `textContent`, `templateId` y `renderedBy: "chatgpt-image-generation"`.
- `content_update_item` sustituye el body de esa variante por el JSON recibido. `visualBrief` sin body solo actualiza esa clave. No acepta `kind=reference` ni medios sin `brandPreparationId`.
- Reintentar `content_upload_media` con el mismo sha256, preparationId, assetIndex, itemId y canal devuelve el asset ya guardado. La subida social es siempre `passthrough`: devuelve `originalSha256` y `finalSha256` iguales, sin componer overlays y con `previewUrl` del PNG final.
- `brand_get_style_board` / `brand_prepare_image_generation` entregan las referencias exactas y el prompt de generación. `referenceIndex` solo es compatibilidad histórica.

Flujo único de generación social:

`brand_list → brand_get_context → content_create_batch → brand_prepare_image_generation → ChatGPT genera la imagen final con texto → content_upload_media passthrough → content_get_batch → revisión`.

La matriz de formatos es determinista. `instagram` usa `social_image` a 1080×1350. `instagram_story` usa `instagram_story` a 1080×1920 y guarda sus piezas en `socialPack.instagramStory.frames[]`. El canal no se infiere a partir de palabras del prompt. Los campos históricos de Story se leen, pero no son la estructura de escritura.

## Planable

En **Conexiones**, selecciona **Planable.io**, el canal activo, el API token público de Planable, el `Workspace ID` y el `Page ID` de la cuenta social. Escarlet conserva solo el token cifrado; la prueba usa `GET /ping` y, si se indicó, valida el workspace. El worker crea el post en Planable con su fecha y media pública, manteniendo el flujo de aprobación de Planable.

## Postiz

En **Conexiones**, selecciona **Postiz (self-hosted)**, el canal activo, la API key/OAuth token, el `Integration ID` de la cuenta conectada y, para una instancia propia, la URL base terminada en `/api` (por ejemplo `https://sociales.example.com/api`). Escarlet conserva el token cifrado y usa la API pública de Postiz para crear borradores o publicaciones programadas después de la aprobación. El worker sincroniza los estados de Postiz mediante polling.

También puede definirse `POSTIZ_API_BASE_URL` en el entorno como valor predeterminado para nuevas conexiones; la credencial sigue siendo específica de cada espacio/marca y nunca se envía al navegador.

## Buffer

En **Conexiones**, selecciona **Buffer (API)**, pega una API key creada en los ajustes de Buffer y pulsa **Cargar canales**. Escarlet consulta las organizaciones y canales accesibles para esa cuenta, guarda el `organizationId` y el `channelId` elegido y cifra la API key en el servidor. Las publicaciones aprobadas se envían a Buffer mediante GraphQL con fecha UTC, media pública y sincronización de estados (`scheduled`, `sent` o `error`). La API key es una credencial de la cuenta de Buffer y puede acceder a todas sus organizaciones; por eso cada conexión de Escarlet conserva explícitamente la organización y el canal seleccionados.
