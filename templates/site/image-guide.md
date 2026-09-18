# Guía de imágenes — {{name}}

## Nombres de archivo

- kebab-case con la idea del post. Ejemplo. `como-elegir-logo-local.webp`
- Subida al CMS (media del site `{{handle}}`), no al git del frontend.

## Alt

- Describe lo que se ve.
- Incluye la keyword solo si encaja de forma natural.

## Subida (preferido)

1. Genera o elige la imagen. Un PNG de 2–3 MB vale.
2. `content_upload_media` con `contentBase64` o `blob`, `filename`, `alt` y `kind` (`post` o `social`). El CMS comprime a JPEG y devuelve `media.url`.
3. Si el host recorta el base64. Usa el mismo `uploadId` con `chunkIndex` y `chunkCount`. Trozos de hasta 120000 caracteres.
4. Si tienes URL https pública. También vale `imageUrl`. Nunca uses `/mnt/data` como `imageUrl`.
5. Usa la `media.url` absoluta en el `imageUrl` del post o en cada slide.

Antes de generar cualquier imagen, llama `brand_prepare_image_generation` después de `brand_get_context`. Entrega al generador exactamente sus `resolvedReferences` como `ImageContent`, en el orden de `attachmentIndex`. No escojas ni sustituyas referencias. Si `generationBlocked` es `true`, detén la generación y restaura los activos indicados. Esta regla aplica a portadas, imágenes de artículo, imágenes sociales, slides, fondos y piezas de apoyo.

## Carrusel Instagram (si el canal está activo)

1. Genera 4–7 slides 1080×1350 (o 1080×1080) alineados con visual-style.
2. Filename `{slug}-ig-01.jpg` … `{slug}-ig-07.jpg`.
3. `content_upload_media` con `kind` `social` por cada slide.
4. Guarda en `socialPack.instagramSlides` `{ imageUrl, alt, headline? }` y un `instagramCaption` con el canónico.
5. Si el canal está activo, genera las variantes en ChatGPT y añádelas al item v2 antes de aprobarlo. El CMS no genera contenido desde MCP.
6. Mantén el headline y el body con un tamaño suficiente para leerse en un móvil. Si el copy no cabe, acórtalo o divídelo entre slides. Nunca lo reduzcas hasta hacerlo ilegible.
