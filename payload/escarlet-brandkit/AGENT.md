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
2. Consulta `brand_get_context` y genera título, contenido, metadatos e imágenes en ChatGPT. Antes de cada imagen llama `brand_prepare_image_generation`, entrega exactamente sus `ImageContent` y conserva `brandPreparation.preparationId`.
3. Crea el plan con `content_create_batch`, indicando `topics` y `channels`. La generación es asíncrona.
4. Sigue el estado con `content_list_plans`, `content_list_items` o `content_get_batch`. Aplica correcciones con `content_update_item`.
5. Tras la revisión humana, usa `content_approve` o `content_reject`. Para una fecha futura usa `content_schedule`.

## Flujo MCP (editar)

1. `content_list_items` o `content_get_batch` para localizar la publicación v2.
2. **Nunca** crees otro plan para editar. Usa `content_update_item` con el `itemId` existente.
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
- Carrusel Instagram. Caption con canónico. Slides con `imageUrl` absoluta del CMS + alt.

## Imágenes

- Portada en kebab-case. Subida al CMS, no al git del frontend.
- Alt describe lo que se ve. Palabra clave si encaja.
- Composición y color según `visual-style.md` y las referencias exactas devueltas por `brand_prepare_image_generation`.
- Cómo subir en v2:
  1. Genera la imagen usando exactamente las referencias adjuntas por `brand_prepare_image_generation`.
  2. `content_upload_media` con `kind: post` o `social`, `contentBase64` o `blob` y `brandPreparationId`. El CMS comprueba el snapshot y guarda un `mediaAssetId` canónico.
  3. Si el host recorta el base64, usa `uploadId`, `chunkIndex` y `chunkCount` con la misma credencial.
  4. Nunca uses `/mnt/data` como `imageUrl`.
  5. Pasa `mediaAssetId` a `content_update_item` junto con `visualBrief` y `brandPreparationId`.
- Carrusel Instagram (`kind` `social`). 4–7 slides. Formato 1080×1350 (o 1080×1080). Sube cada slide al CMS y enlázala en la variante Instagram del item.

## Sistema visual v2 (obligatorio)

- Antes de generar una portada, inspecciona las publicaciones recientes con `content_list_items` y sus variantes.
- Consulta el arquetipo y el historial para redactar el brief, pero no uses esa decisión para seleccionar referencias. La ruta de referencias la resuelve `brand_prepare_image_generation` de forma determinista.
- Construye y guarda un `visualBrief` con `archetype`, `composition`, `references`, `negativeRules` y `decision.recentPostsInspected`.
- La portada siempre se genera sin texto, letras, números, logos ni UI legible. El prompt debe incluir la intención emocional, el arquetipo, la composición, las referencias aprobadas y lo que no se debe repetir.
- Para el modo operativo entrega una única ruta final. No existe exploración automática ni fallback silencioso.
- En Instagram, la IA solo genera fondos. Nunca le pidas que dibuje `headline` o `body`.
- Renderiza cada slide con un único template (`editorial` o `impact`) usando `content-system/instagram-renderer.mjs`. La fuente, safe areas, saltos y jerarquías salen del template.
- Guarda en cada slide `templateId`, `backgroundMediaId`, `backgroundStyle` y `renderedBy: content-system/instagram-renderer`.
- Si una portada o slide existente repite filename/hash, carece de metadata o rompe el template, marca `regenerate` con `analyze-existing-assets.mjs` y regenera solo ese slug.
- No heredes la paleta o las referencias de Escarlet en otro sitio. Carga el brand core de la marca solicitada.

## Publicación

- El flujo nuevo publica desde el CMS y mantiene la experiencia humana en `/app`.
- La revisión y la agenda se gestionan en Planes de contenido y Calendario dentro de la app v2.
