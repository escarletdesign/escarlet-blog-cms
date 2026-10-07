# Social pack

Devuelve JSON válido con `substackTitle`, `substackBody`, `linkedin`, `x`, `instagramCaption`, `videoScript`, `instagramSlides` e `instagramStory` cuando el canal esté activo.

`videoScript` es para teleprompter: líneas de 3–12 palabras, una idea por línea, pausas con una línea vacía y entre 100 y 140 palabras.

Antes de redactar el JSON, fija internamente la tesis, la audiencia, la tensión, el cambio que debe producir el contenido y la progresión. Asigna a cada slide o frame un rol narrativo explícito, como hook, contexto, consecuencia, giro, acción o cierre. Evita repetir una misma idea con titulares distintos y no rellenes una secuencia con frases genéricas.

`instagramSlides` contiene el copy aprobado y la metadata de cada imagen final. Incluye entre cuatro y siete slides y mantén un solo argumento por slide. Cada imagen debe ser 1080×1350, contener el texto integrado y declarar `textRendered: true`, `textContent`, `templateId` y `renderedBy: "chatgpt-image-generation"`.

La imagen final se genera en ChatGPT con el `headline` y el `body` exactos. No generes fondos separados, no llames a un renderer del CMS y no permitas que el CMS reescriba el copy. Si el texto no cabe, acórtalo o divide la idea antes de generar.

`instagramStory` usa `frames[]` como estructura canónica. Cada frame contiene el copy y una imagen final de 1080×1920 con el texto integrado, `alt`, `templateId`, `textContent`, `textRendered: true`, `dimensions: "1080x1920"`, `aspectRatio: "9:16"` y `renderedBy: "chatgpt-image-generation"`. No inventes `linkUrl`: el servidor añadirá la URL canónica del artículo. `imageUrl`, `text` y `alt` en el objeto raíz se conservan solo para lectura histórica.

Para cualquier imagen consulta `brand_get_context` y llama `brand_prepare_image_generation`. Entrega al generador exactamente sus `resolvedReferences` como `ImageContent`, sin escoger ni sustituir referencias. Si `generationBlocked` es `true`, detén la generación. En Instagram redacta textos breves que puedan leerse en un móvil desde la primera lectura. Si no caben, acórtalos o divide la idea entre slides. Nunca reduzcas la tipografía hasta hacerla ilegible.

No uses guiones, rayas, em dash, en dash ni separadores de guiones como decoración en ningún texto visible. El texto de las imágenes nunca lleva borde, contorno, trazo, outline, halo ni sombra pegada.
