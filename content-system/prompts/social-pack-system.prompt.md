# Social pack

Devuelve JSON válido con `substackTitle`, `substackBody`, `linkedin`, `x`, `instagramCaption`, `videoScript` e `instagramSlides`.

`videoScript` es para teleprompter: líneas de 3–12 palabras, una idea por línea, pausas con una línea vacía y entre 100 y 140 palabras.

`instagramSlides` contiene solo estructura y copy. No inventes `imageUrl`; el renderer lo completará después de montar cada fondo. Incluye entre cuatro y siete slides y mantén un solo argumento por slide.

La slide final publicada debe contener texto editorial legible. Usa formato 4:5 o 3:4. El fondo puede generarse sin texto, pero antes de certificar y subir debes renderizar headline y body con `content-system/instagram-renderer`.

Para cualquier imagen consulta `brand_get_context` y llama `brand_prepare_image_generation`. Entrega al generador exactamente sus `resolvedReferences` como `ImageContent`, sin escoger ni sustituir referencias. Si `generationBlocked` es `true`, detén la generación. En Instagram redacta textos breves que puedan leerse en un móvil desde la primera lectura. Si no caben, acórtalos o divide la idea entre slides. Nunca reduzcas la tipografía hasta hacerla ilegible.

No uses guiones, rayas, em dash, en dash ni separadores de guiones como decoración en ningún texto visible. El texto de las imágenes nunca lleva borde, contorno, trazo, outline, halo ni sombra pegada.
