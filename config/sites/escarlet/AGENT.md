# AGENT.md: Cómo redactar blogs Escarlet

Este archivo manda sobre el flujo de trabajo. El dashboard puede corregirlo si el equipo no está de acuerdo.

## Antes de escribir

El grounding visual obligatorio combina `style-board.png` con `fondo-escarlet.png`. Si el brief solicita un personaje, usa la referencia individual aprobada correspondiente.

En este mismo turno llama `brand_get_context` con el `site` pedido. Lee voz, estilo visual, keywords, este archivo y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los suban desde Brand kit en la app v2.

Resuelve los detalles menores con el brand kit y el contexto. Pregunta solo si falta una decisión que impide crear el contenido.

No inventes tono ni paleta. La paleta canónica es `#12B8D6`, `#62B38A`, `#E8B73A`, `#1E1E1E`, `#6D6D6D` y `#FFFFFF` cuando sea necesario. El papel crema no forma parte de la marca.

Aplica siempre la política editorial común `sharedEditorialPolicy` devuelta por `brand_get_context` antes de redactar o revisar. Sus reglas son globales y se combinan con este brand kit.

## Autoría

- **Charly**: diseño visual, UI, UX, branding visual, desarrollo web, implementación técnica, performance.
- **Silvia**: estrategia comercial, posicionamiento, mensaje, SEO, conversión, captación local.

Un post, un enfoque principal. Si mezcla temas, elige autor por el objetivo del artículo.

## Flujo MCP (crear)

1. Si hay varias marcas, llama `brand_list` y pregunta cuál quiere usar. Nunca elijas una por defecto.
2. Consulta `brand_get_context` y genera primero los textos y variantes completas. Guarda todo con `content_create_batch`; crea una campaña nueva automáticamente, y usa `batchId` solo si el usuario pidió reutilizar una existente.
3. Para cada asset social, prepara la imagen con `brand_prepare_image_generation` indicando itemId y canal una sola vez. Genera en ChatGPT la imagen final con el copy aprobado ya integrado y súbela con `content_upload_media` y preparationId. La subida social es passthrough por contrato. El CMS solo valida, almacena y asocia el archivo. No compone overlays.
4. Revisa `readyForReview` en la respuesta de subida. Si es `in_progress`, completa lo que indique el CMS. No informes que terminó hasta que cada item esté listo para revisión.
5. Tras la revisión humana, usa `content_approve`. Para una fecha futura usa `content_schedule`.

## Flujo MCP (editar)

1. `content_list_items` o `content_get_batch` para localizar la publicación v2.
2. **Nunca** crees otra campaña para editar. Usa `content_update_item` con el `itemId` existente.
3. Revisa el resultado en la app v2 y espera la confirmación del usuario.

## Despublicar y eliminar

- Cancelar una publicación aún no publicada. `content_cancel`

## Copy

- Español de España, tú, directo, oral.
- Una idea por párrafo.
- Sin dos puntos ni punto y coma en textos visibles.
- Positivo. Evita «no» salvo para prevenir errores o falsas promesas.
- Sin premium, sin promesas de ventas garantizadas.

## SEO por post

Bloquean publicar solo lo grave (texto vacío o muy corto, sin título/slug, autor inválido).

Recomendado (aviso, no bloquea):

- Alrededor de 400-800 palabras. Claro y útil, sin relleno.
- metaTitle.es 20-70 caracteres.
- metaDescription.es 70-180 caracteres.
- imageAlt descriptivo.
- Al menos 1 enlace interno.
- Las variantes de cada canal deben incluir el enlace canónico cuando corresponda.
- Instagram. Caption y slides con media del CMS y alt descriptivo.

## Imágenes

- `style-board.png` y `fondo-escarlet.png` son referencias obligatorias en toda generación. El cliente no puede escoger, sustituir ni reinterpretar referencias.
- Las rutas editoriales usan el tablero y el fondo oficiales. Si se solicita un personaje, se añade la referencia individual aprobada correspondiente.
- El logo SVG oficial solo se entrega al motor motion cuando la animación lo necesita.
- El fondo conserva formas orgánicas estratificadas tipo montañas con turquesa a la izquierda, verde suave en el centro y oro a la derecha.

- Portada en kebab-case. Subida al CMS, no al git del frontend.
- Alt describe lo que se ve. Palabra clave si encaja.
- Composición y color según `visual-style.md` y las referencias exactas devueltas por `brand_prepare_image_generation`.
- Cómo subir (orden preferido):
  1. Genera o elige la imagen. Un PNG de 2–3 MB vale.
  2. Prepara una vez con `brand_prepare_image_generation`, indicando el `itemId` y canal. Para un carrusel o Story con varios frames, usa el total en `expectedAssetCount`.
  3. Genera la pieza final con texto integrado y súbela con `content_upload_media`, `preparationId`, `textRendered=true`, `textContent`, `templateId` y `renderedBy=chatgpt-image-generation`. El CMS inspecciona dimensiones exactas y asocia el archivo sin modificar sus píxeles.
  4. Si el host no acepta `file`, usa `contentBase64` o, como último recurso, `uploadId`, `chunkIndex` y `chunkCount`.
  5. Nunca uses `/mnt/data` como `imageUrl`.
- Carrusel Instagram (`kind` `social`). 4–7 imágenes finales a 1080×1350 con texto integrado. Usa un `templateId` por carrusel y sube en orden con `assetIndex` y el mismo `preparationId`.
- Story Instagram (`kind` `social`). Usa `socialPack.instagramStory.frames[]` como fuente canónica. Genera una imagen final a 1080×1920 por frame con texto integrado y alt. Los campos antiguos de Story solo sirven para lectura histórica.

## Sistema visual v2 (obligatorio)

- Sigue la composición y las referencias exactas que devuelve `brand_prepare_image_generation`.
- La portada siempre se genera sin texto, letras, números, logos ni UI legible. El prompt debe incluir la intención emocional, el arquetipo, la composición, las referencias aprobadas y lo que no se debe repetir.
- La selección es determinista. Para modo `automatic` se usa una única ruta cerrada. No existe fallback silencioso ni modo de exploración para generar.
- En Instagram, genera siempre la pieza final con el headline y body exactos ya integrados en ChatGPT. El CMS no renderiza texto, logos ni overlays y no altera los píxeles subidos.
- En vídeo, ChatGPT entrega al motor motion las imágenes, fondos, copy, audio y el SVG aprobado del logo cuando sea necesario. `production.motion.compose` registra esos roles y el motor anima los assets; no generes ni redibujes el logo con IA.
- Si una portada o slide existente repite filename/hash, carece de metadata o rompe el template, repórtalo con `analyze-existing-assets.mjs`. La regeneración queda fuera del CMS beta y requiere una nueva revisión editorial.
- No heredes la paleta o las referencias de Escarlet en otro sitio. Carga el brand core de la marca solicitada.

## Publicación

- El flujo v2 publica desde el CMS y mantiene la experiencia humana en `/app`.
- La aprobación y la agenda se reflejan en Postgres y se muestran en Campañas y Calendario.
