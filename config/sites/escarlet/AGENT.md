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
5. Tras confirmar, llama `blog_publish` o `blog_schedule_post` con `direct: true` según la decisión del usuario. No uses la revisión legacy.
6. Guarda el Social Pack generado por ChatGPT con `blog_save_social_pack`. El CMS no genera copy ni carruseles desde MCP.

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
- Composición y color según `visual-style.md` y las fotos de referencia.
- Cómo subir (orden preferido):
  1. Genera o elige la imagen. Un PNG de 2–3 MB vale.
  2. `blog_upload_media` con `contentBase64` o `blob`. El CMS comprime a JPEG.
  3. Si el host recorta el base64, usa `uploadId`, `chunkIndex` y `chunkCount`.
  4. Nunca uses `/mnt/data` como `imageUrl`.
  5. Usa la `media.url` absoluta en el `imageUrl` del post o en cada slide.
- Carrusel Instagram (`kind` `social`). 4–7 slides. Formato 1080×1350 (o 1080×1080). Filename `{slug}-ig-01.jpg` … `{slug}-ig-07.jpg`. Sube cada slide al CMS y guarda el array en `socialPack.instagramSlides`.

## Publicación

- El flujo nuevo publica desde el CMS y mantiene la experiencia humana en `/app`.
- La revisión guiada usa `appPreviewUrl` y la edición `/app/preview/{slug}`.
- El Social Pack se abre en `/app/social-pack/{slug}` después de publicar.
