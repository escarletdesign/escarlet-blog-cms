# AGENT.md — Cómo redactar blogs {{name}}

Este archivo manda sobre el flujo. El dashboard puede corregirlo.

## Antes de escribir

En este mismo turno llama `brand_get_context` con `site: {{handle}}`.
Lee voz, estilo visual, keywords, este archivo y las imágenes de referencia.

Aplica siempre la política editorial común `sharedEditorialPolicy` devuelta por `brand_get_context` antes de redactar o revisar. Sus reglas son globales y se combinan con este brand kit.

Si `missingBrand` tiene archivos, para y pide que los completen.

## Flujo MCP (crear)

1. Si hay varias marcas, llama `brand_list` y pregunta cuál quiere usar. Nunca elijas una por defecto.
2. Genera el título, contenido, metadatos e imágenes en ChatGPT siguiendo el brand kit y sus referencias.
   Si el usuario pide una imagen en singular, genera exactamente una imagen y sube un solo archivo. No generes variantes ni galerías salvo que indique una cantidad.
3. Llama `content_list_plans`. Si hay campañas activas, pregunta si se reutiliza una o se crea otra. Después usa `content_create_batch` con el `batchId` elegido o con `createNewCampaign: true`.
4. Corrige con `content_update_item`. Tras la revisión humana usa `content_approve`.
5. Para una fecha futura usa `content_schedule`. Para detener una publicación no publicada usa `content_cancel`.

## Sistema visual

- Inspecciona los últimos seis posts y guarda un `visualBrief` antes de crear una portada.
- Elige un arquetipo del sistema del sitio y evita repetir el arquetipo consecutivo. La portada no lleva texto.
- Usa referencias aprobadas y registra `references`, `negativeRules` y `decision.recentPostsInspected`.
- Para Instagram, genera fondos sin texto y monta `headline` + `body` con un template controlado y la fuente declarada. El generador de imágenes no dibuja tipografía.
- Conserva `templateId`, `backgroundMediaId` y `renderedBy` en cada slide.

## Flujo MCP (editar)

1. `content_list_items` o `content_get_batch` para localizar el `itemId`.
2. Nunca crees otra campaña para editar.
3. `content_update_item` con el `itemId` existente y revisa el resultado en la app v2.

## Copy

- Sigue `voice.md`.
- Sin dos puntos ni punto y coma en textos visibles.
- Las variantes de cada canal deben incluir el enlace canónico cuando corresponda.
- Instagram. Caption + slides con imageUrl del CMS.

## Prohibido

- Commitear contenido editorial al git del frontend.
- Inventar tono o paleta si el brand kit está vacío.
