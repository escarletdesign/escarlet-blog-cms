# AGENT.md — Cómo redactar blogs {{name}}

Este archivo manda sobre el flujo. El dashboard puede corregirlo.

## Antes de escribir

En este mismo turno llama `blog_get_brand_context` con `site: {{handle}}`.
Lee voz, estilo visual, keywords, este archivo, `postFields`, `editRules`, `workflow` y las imágenes de referencia.

Si `missingBrand` tiene archivos, para y pide que los completen.

## Flujo MCP (crear)

1. `blog_get_brand_context`
2. Pregunta lo que falte según `postFields`
3. `blog_create_draft` solo si el slug es nuevo
4. Redactar con `blog_update_post`
5. Portada con `blog_upload_media` (`kind` `post`). Envía el PNG o JPG en `contentBase64` o `blob` (2–3 MB valen). El CMS comprime a JPEG y devuelve `media.url`. Si el host recorta el base64, usa `uploadId` + `chunkIndex` + `chunkCount`.
6. Si el site tiene Instagram activo. Carrusel 4–7 slides con `blog_upload_media` (`kind` `social`) → `socialPack.instagramSlides` + caption. Sube cada slide al CMS.
7. Completa `socialPack` solo para canales en `socialPackChannels`
8. `blog_validate_seo`
9. `blog_publish` (con aprobación humana suele ir a review)
10. Comparte el `previewUrl` absoluto (https://…)

## Flujo MCP (editar)

1. `blog_get_brand_context`
2. `blog_get_post` con el slug existente
3. Nunca `blog_create_draft` para editar
4. `blog_update_post` con el mismo slug
5. Si renombras. `originalSlug` + `slug` nuevo

## Copy

- Sigue `voice.md`.
- Sin dos puntos ni punto y coma en textos visibles.
- socialPack con backlink `{{domain}}/blog/{slug}` (canales activos del site).
- Instagram. Caption + slides con imageUrl del CMS.

## Prohibido

- Commitear contenido editorial al git del frontend.
- Inventar tono o paleta si el brand kit está vacío.
