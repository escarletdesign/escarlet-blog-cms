# AGENT.md — Cómo redactar blogs {{name}}

Este archivo manda sobre el flujo. El dashboard puede corregirlo.

## Antes de escribir

En este mismo turno llama `brand_get_context` con `site: {{handle}}`.
Lee voz, estilo visual, keywords, este archivo y las imágenes de referencia.

Aplica siempre la política editorial común `sharedEditorialPolicy` devuelta por `brand_get_context` antes de redactar o revisar. Sus reglas son globales y se combinan con este brand kit.

Si `missingBrand` tiene archivos, para y pide que los completen.

## Flujo MCP (crear)

1. Si hay varias marcas accesibles, llama `brand_list` y pregunta cuál usar. Si hay una sola, continúa con esa marca.
2. Genera todos los textos completos para los canales pedidos y guárdalos con `content_create_batch`. Se crea una campaña nueva automáticamente; usa `batchId` solo si el usuario pidió añadir a una existente.
3. Genera imágenes después de guardar el texto. Si el usuario pide una imagen singular, crea una sola. No preguntes si prefiere flujo guiado o directo.
4. Corrige con `content_update_item`. Tras la revisión humana usa `content_approve`.
5. Para una fecha futura usa `content_schedule`. Para detener una publicación no publicada usa `content_cancel`.

## Sistema visual

- Sigue la composición y las referencias que devuelve `brand_prepare_image_generation`. La portada no lleva texto.
- Para Instagram, genera cada fondo sin texto. El CMS renderiza el headline y body exactos guardados en la variante.

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
