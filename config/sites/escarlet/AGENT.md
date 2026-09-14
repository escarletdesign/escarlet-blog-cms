# AGENT.md — Cómo redactar blogs Escarlet

Este archivo manda sobre el flujo de trabajo. El dashboard puede corregirlo si el equipo no está de acuerdo.

## Antes de escribir

En este mismo turno llama `blog_get_brand_context` con el `site` pedido. Lee voz, estilo visual, keywords, este archivo, `postFields`, `editRules`, `workflow` y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los suban (dashboard Brand kit o `blog_update_brand_file`).

Lee cada `postFields[].askHuman`. Pregunta al humano lo que aún no sepas antes de redactar.

No inventes tono ni paleta.

## Autoría

- **Charly** — diseño visual, UI, UX, branding visual, desarrollo web, implementación técnica, performance.
- **Silvia** — estrategia comercial, posicionamiento, mensaje, SEO, conversión, captación local.

Un post, un enfoque principal. Si mezcla temas, elige autor por el objetivo del artículo.

## Flujo MCP (crear)

1. Llama `blog_get_workflow` y pregunta si el usuario prefiere `easy` o `guided`.
2. Genera título, contenido, metadatos e imágenes en ChatGPT usando este brand kit y sus referencias. Guarda el borrador con `blog_create_draft`, `blog_upload_media` y `blog_update_post`.
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

### Pasada humana StoryScope

- Usa StoryScope como guía editorial, no para intentar engañar detectores.
- Conserva hechos, intención, keywords y voz de marca. No inventes anécdotas, citas ni referencias.
- Sustituye abstracciones por detalles observables y muestra decisiones con costes o consecuencias cuando existan.
- No expliques la moraleja varias veces. Deja espacio para que el lector infiera y mantén matices o tensión abierta cuando el tema lo necesite.
- Revisa linealidad, subtramas, agencia, estructura temporal y repeticiones sensoriales. Cambia solo lo que mejore claridad e interés.
- Haz una segunda pasada para eliminar frases intercambiables antes de resumir o publicar.

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
- Composición y color según `visual-style.md` y las fotos de referencia.
- Cómo subir (orden preferido):
  1. Genera o elige la imagen. Un PNG de 2–3 MB vale.
  2. `blog_upload_media` con `contentBase64` o `blob`. El CMS comprime a JPEG.
  3. Si el host recorta el base64, usa `uploadId`, `chunkIndex` y `chunkCount`.
  4. Nunca uses `/mnt/data` como `imageUrl`.
  5. Usa la `media.url` absoluta en el `imageUrl` del post o en cada slide.
- Carrusel Instagram (`kind` `social`). 4–7 slides. Formato 1080×1350 (o 1080×1080). Filename `{slug}-ig-01.jpg` … `{slug}-ig-07.jpg`. Sube cada slide al CMS y guarda el array en `socialPack.instagramSlides`.

## Sistema visual v2 (obligatorio)

- Antes de generar una portada, inspecciona los últimos seis posts con `blog_list_posts` y `blog_get_post`. Lee `visualBrief`, `imageMetadata` e `imageGallery` cuando existan.
- Elige un arquetipo de `content-system/brand/escarlet-image-archetypes.json`. No repitas el arquetipo del post anterior. Si el tema es parecido a uno reciente, fuerza también un encuadre y una presencia de persona distintos.
- Construye y guarda un `visualBrief` con `archetype`, `composition`, `references`, `negativeRules` y `decision.recentPostsInspected`.
- La portada siempre se genera sin texto, letras, números, logos ni UI legible. El prompt debe incluir la intención emocional, el arquetipo, la composición, las referencias aprobadas y lo que no se debe repetir.
- Para modo `automatic`, entrega una ruta final. Para modo `exploration`, genera tres rutas con arquetipos diferentes y marca la recomendada.
- En Instagram, la IA solo genera fondos. Nunca le pidas que dibuje `headline` o `body`.
- Renderiza cada slide con un único template (`editorial` o `impact`) usando `content-system/instagram-renderer.mjs`. La fuente, safe areas, saltos y jerarquías salen del template.
- Guarda en cada slide `templateId`, `backgroundMediaId`, `backgroundStyle` y `renderedBy: content-system/instagram-renderer`.
- Si una portada o slide existente repite filename/hash, carece de metadata o rompe el template, marca `regenerate` con `analyze-existing-assets.mjs` y regenera solo ese slug.
- No heredes la paleta o las referencias de Escarlet en otro sitio. Reutiliza las reglas del workflow y carga el brand core del sitio solicitado.

## Publicación

- El flujo nuevo publica desde el CMS y mantiene la experiencia humana en `/app`.
- La revisión guiada usa `appPreviewUrl` y la edición `/app/preview/{slug}`.
- El Social Pack se abre en `/app/social-pack/{slug}` después de publicar.
