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

Antes de generar cualquier imagen, sea portada, foto de artículo, imagen social, slide, fondo o pieza de apoyo, consulta `referenceImages` en `blog_get_brand_context` y entrega las referencias pertinentes al generador. Las referencias son parte del contexto visual, no una sugerencia opcional.

1. Lista las URLs de `referenceImages` en `blog_get_brand_context`.
2. Describe paleta, encuadre y oficio que ves.
3. Genera o elige una portada que podría colgarse al lado de esas fotos.
4. Súbela con `blog_upload_media` (`kind` `post`). Envía el PNG en `contentBase64` o `blob`. El CMS comprime a JPEG. Rellena `imageAlt`.
5. Copia la `media.url` absoluta del CMS al campo `imageUrl` del post.

## Sistema de variedad

Las portadas usan siete arquetipos declarados en `content-system/brand/escarlet-image-archetypes.json`. El agente inspecciona las últimas seis piezas, evita repetir el arquetipo consecutivo y selecciona entre dos y tres referencias aprobadas de `escarlet-reference-library.json`. La coherencia viene de la paleta, la materia, la luz y el contraste; la variedad viene del encuadre, la presencia humana, la abstracción y la metáfora.

Las slides de Instagram se dividen en fondo y composición. El fondo se genera sin texto. El texto se renderiza con los templates `editorial` o `impact` y la fuente declarada, mediante `content-system/instagram-renderer.mjs`. El generador nunca debe intentar escribir la tipografía final. El texto debe ser legible en un móvil desde la primera lectura. Si no cabe, acorta el copy o divide la idea entre slides. Nunca reduzcas la tipografía hasta hacerla ilegible.
