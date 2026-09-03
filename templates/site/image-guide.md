# Guía de imágenes — {{name}}

## Nombres de archivo

- kebab-case con la idea del post. Ejemplo. `como-elegir-logo-local.webp`
- Subida al CMS (media del site `{{handle}}`), no al git del frontend.

## Alt

- Describe lo que se ve.
- Incluye la keyword solo si encaja de forma natural.

## Subida (preferido)

1. Genera o elige la imagen.
2. Consigue una URL http(s) pública temporal.
3. `blog_upload_media` con `imageUrl`, `filename`, `alt`, `kind: post`.
4. Usa la `media.url` absoluta en el `imageUrl` del post.

Evita `contentBase64` en portadas grandes.
