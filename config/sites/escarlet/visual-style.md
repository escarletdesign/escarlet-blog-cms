# Estilo visual de imágenes (blog Escarlet)

Guía para portadas y fotos del artículo. El moodboard vive en el CMS (imágenes de referencia). Míralas antes de generar o elegir una portada.

## Qué buscamos

Fotos de gente real trabajando, conversando o mostrando un oficio. Luz natural o interior cálido. Texturas de papel, madera, cerámica, tela, pantalla con diseño. Aspecto editorial, no banco de stock.

## Color

- Base crema y papel. Cerca de `#f4f1ea`.
- Verde oscuro de marca. Cerca de `#1f4d3a`.
- Negro suave para texto. Evita neón, cian saturado y degradados genéricos de IA.

## Composición de portada

- Horizontal, 16:9 o 3:2.
- Sujeto claro. Una persona, un objeto de oficio o un detalle de marca.
- Espacio negativo para que el título no pelee con la cara.
- Sin watermarks, sin logos ajenos, sin texto incrustado en la imagen.

## Qué evitar

- Manos de plástico, dedos de más, oficinas de cristal vacías.
- Collages de iconos 3D, robots, cerebros con circuitos.
- Recortes tipo Pinterest con tipografía encima.

## Nombre y alt

Los nombres de archivo y el alt siguen `image-guide.md`. Esta guía manda el aspecto. La otra manda SEO del archivo.

## Cómo usar las referencias

1. Lista las URLs de `referenceImages` en `blog_get_brand_context`.
2. Describe paleta, encuadre y oficio que ves.
3. Genera o elige una portada que podría colgarse al lado de esas fotos.
4. Súbela con `blog_upload_media` (`kind` `post`). Preferido `imageUrl` https pública. Si ChatGPT solo tiene el archivo en sandbox (`/mnt/data`), usa `contentBase64`. Rellena `imageAlt`.
5. Copia la `media.url` absoluta del CMS al campo `imageUrl` del post.
