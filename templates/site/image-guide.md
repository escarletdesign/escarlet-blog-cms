# Guía de imágenes — {{name}}

## Nombres de archivo

- kebab-case con la idea del post. Ejemplo. `como-elegir-logo-local.webp`
- Subida al CMS (media del site `{{handle}}`), no al git del frontend.

## Alt

- Describe lo que se ve.
- Incluye la keyword solo si encaja de forma natural.

## Subida (preferido)

1. Genera o elige la imagen. Un PNG de 2–3 MB vale.
2. `blog_upload_media` con `contentBase64` o `blob`, `filename`, `alt` y `kind` (`post` o `social`). El CMS comprime a JPEG y devuelve `media.url`.
3. Si el host recorta el base64. Usa el mismo `uploadId` con `chunkIndex` y `chunkCount`. Trozos de hasta 120000 caracteres.
4. Si tienes URL https pública. También vale `imageUrl`. Nunca uses `/mnt/data` como `imageUrl`.
5. Usa la `media.url` absoluta en el `imageUrl` del post o en cada slide.

## Carrusel Instagram (si el canal está activo)

1. Genera 4–7 slides 1080×1350 (o 1080×1080) alineados con visual-style.
2. Filename `{slug}-ig-01.jpg` … `{slug}-ig-07.jpg`.
3. `blog_upload_media` con `kind` `social` por cada slide.
4. Guarda en `socialPack.instagramSlides` `{ imageUrl, alt, headline? }` y un `instagramCaption` con el canónico.
5. Si el canal está activo, genera las slides en ChatGPT y guárdalas con `blog_save_social_pack` después de confirmar el contenido. El CMS no genera Social Packs desde MCP.
