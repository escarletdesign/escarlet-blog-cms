# AGENT.md: cómo redactar blogs Escarlet

Este archivo manda sobre el flujo de trabajo. El dashboard puede corregirlo si el equipo no está de acuerdo.

## Antes de escribir

En este mismo turno llama `brand_get_context` con el `site` pedido. Lee voz, estilo visual, keywords, este archivo y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los suban desde Brand kit en la app v2.

Pregunta al humano lo que aún no sepas antes de redactar.

No inventes tono ni paleta.

Aplica siempre la política editorial común `sharedEditorialPolicy` devuelta por `brand_get_context` antes de redactar o revisar. Sus reglas son globales y se combinan con este brand kit.

## Autoría

- **Charly**: diseño visual, UI, UX, branding visual, desarrollo web, implementación técnica, performance.
- **Silvia**: estrategia comercial, posicionamiento, mensaje, SEO, conversión, captación local.

Un post, un enfoque principal. Si mezcla temas, elige autor por el objetivo del artículo.

## Flujo MCP (crear)

1. Si hay varias marcas, llama `brand_list` y pregunta cuál quiere usar. Nunca elijas una por defecto.
2. Consulta `brand_get_context` y genera primero los textos y variantes completas. Guarda todo con `content_create_batch`; crea una campaña nueva automáticamente, y usa `batchId` solo si el usuario pidió reutilizar una existente.
3. Para Instagram, genera fondos sin texto. Prepara cada imagen con `brand_prepare_image_generation` indicando itemId y canal una sola vez. Después sube cada archivo con `content_upload_media` y preparationId; el CMS reutiliza item y canal, valida las dimensiones reales y renderiza el texto guardado.
4. Confirma que cada item esté `readyForReview` antes de indicar que terminó. Usa `content_get_batch` solo si la respuesta devuelve `in_progress`.
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
- Carrusel Instagram. Caption con canónico. Slides a 1080×1350 con alt descriptivo; el CMS incorpora el texto guardado en cada slide.

## Imágenes

- Portada en kebab-case. Subida al CMS, no al git del frontend.
- Alt describe lo que se ve. Palabra clave si encaja.
- Composición y color según `visual-style.md` y las referencias exactas devueltas por `brand_prepare_image_generation`.
- Cómo subir en v2:
  1. Crea y guarda primero el texto completo con `content_create_batch`.
  2. Llama `brand_prepare_image_generation` con el `itemId` y canal. Genera el fondo usando exactamente las referencias adjuntas.
  3. Sube el archivo con `content_upload_media` y `preparationId`. El CMS asocia el archivo al item y valida las dimensiones reales.
  4. Si el host no permite adjuntar `file`, usa `contentBase64` o, como último recurso, `uploadId`, `chunkIndex` y `chunkCount`.
  5. Nunca uses `/mnt/data` como `imageUrl`. Comprueba `readyForReview` antes de informar que terminó.
- Carrusel Instagram (`kind` `social`). 4–7 fondos sin texto a 1080×1350. Reutiliza el mismo `preparationId` y sube cada slide en orden con `assetIndex`.

## Sistema visual v2 (obligatorio)

- El sistema web usa `#47A4E7` como color principal, Montserrat como tipografía y un degradado teal `#12B8D6` a dorado `#E8B73A` solo en héroes y llamadas a la acción.

- Sigue la composición y las referencias exactas que devuelve `brand_prepare_image_generation`.
- La portada siempre se genera sin texto, letras, números, logos ni UI legible. El prompt debe incluir la intención emocional, el arquetipo, la composición, las referencias aprobadas y lo que no se debe repetir.
- En Instagram, la IA solo genera fondos. El CMS renderiza el `headline` y `body` exactos guardados en cada slide con el template `editorial`.
- El texto de cada slide debe ser grande y legible en móvil. Cada bloque admite una, dos o tres líneas como máximo. Si desborda, divide el mensaje en otra slide, nunca reduzcas la tipografía para que quepa.
- La primera y la última slide usan colores puros de Escarlet, sin overlay aclarador, texto blanco con contraste y el logo oficial indicado por el brandkit. Las slides centrales usan fondos claros y generalistas, texto oscuro y sin logo.
- El logo solo se inserta desde el SVG oficial del brandkit. Nunca lo redibujes ni lo generes con IA.
- El CMS conserva los datos del render y el hash final del archivo.
- Si una portada o slide existente repite filename/hash, carece de metadata o rompe el template, marca `regenerate` con `analyze-existing-assets.mjs` y regenera solo ese slug.
- No heredes la paleta o las referencias de Escarlet en otro sitio. Carga el brand core de la marca solicitada.

## Publicación

- El flujo nuevo publica desde el CMS y mantiene la experiencia humana en `/app`.
- La aprobación y la agenda se gestionan en Campañas y Calendario dentro de la app v2.
