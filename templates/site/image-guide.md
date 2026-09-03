# Guía de imágenes — {{name}}

## Nombres de archivo

- kebab-case con la idea del post. Ejemplo. `como-elegir-logo-local.webp`
- Subida al CMS (media del site `{{handle}}`), no al git del frontend.

## Alt

- Describe lo que se ve.
- Incluye la keyword solo si encaja de forma natural.

## Subida (preferido)

1. Genera o elige la imagen.
2. Si tienes URL http(s) pública. `blog_upload_media` con `imageUrl`, `filename`, `alt`, `kind: post`.
3. Si solo tienes el archivo en sandbox de ChatGPT (`/mnt/data/...`). Lee el archivo y pasa `contentBase64` completo. Nunca uses esas rutas como `imageUrl`.
4. Usa la `media.url` absoluta en el `imageUrl` del post.
5. Prefiere JPG o PNG de menos de 1,5 MB. Un WebP recortado en el base64 se guarda a medias y el navegador muestra un recuadro vacío o el icono de imagen rota. Si el CMS rechaza por archivo incompleto, vuelve a subir el archivo entero.

## Carrusel Instagram (si el canal está activo)

1. Genera 4–7 slides 1080×1350 (o 1080×1080) alineados con visual-style.
2. Filename `{slug}-ig-01.webp` … `{slug}-ig-07.webp`.
3. `blog_upload_media` con `kind: social` por cada slide (misma regla de sandbox).
4. Guarda en `socialPack.instagramSlides` `{ imageUrl, alt, headline? }` y un `instagramCaption` con el canónico.
5. Si el canal está activo, sube las 4–7 slides al CMS antes de review.

En portadas grandes prefiere `imageUrl` https. Usa `contentBase64` cuando el sandbox sea la única copia.
