# AGENT.md — Cómo redactar blogs Escarlet

Este archivo manda sobre el flujo de trabajo. El dashboard puede corregirlo si el equipo no está de acuerdo.

## Antes de escribir

En este mismo turno llama `blog_get_brand_context` con el `site` pedido. Lee voz, estilo visual, keywords, este archivo, `postFields`, `editRules`, `workflow` y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los suban (dashboard Brand kit o `blog_update_brand_file`).

Lee cada `postFields[].askHuman`. Pregunta al humano lo que aún no sepas antes de redactar.

No inventes tono ni paleta.

Aplica siempre la política editorial común `sharedEditorialPolicy` devuelta por `blog_get_brand_context` antes de redactar o revisar. Sus reglas son globales y se combinan con este brand kit.

## Autoría

- **Charly** — diseño visual, UI, UX, branding visual, desarrollo web, implementación técnica, performance.
- **Silvia** — estrategia comercial, posicionamiento, mensaje, SEO, conversión, captación local.

Un post, un enfoque principal. Si mezcla temas, elige autor por el objetivo del artículo.

## Flujo MCP (crear)

1. Llama `blog_get_workflow` y pregunta si el usuario prefiere `easy` o `guided`.
2. Genera título, contenido y metadatos en ChatGPT. Para cada imagen llama `brand_prepare_image_generation` y entrega exactamente sus `resolvedReferences` al generador. Si bloquea la generación, restaura las referencias indicadas antes de continuar. Guarda el borrador con `blog_create_draft`, `blog_upload_media` y `blog_update_post`.
3. En `guided`, comparte únicamente `appPreviewUrl` (`/app/preview/{slug}`) y espera la revisión del usuario. En `easy`, muestra un resumen y pide confirmación.
4. Aplica correcciones con `blog_update_post` usando el mismo slug.
5. Tras confirmar, llama `blog_publish` o `blog_schedule_post` con `direct: true` según la decisión del usuario. Usa la revisión dentro de `/app`.
6. Guarda el Social Pack generado por ChatGPT con `blog_save_social_pack`. El CMS no genera copy ni carruseles desde MCP.

Si el usuario no quiere blog, no crees borrador: genera el pack en ChatGPT y
guárdalo con `social_save_pack` usando `title`, `brief`, `sourceUrl` opcional y
`socialPack`. Recupera packs anteriores con `social_list_packs` y
`social_get_pack`.

## Flujo MCP (editar)

1. `blog_get_brand_context`
2. `blog_list_posts` y `blog_get_post` con el slug existente
3. **Nunca** `blog_create_draft` para editar. Eso duplica el post.
4. `blog_update_post` con el **mismo slug**
5. Si renombras el slug. pasa `originalSlug` (actual) y `slug` (nuevo)
6. Si editas un post `published` y quieres mantenerlo en vivo, usa `keepPublished: true`. Si no, confirma cuándo volver a publicar.
7. Comparte `appPreviewUrl` de `/app` solo cuando el usuario necesite revisar.

## Despublicar y eliminar

- Despublicar (sale del blog, queda el contenido). `blog_unpublish`
- Eliminar permanente. `blog_delete_post` con `confirm: true`

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
- socialPack con backlink `https://escarlet.design/blog/{slug}` (solo canales activos en `socialPackChannels`).
- Carrusel Instagram. Caption con canónico. Slides con `imageUrl` absoluta del CMS + alt.

## Imágenes

- Portada en kebab-case. Subida al CMS, no al git del frontend.
- Alt describe lo que se ve. Palabra clave si encaja.
- Composición y color según `visual-style.md` y las referencias exactas devueltas por `brand_prepare_image_generation`.
- Cómo subir (orden preferido):
  1. Genera o elige la imagen. Un PNG de 2–3 MB vale.
  2. `blog_upload_media` con `contentBase64` o `blob`. El CMS comprime a JPEG.
  3. Si el host recorta el base64, usa `uploadId`, `chunkIndex` y `chunkCount`.
  4. Nunca uses `/mnt/data` como `imageUrl`.
  5. Usa la `media.url` absoluta en el `imageUrl` del post o en cada slide.
- Carrusel Instagram (`kind` `social`). 4–7 slides. Formato 1080×1350 (o 1080×1080). Filename `{slug}-ig-01.jpg` … `{slug}-ig-07.jpg`. Sube cada slide al CMS y guarda el array en `socialPack.instagramSlides`.

## Sistema visual v2 (obligatorio)

- Antes de generar una portada, inspecciona los últimos seis posts con `blog_list_posts` y `blog_get_post`. Lee `visualBrief`, `imageMetadata` e `imageGallery` cuando existan.
- Consulta el arquetipo y el historial para redactar el brief, pero no uses esa decisión para seleccionar referencias. La ruta de referencias la resuelve `brand_prepare_image_generation` de forma determinista.
- Construye y guarda un `visualBrief` con `archetype`, `composition`, `references`, `negativeRules` y `decision.recentPostsInspected`.
- La portada siempre se genera sin texto, letras, números, logos ni UI legible. El prompt debe incluir la intención emocional, el arquetipo, la composición, las referencias aprobadas y lo que no se debe repetir.
- Para el modo operativo entrega una única ruta final. No existe exploración automática ni fallback silencioso.
- En Instagram, la IA solo genera fondos. Nunca le pidas que dibuje `headline` o `body`.
- Renderiza cada slide con un único template (`editorial` o `impact`) usando `content-system/instagram-renderer.mjs`. La fuente, safe areas, saltos y jerarquías salen del template.
- Guarda en cada slide `templateId`, `backgroundMediaId`, `backgroundStyle` y `renderedBy: content-system/instagram-renderer`.
- Si una portada o slide existente repite filename/hash, carece de metadata o rompe el template, marca `regenerate` con `analyze-existing-assets.mjs` y regenera solo ese slug.
- No heredes la paleta o las referencias de Escarlet en otro sitio. Reutiliza las reglas del workflow y carga el brand core del sitio solicitado.

## Publicación

- El flujo nuevo publica desde el CMS y mantiene la experiencia humana en `/app`.
- La revisión guiada usa `appPreviewUrl` y la edición `/app/preview/{slug}`.
- El Social Pack se abre en `/app/social-pack/{slug}` después de publicar.
